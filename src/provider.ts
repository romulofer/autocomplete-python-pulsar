import { CompositeDisposable } from 'atom';
import type { Point, TextEditor } from 'atom';
import * as path from 'path';

import * as log from './log';
import {
  applySubstitutions,
  compileTriggerRegex,
  resolveSettings,
  type PythonSettings,
  type RawSettings
} from './config';
import { atomDiscoveryHost, atomNotifier } from './host/atom-host';
import { InterpreterRegistry } from './interpreters/registry';
import {
  SOURCE_LABELS,
  type DiscoveredInterpreter
} from './interpreters/locators';
import { JediDaemon } from './daemon/jedi-daemon';
import type {
  Definition,
  DaemonRequest,
  Highlight,
  LookupKind,
  MethodDefinition,
  RequestConfig,
  Suggestion,
  Usage
} from './daemon/protocol';
import { parseSelectorList, scopesMatchSelectors } from './editor/scope-helpers';
import { SemanticHighlighter } from './editor/semantic-highlight';
import {
  filterSuggestions,
  isArgumentCompletionSite,
  truncateToIdentifierStart
} from './editor/completion-rules';
import { createDefinitionsView } from './views/definitions-view';
import { createUsagesView } from './views/usages-view';
import { createOverrideView, insertOverride } from './views/override-view';
import { createInterpreterView } from './views/interpreter-view';
import { RenameView } from './views/rename-view';
import { TooltipManager } from './views/tooltips';
import { SelectListPanel } from './views/select-list-panel';
import { InterpreterStatusView, type StatusBar } from './views/status-bar-view';
import { RunButtonView } from './views/run-button';
import { RunPanel, RUN_PANEL_URI } from './views/run-panel';
import { PythonRunner } from './run/runner';
import { spawnPythonProcess } from './run/spawn';
import { splitArguments } from './run/command';

/** The scope selector autocomplete-plus uses to pick this provider. */
const SELECTOR = '.source.python';

/** Where completions are suppressed entirely. */
const DISABLE_FOR_SELECTOR = '.source.python .comment, .source.python .string';
const DISABLE_FOR_SELECTOR_PARSED = parseSelectorList(DISABLE_FOR_SELECTOR);

/** The grammars this package is willing to drive. */
const PYTHON_SCOPE_NAMES = ['source.python'];

/**
 * Above this many lines, semantic highlighting is skipped: a whole-file Jedi
 * scan on every typing pause stops being cheap, and the grammar still colors
 * the buffer on its own.
 */
const SEMANTIC_HIGHLIGHT_LINE_CAP = 5000;

/** `dist/` is the build output; the daemon script sits beside it. */
const DAEMON_SCRIPT = path.resolve(__dirname, '..', 'python', 'completion.py');

const SETTINGS_URI = 'atom://config/packages/autocomplete-python-pulsar';

interface BufferPosition {
  row: number;
  column: number;
}

interface SnippetsManager {
  insertSnippet(snippet: string, editor: TextEditor): void;
}

interface AutocompleteRequest {
  editor: TextEditor;
  bufferPosition: Point;
  scopeDescriptor: { getScopesArray(): string[] };
  prefix: string;
}

function isPythonEditor(editor: TextEditor): boolean {
  return PYTHON_SCOPE_NAMES.includes(editor.getGrammar().scopeName);
}

/**
 * The autocomplete-plus provider, the editor commands, and everything that
 * turns editor state into a daemon request.
 *
 * Process handling lives in {@link JediDaemon}, interpreter discovery in
 * `src/interpreters/`, and settings parsing in `src/config.ts`; this class wires
 * them to the editor.
 */
export class PythonProvider {
  // --- autocomplete-plus provider contract --------------------------------
  readonly selector = SELECTOR;
  readonly disableForSelector = DISABLE_FOR_SELECTOR;
  readonly inclusionPriority = 2;
  readonly excludeLowerPriority = false;
  suggestionPriority = 3;

  private readonly interpreters = new InterpreterRegistry(
    atomDiscoveryHost,
    () => {
      const settings = this.settings();
      return {
        selected: settings.selectedInterpreter,
        configured: settings.pythonPaths
      };
    }
  );

  private readonly daemon = new JediDaemon({
    interpreters: this.interpreters,
    notifier: atomNotifier,
    scriptPath: DAEMON_SCRIPT,
    idleTimeoutMinutes: () => this.settings().daemonIdleTimeout,
    reportProviderErrors: () => this.settings().outputProviderErrors,
    openSettings: () => void atom.workspace.open(SETTINGS_URI)
  });

  private readonly disposables = new CompositeDisposable();
  private readonly editorDisposables = new Map<number, CompositeDisposable>();
  private readonly tooltips = new TooltipManager(this);

  private snippetsManager: SnippetsManager | null = null;
  private triggerCompletionRegex = compileTriggerRegex('').regex;
  private activated = false;

  private definitionsView: SelectListPanel<Definition> | null = null;
  private usagesView: SelectListPanel<Usage> | null = null;
  private overrideView: SelectListPanel<MethodDefinition> | null = null;
  private interpreterView: SelectListPanel<DiscoveredInterpreter> | null = null;
  private renameView: RenameView | null = null;
  private statusView: InterpreterStatusView | null = null;
  private statusTooltip: { dispose(): void } | null = null;
  private cachedLastSuggestions: Suggestion[] = [];

  private readonly runner = new PythonRunner(spawnPythonProcess);
  private runButton: RunButtonView | null = null;
  private runPanel: RunPanel | null = null;

  /** Exposed for the specs and for bug reports. */
  get lastSuggestions(): readonly Suggestion[] {
    return this.cachedLastSuggestions;
  }

  /** Current settings, defaulted and coerced. */
  settings(): PythonSettings {
    return resolveSettings(
      (atom.config.get('autocomplete-python-pulsar') ?? {}) as RawSettings
    );
  }

  /**
   * Wire up commands and editor observers. Safe to call repeatedly; only the
   * first call does anything, which is what lets both the activation hook and
   * the service getters call it.
   */
  activate(): this {
    if (this.activated) return this;
    this.activated = true;

    this.updateTriggerCompletionRegex();
    this.suggestionPriority = this.settings().suggestionPriority;
    this.registerCommands();
    this.observeConfig();

    this.disposables.add(
      atom.workspace.observeTextEditors((editor) => this.observeEditor(editor))
    );
    this.disposables.add(
      atom.workspace.onDidChangeActiveTextEditor(() => this.refreshRunButton())
    );
    this.registerRunPanelOpener();
    this.observeRunner();
    this.refreshStatusView();
    this.refreshRunButton();
    return this;
  }

  /**
   * Route every runner event to the output pane and the status bar button, so
   * both stay in step with the process without knowing about each other.
   */
  private observeRunner(): void {
    const unsubscribe = this.runner.onEvent((event) => {
      this.runPanel?.handle(event);
      if (event.type === 'started') this.runButton?.setRunning(true);
      if (event.type === 'exited' || event.type === 'failed') {
        this.runButton?.setRunning(false);
      }
      // A non-zero exit means the script failed - a traceback, a SyntaxError,
      // sys.exit(1). That output is the whole point of running it, so reveal
      // the pane even when "Show Output On Run" is off or the user closed it;
      // otherwise the failure is silent and looks like nothing happened.
      if (event.type === 'exited' && event.code !== null && event.code !== 0) {
        void this.revealRunPanel();
      }
      if (event.type === 'failed') {
        atomNotifier.error('autocomplete-python-pulsar could not run the file.', {
          description: event.message,
          dismissable: true
        });
      }
    });
    this.disposables.add({ dispose: unsubscribe });
  }

  /** Lets the output pane be reopened, and restored, as a normal dock item. */
  private registerRunPanelOpener(): void {
    this.disposables.add(
      atom.workspace.addOpener((uri: string) =>
        uri === RUN_PANEL_URI ? this.ensureRunPanel() : undefined
      )
    );
  }

  dispose(): void {
    this.disposables.dispose();
    for (const editorDisposable of this.editorDisposables.values()) {
      editorDisposable.dispose();
    }
    this.editorDisposables.clear();
    this.tooltips.dispose();
    this.daemon.dispose();
    void this.definitionsView?.destroy();
    void this.usagesView?.destroy();
    void this.overrideView?.destroy();
    void this.interpreterView?.destroy();
    this.renameView?.destroy();
    this.statusTooltip?.dispose();
    this.statusTooltip = null;
    this.statusView?.destroy();
    this.statusView = null;
    this.runner.dispose();
    this.runButton?.destroy();
    this.runButton = null;
    this.runPanel?.destroy();
    this.runPanel = null;
    this.activated = false;
  }

  setSnippetsManager(snippetsManager: SnippetsManager): void {
    this.snippetsManager = snippetsManager;
  }

  /** Called by `main` when the `status-bar` service becomes available. */
  consumeStatusBar(statusBar: StatusBar): void {
    this.statusView ??= new InterpreterStatusView(() => {
      void this.selectInterpreter();
    });
    this.statusView.attach(statusBar);

    this.runButton ??= new RunButtonView(() => this.toggleRun());
    this.runButton.attach(statusBar);

    this.refreshStatusView();
    this.refreshRunButton();
  }

  // --- setup --------------------------------------------------------------

  private registerCommands(): void {
    const editorSelector = 'atom-text-editor[data-grammar~=python]';
    this.disposables.add(
      atom.commands.add(editorSelector, {
        'autocomplete-python-pulsar:go-to-definition': () => void this.goToDefinition(),
        'autocomplete-python-pulsar:show-usages': () => void this.showUsages(),
        'autocomplete-python-pulsar:override-method': () => void this.overrideMethod(),
        'autocomplete-python-pulsar:rename': () => void this.rename(),
        'autocomplete-python-pulsar:run-file': () => void this.runActiveFile(),
        'autocomplete-python-pulsar:complete-arguments': () => {
          const editor = atom.workspace.getActiveTextEditor();
          if (!editor) return;
          void this.completeArguments(
            editor,
            editor.getCursorBufferPosition(),
            true
          );
        }
      }),
      atom.commands.add('atom-workspace', {
        'autocomplete-python-pulsar:restart-daemon': () => this.restartDaemon(),
        'autocomplete-python-pulsar:stop': () => this.runner.stop(),
        'autocomplete-python-pulsar:toggle-output': () =>
          void atom.workspace.toggle(RUN_PANEL_URI),
        'autocomplete-python-pulsar:increase-output-font-size': () =>
          this.adjustOutputFontSize(1),
        'autocomplete-python-pulsar:decrease-output-font-size': () =>
          this.adjustOutputFontSize(-1),
        'autocomplete-python-pulsar:reset-output-font-size': () =>
          atom.config.set('autocomplete-python-pulsar.outputFontSize', 0),
        'autocomplete-python-pulsar:select-interpreter': () =>
          void this.selectInterpreter(),
        'autocomplete-python-pulsar:show-environment': () => this.showEnvironment()
      })
    );
  }

  private observeConfig(): void {
    this.disposables.add(
      atom.config.observe(
        'autocomplete-python-pulsar.suggestionPriority',
        (value: unknown) => {
          this.suggestionPriority = Number(value) || 3;
        }
      ),
      atom.config.onDidChange('autocomplete-python-pulsar.triggerCompletionRegex', () =>
        this.updateTriggerCompletionRegex()
      ),
      atom.config.onDidChange('autocomplete-python-pulsar.outputFontSize', () =>
        this.runPanel?.setFontSize(this.settings().outputFontSize)
      ),
      // Toggling semantic highlighting adds or tears down its per-editor
      // listeners, so re-wire every open editor.
      atom.config.onDidChange('autocomplete-python-pulsar.semanticHighlight', () => {
        for (const editor of atom.workspace.getTextEditors()) {
          this.attachToEditor(editor);
        }
      }),
      // Anything that changes which interpreter or which packages Jedi sees
      // invalidates both the interpreter lookup and every cached response.
      atom.config.onDidChange('autocomplete-python-pulsar.pythonPaths', () =>
        this.reloadDaemon()
      ),
      atom.config.onDidChange('autocomplete-python-pulsar.extraPaths', () =>
        this.reloadDaemon()
      ),
      atom.config.onDidChange('autocomplete-python-pulsar.selectedInterpreter', () =>
        this.reloadDaemon()
      ),
      atom.project.onDidChangePaths(() => this.reloadDaemon())
    );
  }

  private reloadDaemon(): void {
    this.daemon.reload();
    this.refreshStatusView();
  }

  /**
   * Compile the user's trigger pattern, telling them once when it does not
   * compile. Recompiled on change, so editing the setting no longer requires an
   * editor restart.
   */
  private updateTriggerCompletionRegex(): void {
    const { regex, error } = compileTriggerRegex(
      this.settings().triggerCompletionRegex
    );
    this.triggerCompletionRegex = regex;
    if (!error) return;

    atomNotifier.warning(
      'autocomplete-python-pulsar: invalid completion trigger regex, using the default.',
      { detail: error, dismissable: true }
    );
  }

  private observeEditor(editor: TextEditor): void {
    this.attachToEditor(editor);
    this.disposables.add(
      editor.onDidChangeGrammar(() => this.attachToEditor(editor))
    );
  }

  /** (Re)wire the per-editor listeners, replacing any already in place. */
  private attachToEditor(editor: TextEditor): void {
    this.detachFromEditor(editor);
    if (!isPythonEditor(editor)) return;

    const disposables = new CompositeDisposable();

    // Argument completion used to hang off a raw `keyup` listener matching
    // the `^(` keystroke, which silently did nothing on any keyboard layout
    // where `(` is not shift-9. Watching the buffer instead is
    // layout-independent. Upstream issues #416, #455, #465.
    disposables.add(
      editor.getBuffer().onDidChangeText(({ changes }) => {
        if (!changes.some((change) => change.newText.includes('('))) return;
        void this.completeArguments(
          editor,
          editor.getCursorBufferPosition(),
          false
        );
      })
    );

    if (this.settings().showTooltips) {
      disposables.add(
        editor.onDidChangeCursorPosition((event) => {
          void this.tooltips.handleCursorChange(editor, event);
        })
      );
    }

    if (this.settings().semanticHighlight) {
      const highlighter = new SemanticHighlighter(editor);
      disposables.add({ dispose: () => highlighter.dispose() });

      const refresh = (): void =>
        void this.refreshHighlights(editor, highlighter);
      // `onDidStopChanging` is already debounced by Pulsar, so Jedi is asked
      // once the user pauses rather than on every keystroke.
      disposables.add(editor.getBuffer().onDidStopChanging(refresh));
      refresh();
    }

    disposables.add(editor.onDidDestroy(() => this.detachFromEditor(editor)));

    this.editorDisposables.set(editor.id, disposables);
    log.debug('Attached to editor', editor.id);
  }

  private detachFromEditor(editor: TextEditor): void {
    const disposables = this.editorDisposables.get(editor.id);
    if (!disposables) return;
    disposables.dispose();
    this.editorDisposables.delete(editor.id);
  }

  // --- requests -----------------------------------------------------------

  private requestConfig(settings: PythonSettings): RequestConfig {
    return {
      extraPaths: applySubstitutions(
        settings.extraPaths,
        atom.project.getPaths()
      ),
      useSnippets: settings.useSnippets,
      caseInsensitiveCompletion: settings.caseInsensitiveCompletion,
      showDescriptions: settings.showDescriptions,
      fuzzyMatcher: settings.fuzzyMatcher
    };
  }

  private buildRequest(
    lookup: LookupKind,
    editor: TextEditor,
    bufferPosition: BufferPosition,
    options: { source?: string; prefix?: string } = {}
  ): DaemonRequest {
    const source = options.source ?? editor.getText();
    const filePath = editor.getPath() ?? null;
    return {
      id: this.daemon.requestId(
        lookup,
        filePath,
        source,
        bufferPosition.row,
        bufferPosition.column
      ),
      lookup,
      path: filePath,
      source,
      line: bufferPosition.row,
      column: bufferPosition.column,
      ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
      config: this.requestConfig(this.settings())
    };
  }

  // --- autocomplete-plus --------------------------------------------------

  async getSuggestions(
    request: AutocompleteRequest
  ): Promise<readonly Suggestion[]> {
    const { editor, prefix, scopeDescriptor } = request;

    if (!this.triggerCompletionRegex.test(prefix)) {
      return (this.cachedLastSuggestions = []);
    }
    if (
      scopesMatchSelectors(
        scopeDescriptor.getScopesArray(),
        DISABLE_FOR_SELECTOR_PARSED
      )
    ) {
      return (this.cachedLastSuggestions = []);
    }

    const useFuzzyMatcher = this.settings().fuzzyMatcher;
    let { row, column } = request.bufferPosition;
    let source = editor.getText();

    if (useFuzzyMatcher) {
      // Ask Jedi about the position just after the dot and filter locally, so
      // one daemon round trip serves every keystroke of the same identifier.
      const lines = editor.getBuffer().getLines();
      const truncated = truncateToIdentifierStart(lines[row] ?? '', column);
      if (truncated) {
        column = truncated.column;
        lines[row] = truncated.line;
        source = lines.join('\n');
      }
    }

    const daemonRequest = this.buildRequest(
      'completions',
      editor,
      { row, column },
      { source, prefix }
    );

    const cached = this.daemon.cachedResponse<Suggestion>(daemonRequest.id);
    const results = cached
      ? cached.results
      : (await this.daemon.send<Suggestion>(daemonRequest)).results;

    return (this.cachedLastSuggestions = useFuzzyMatcher
      ? filterSuggestions(results, prefix)
      : results);
  }

  // --- feature commands ---------------------------------------------------

  async getDefinitions(
    editor: TextEditor,
    bufferPosition: BufferPosition
  ): Promise<Definition[]> {
    const response = await this.daemon.send<Definition>(
      this.buildRequest('definitions', editor, bufferPosition)
    );
    return response.results;
  }

  async getTooltip(
    editor: TextEditor,
    bufferPosition: BufferPosition
  ): Promise<Definition[]> {
    const response = await this.daemon.send<Definition>(
      this.buildRequest('tooltip', editor, bufferPosition)
    );
    return response.results;
  }

  async getUsages(
    editor: TextEditor,
    bufferPosition: BufferPosition
  ): Promise<Usage[]> {
    const response = await this.daemon.send<Usage>(
      this.buildRequest('usages', editor, bufferPosition)
    );
    return response.results;
  }

  /** Semantic classification of every name in the buffer. */
  async getHighlights(editor: TextEditor): Promise<Highlight[]> {
    // A whole-file scan; the position is only there to key the request cache.
    const request = this.buildRequest('highlights', editor, {
      row: 0,
      column: 0
    });
    const cached = this.daemon.cachedResponse<Highlight>(request.id);
    const response =
      cached ?? (await this.daemon.send<Highlight>(request));
    return response.results;
  }

  /**
   * Refresh one editor's semantic decorations, skipping files large enough that
   * a per-pause Jedi scan would be felt.
   */
  private async refreshHighlights(
    editor: TextEditor,
    highlighter: SemanticHighlighter
  ): Promise<void> {
    if (editor.getLineCount() > SEMANTIC_HIGHLIGHT_LINE_CAP) return;
    highlighter.update(await this.getHighlights(editor));
  }

  /**
   * Ask Jedi what a subclass could override, by completing `self.` inside a
   * throwaway method injected below the cursor.
   */
  async getMethods(
    editor: TextEditor,
    bufferPosition: BufferPosition
  ): Promise<{
    methods: MethodDefinition[];
    indent: number;
    bufferPosition: BufferPosition;
  }> {
    const lines = editor.getBuffer().getLines();
    lines.splice(bufferPosition.row + 1, 0, '  def __autocomplete_python(s):');
    lines.splice(bufferPosition.row + 2, 0, '    s.');

    const response = await this.daemon.send<MethodDefinition>(
      this.buildRequest(
        'methods',
        editor,
        { row: bufferPosition.row + 2, column: 6 },
        { source: lines.join('\n') }
      )
    );
    return {
      methods: response.results,
      indent: bufferPosition.column,
      bufferPosition
    };
  }

  async goToDefinition(
    editor?: TextEditor,
    bufferPosition?: BufferPosition
  ): Promise<void> {
    const targetEditor = editor ?? atom.workspace.getActiveTextEditor();
    if (!targetEditor) return;
    const position = bufferPosition ?? targetEditor.getCursorBufferPosition();

    void this.definitionsView?.destroy();
    const view = (this.definitionsView = createDefinitionsView());
    view.show();

    const definitions = await this.getDefinitions(targetEditor, position);
    const only = definitions.length === 1 ? definitions[0] : undefined;
    if (only) {
      view.confirmItem(only);
      return;
    }
    await view.setItems(definitions);
  }

  async showUsages(): Promise<void> {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;

    void this.usagesView?.destroy();
    const view = (this.usagesView = createUsagesView());
    view.show();

    await view.setItems(
      await this.getUsages(editor, editor.getCursorBufferPosition())
    );
  }

  async overrideMethod(): Promise<void> {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;
    const bufferPosition = editor.getCursorBufferPosition();

    void this.overrideView?.destroy();
    const view = (this.overrideView = createOverrideView(
      (method: MethodDefinition) => {
        insertOverride(
          editor,
          method,
          bufferPosition.row,
          bufferPosition.column
        );
      }
    ));
    view.show();

    const { methods } = await this.getMethods(editor, bufferPosition);
    await view.setItems(methods);
  }

  async rename(): Promise<void> {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor) return;

    const usages = await this.getUsages(
      editor,
      editor.getCursorBufferPosition()
    );

    if (usages.length === 0) {
      void this.usagesView?.destroy();
      const view = (this.usagesView = createUsagesView());
      view.show();
      await view.setItems(usages);
      return;
    }

    this.renameView?.destroy();
    this.renameView = new RenameView(usages);
    this.renameView.onInput((newName: string) => {
      void this.applyRename(usages, newName);
    });
  }

  /**
   * Rewrite every in-project usage. Edits within a file are applied from the
   * end of the buffer backwards, so earlier positions stay valid no matter how
   * the name's length changes - the old code tracked a per-line column offset
   * by hand and got it wrong whenever two usages shared a line out of order.
   */
  private async applyRename(
    usages: readonly Usage[],
    newName: string
  ): Promise<void> {
    const byFile = new Map<string, Usage[]>();
    for (const usage of usages) {
      const [projectPath] = atom.project.relativizePath(usage.fileName);
      if (!projectPath) {
        log.debug('Ignoring a usage outside the project', usage.fileName);
        continue;
      }
      const forFile = byFile.get(usage.fileName) ?? [];
      forFile.push(usage);
      byFile.set(usage.fileName, forFile);
    }

    for (const [fileName, fileUsages] of byFile) {
      const editor = (await atom.workspace.open(fileName, {
        activateItem: false
      })) as TextEditor;
      const buffer = editor.getBuffer();

      const ordered = [...fileUsages].sort(
        (a, b) => b.line - a.line || b.column - a.column
      );
      for (const usage of ordered) {
        buffer.setTextInRange(
          [
            [usage.line - 1, usage.column],
            [usage.line - 1, usage.column + usage.name.length]
          ],
          newName
        );
      }
      await buffer.save();
    }
  }

  /**
   * Insert a snippet for the arguments of the call the cursor sits inside.
   *
   * `force` comes from the explicit `complete-arguments` command and bypasses
   * the `useSnippets` setting.
   */
  async completeArguments(
    editor: TextEditor,
    bufferPosition: BufferPosition,
    force: boolean
  ): Promise<void> {
    if (!force && this.settings().useSnippets === 'none') return;
    if (!this.snippetsManager) {
      log.debug('No snippets service available; skipping argument completion');
      return;
    }

    const scopes = editor
      .scopeDescriptorForBufferPosition(bufferPosition)
      .getScopesArray();
    if (scopesMatchSelectors(scopes, DISABLE_FOR_SELECTOR_PARSED)) {
      log.debug('Not completing arguments inside', scopes);
      return;
    }
    if (!isArgumentCompletionSite(
      editor.lineTextForBufferRow(bufferPosition.row) ?? '',
      bufferPosition.column
    )) {
      return;
    }

    const response = await this.daemon.send(
      this.buildRequest('arguments', editor, bufferPosition)
    );
    if (!response.arguments) return;

    // The cursor may have moved while Jedi was thinking; re-check before
    // writing into the buffer.
    const current = editor.getCursorBufferPosition();
    if (
      current.row !== bufferPosition.row ||
      current.column !== bufferPosition.column
    ) {
      log.debug('Discarding a stale argument completion');
      return;
    }
    this.snippetsManager.insertSnippet(response.arguments, editor);
  }

  // --- running ------------------------------------------------------------

  private ensureRunPanel(): RunPanel {
    if (!this.runPanel) {
      this.runPanel = new RunPanel(
        () => this.runner.stop(),
        (text) => this.runner.sendInput(text),
        () => this.runner.endInput()
      );
      this.runPanel.setFontSize(this.settings().outputFontSize);
    }
    return this.runPanel;
  }

  /**
   * Step the output pane font size, writing it back to the setting so the
   * change sticks and the config observer re-applies it to the pane. A stored
   * 0 means "follow the editor", so the first step grows from the editor size
   * rather than from an implicit value. Clamped to the setting's own bounds.
   */
  private adjustOutputFontSize(delta: number): void {
    const current = this.settings().outputFontSize;
    const base =
      current > 0 ? current : Number(atom.config.get('editor.fontSize')) || 14;
    const next = Math.min(72, Math.max(1, base + delta));
    atom.config.set('autocomplete-python-pulsar.outputFontSize', next);
  }

  /**
   * Bring the output pane into view. Opening the item is not enough when the
   * bottom dock itself is hidden, so show the dock too. Focus stays in the
   * editor: the user is running code, not reading yet.
   */
  private async revealRunPanel(): Promise<void> {
    this.ensureRunPanel();
    await atom.workspace.open(RUN_PANEL_URI, {
      activatePane: false,
      activateItem: true,
      searchAllPanes: true
    });
    atom.workspace.getBottomDock().show();
  }

  /** The status bar button and its keybinding share this. */
  toggleRun(): void {
    if (this.runner.isRunning) {
      this.runner.stop();
      return;
    }
    void this.runActiveFile();
  }

  /**
   * Run the active Python file with the interpreter the package discovered,
   * which is the point of putting this here rather than in a generic runner:
   * the script runs in the same environment the completions came from.
   */
  async runActiveFile(): Promise<void> {
    const editor = atom.workspace.getActiveTextEditor();
    if (!editor || !isPythonEditor(editor)) {
      atomNotifier.warning('autocomplete-python-pulsar: no Python file is active.');
      return;
    }

    const settings = this.settings();
    if (settings.saveBeforeRun && editor.isModified()) {
      try {
        await editor.save();
      } catch (err) {
        // A read-only file or a full disk would otherwise reject the promise
        // that `toggleRun` fires and forgets, leaving the user with no output
        // and no idea the run never happened.
        atomNotifier.error(
          'autocomplete-python-pulsar could not save the file before running it.',
          { description: String(err), dismissable: true }
        );
        return;
      }
    }

    const filePath = editor.getPath();
    if (!filePath) {
      atomNotifier.warning(
        'autocomplete-python-pulsar: save the file before running it.'
      );
      return;
    }

    const interpreter = this.interpreters.bestPath();
    if (!interpreter) {
      atomNotifier.warning(
        'autocomplete-python-pulsar could not find a Python interpreter to run with.',
        {
          description:
            'Run **Autocomplete Python Pulsar: Select Interpreter** and try again.',
          dismissable: true
        }
      );
      return;
    }

    const panel = this.ensureRunPanel();
    if (settings.clearOutputOnRun) panel.clear();
    if (settings.showOutputOnRun) {
      // Keep focus in the editor: the user is running code, not reading yet.
      await this.revealRunPanel();
    }

    this.runner.run({
      interpreter,
      filePath,
      scriptArguments: splitArguments(settings.runArguments),
      projectPaths: atom.project.getPaths(),
      workingDirectory: settings.runWorkingDirectory
    });
  }

  /** The button is only meaningful while a Python file is in front. */
  private refreshRunButton(): void {
    if (!this.runButton) return;
    const editor = atom.workspace.getActiveTextEditor();
    this.runButton.setVisible(Boolean(editor && isPythonEditor(editor)));
  }

  // --- diagnostics --------------------------------------------------------

  restartDaemon(): void {
    this.reloadDaemon();
    atomNotifier.success(
      'autocomplete-python-pulsar: completion daemon restarted.'
    );
  }

  /**
   * Let the user pick an interpreter explicitly. The choice is stored in
   * `selectedInterpreter` and takes priority over every locator, which is what
   * makes a project with several candidate environments predictable.
   */
  async selectInterpreter(): Promise<void> {
    void this.interpreterView?.destroy();
    const view = (this.interpreterView = createInterpreterView(
      (interpreter: DiscoveredInterpreter) => {
        atom.config.set(
          'autocomplete-python-pulsar.selectedInterpreter',
          interpreter.filePath
        );
        this.reloadDaemon();
        atomNotifier.success(
          `autocomplete-python-pulsar is now using ${interpreter.filePath}`
        );
      }
    ));
    view.show();

    this.interpreters.invalidate();
    await view.setItems(this.interpreters.all());
  }

  private refreshStatusView(): void {
    if (!this.statusView) return;

    const interpreter = this.interpreters.best();
    this.statusView.setText(
      interpreter ? this.interpreters.describe(interpreter) : 'no interpreter'
    );

    this.statusTooltip?.dispose();
    this.statusTooltip = this.statusView.setTooltip(
      interpreter
        ? `autocomplete-python-pulsar: ${interpreter.filePath} (${SOURCE_LABELS[interpreter.source]}). Click to change.`
        : 'autocomplete-python-pulsar found no Python interpreter. Click to choose one.'
    );
  }

  /** Report the interpreter and Jedi version actually in use. */
  showEnvironment(): void {
    const chosen = this.interpreters.best();
    const all = this.interpreters.all();

    atomNotifier.info('autocomplete-python-pulsar environment', {
      description: chosen
        ? `Using \`${chosen.filePath}\` (${SOURCE_LABELS[chosen.source]}).`
        : 'No Python interpreter found.',
      detail: [
        `Jedi: ${this.daemon.runtime?.jedi ?? 'not reported yet'}`,
        `Python: ${this.daemon.runtime?.python ?? 'not reported yet'}`,
        '',
        'Candidates, in priority order:',
        ...all.map(
          (entry, index) =>
            `  ${index + 1}. [${SOURCE_LABELS[entry.source]}] ${entry.filePath}`
        )
      ].join('\n'),
      dismissable: true
    });
  }
}

export default new PythonProvider();
