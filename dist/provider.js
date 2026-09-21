"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PythonProvider = void 0;
const atom_1 = require("atom");
const path = __importStar(require("path"));
const log = __importStar(require("./log"));
const config_1 = require("./config");
const atom_host_1 = require("./host/atom-host");
const registry_1 = require("./interpreters/registry");
const locators_1 = require("./interpreters/locators");
const jedi_daemon_1 = require("./daemon/jedi-daemon");
const scope_helpers_1 = require("./editor/scope-helpers");
const semantic_highlight_1 = require("./editor/semantic-highlight");
const completion_rules_1 = require("./editor/completion-rules");
const definitions_view_1 = require("./views/definitions-view");
const usages_view_1 = require("./views/usages-view");
const override_view_1 = require("./views/override-view");
const interpreter_view_1 = require("./views/interpreter-view");
const rename_view_1 = require("./views/rename-view");
const tooltips_1 = require("./views/tooltips");
const status_bar_view_1 = require("./views/status-bar-view");
const run_button_1 = require("./views/run-button");
const run_panel_1 = require("./views/run-panel");
const runner_1 = require("./run/runner");
const spawn_1 = require("./run/spawn");
const command_1 = require("./run/command");
/** The scope selector autocomplete-plus uses to pick this provider. */
const SELECTOR = '.source.python';
/** Where completions are suppressed entirely. */
const DISABLE_FOR_SELECTOR = '.source.python .comment, .source.python .string';
const DISABLE_FOR_SELECTOR_PARSED = (0, scope_helpers_1.parseSelectorList)(DISABLE_FOR_SELECTOR);
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
function isPythonEditor(editor) {
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
class PythonProvider {
    // --- autocomplete-plus provider contract --------------------------------
    selector = SELECTOR;
    disableForSelector = DISABLE_FOR_SELECTOR;
    inclusionPriority = 2;
    excludeLowerPriority = false;
    suggestionPriority = 3;
    interpreters = new registry_1.InterpreterRegistry(atom_host_1.atomDiscoveryHost, () => {
        const settings = this.settings();
        return {
            selected: settings.selectedInterpreter,
            configured: settings.pythonPaths
        };
    });
    daemon = new jedi_daemon_1.JediDaemon({
        interpreters: this.interpreters,
        notifier: atom_host_1.atomNotifier,
        scriptPath: DAEMON_SCRIPT,
        idleTimeoutMinutes: () => this.settings().daemonIdleTimeout,
        reportProviderErrors: () => this.settings().outputProviderErrors,
        openSettings: () => void atom.workspace.open(SETTINGS_URI)
    });
    disposables = new atom_1.CompositeDisposable();
    editorDisposables = new Map();
    tooltips = new tooltips_1.TooltipManager(this);
    snippetsManager = null;
    triggerCompletionRegex = (0, config_1.compileTriggerRegex)('').regex;
    activated = false;
    definitionsView = null;
    usagesView = null;
    overrideView = null;
    interpreterView = null;
    renameView = null;
    statusView = null;
    statusTooltip = null;
    cachedLastSuggestions = [];
    runner = new runner_1.PythonRunner(spawn_1.spawnPythonProcess);
    runButton = null;
    runPanel = null;
    /** Exposed for the specs and for bug reports. */
    get lastSuggestions() {
        return this.cachedLastSuggestions;
    }
    /** Current settings, defaulted and coerced. */
    settings() {
        return (0, config_1.resolveSettings)((atom.config.get('autocomplete-python-pulsar') ?? {}));
    }
    /**
     * Wire up commands and editor observers. Safe to call repeatedly; only the
     * first call does anything, which is what lets both the activation hook and
     * the service getters call it.
     */
    activate() {
        if (this.activated)
            return this;
        this.activated = true;
        this.updateTriggerCompletionRegex();
        this.suggestionPriority = this.settings().suggestionPriority;
        this.registerCommands();
        this.observeConfig();
        this.disposables.add(atom.workspace.observeTextEditors((editor) => this.observeEditor(editor)));
        this.disposables.add(atom.workspace.onDidChangeActiveTextEditor(() => this.refreshRunButton()));
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
    observeRunner() {
        const unsubscribe = this.runner.onEvent((event) => {
            this.runPanel?.handle(event);
            if (event.type === 'started')
                this.runButton?.setRunning(true);
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
                atom_host_1.atomNotifier.error('autocomplete-python-pulsar could not run the file.', {
                    description: event.message,
                    dismissable: true
                });
            }
        });
        this.disposables.add({ dispose: unsubscribe });
    }
    /** Lets the output pane be reopened, and restored, as a normal dock item. */
    registerRunPanelOpener() {
        this.disposables.add(atom.workspace.addOpener((uri) => uri === run_panel_1.RUN_PANEL_URI ? this.ensureRunPanel() : undefined));
    }
    dispose() {
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
    setSnippetsManager(snippetsManager) {
        this.snippetsManager = snippetsManager;
    }
    /** Called by `main` when the `status-bar` service becomes available. */
    consumeStatusBar(statusBar) {
        this.statusView ??= new status_bar_view_1.InterpreterStatusView(() => {
            void this.selectInterpreter();
        });
        this.statusView.attach(statusBar);
        this.runButton ??= new run_button_1.RunButtonView(() => this.toggleRun());
        this.runButton.attach(statusBar);
        this.refreshStatusView();
        this.refreshRunButton();
    }
    // --- setup --------------------------------------------------------------
    registerCommands() {
        const editorSelector = 'atom-text-editor[data-grammar~=python]';
        this.disposables.add(atom.commands.add(editorSelector, {
            'autocomplete-python-pulsar:go-to-definition': () => void this.goToDefinition(),
            'autocomplete-python-pulsar:show-usages': () => void this.showUsages(),
            'autocomplete-python-pulsar:override-method': () => void this.overrideMethod(),
            'autocomplete-python-pulsar:rename': () => void this.rename(),
            'autocomplete-python-pulsar:run-file': () => void this.runActiveFile(),
            'autocomplete-python-pulsar:complete-arguments': () => {
                const editor = atom.workspace.getActiveTextEditor();
                if (!editor)
                    return;
                void this.completeArguments(editor, editor.getCursorBufferPosition(), true);
            }
        }), atom.commands.add('atom-workspace', {
            'autocomplete-python-pulsar:restart-daemon': () => this.restartDaemon(),
            'autocomplete-python-pulsar:stop': () => this.runner.stop(),
            'autocomplete-python-pulsar:toggle-output': () => void atom.workspace.toggle(run_panel_1.RUN_PANEL_URI),
            'autocomplete-python-pulsar:increase-output-font-size': () => this.adjustOutputFontSize(1),
            'autocomplete-python-pulsar:decrease-output-font-size': () => this.adjustOutputFontSize(-1),
            'autocomplete-python-pulsar:reset-output-font-size': () => atom.config.set('autocomplete-python-pulsar.outputFontSize', 0),
            'autocomplete-python-pulsar:select-interpreter': () => void this.selectInterpreter(),
            'autocomplete-python-pulsar:show-environment': () => this.showEnvironment()
        }));
    }
    observeConfig() {
        this.disposables.add(atom.config.observe('autocomplete-python-pulsar.suggestionPriority', (value) => {
            this.suggestionPriority = Number(value) || 3;
        }), atom.config.onDidChange('autocomplete-python-pulsar.triggerCompletionRegex', () => this.updateTriggerCompletionRegex()), atom.config.onDidChange('autocomplete-python-pulsar.outputFontSize', () => this.runPanel?.setFontSize(this.settings().outputFontSize)), 
        // Toggling semantic highlighting adds or tears down its per-editor
        // listeners, so re-wire every open editor.
        atom.config.onDidChange('autocomplete-python-pulsar.semanticHighlight', () => {
            for (const editor of atom.workspace.getTextEditors()) {
                this.attachToEditor(editor);
            }
        }), 
        // Anything that changes which interpreter or which packages Jedi sees
        // invalidates both the interpreter lookup and every cached response.
        atom.config.onDidChange('autocomplete-python-pulsar.pythonPaths', () => this.reloadDaemon()), atom.config.onDidChange('autocomplete-python-pulsar.extraPaths', () => this.reloadDaemon()), atom.config.onDidChange('autocomplete-python-pulsar.selectedInterpreter', () => this.reloadDaemon()), atom.project.onDidChangePaths(() => this.reloadDaemon()));
    }
    reloadDaemon() {
        this.daemon.reload();
        this.refreshStatusView();
    }
    /**
     * Compile the user's trigger pattern, telling them once when it does not
     * compile. Recompiled on change, so editing the setting no longer requires an
     * editor restart.
     */
    updateTriggerCompletionRegex() {
        const { regex, error } = (0, config_1.compileTriggerRegex)(this.settings().triggerCompletionRegex);
        this.triggerCompletionRegex = regex;
        if (!error)
            return;
        atom_host_1.atomNotifier.warning('autocomplete-python-pulsar: invalid completion trigger regex, using the default.', { detail: error, dismissable: true });
    }
    observeEditor(editor) {
        this.attachToEditor(editor);
        this.disposables.add(editor.onDidChangeGrammar(() => this.attachToEditor(editor)));
    }
    /** (Re)wire the per-editor listeners, replacing any already in place. */
    attachToEditor(editor) {
        this.detachFromEditor(editor);
        if (!isPythonEditor(editor))
            return;
        const disposables = new atom_1.CompositeDisposable();
        // Argument completion used to hang off a raw `keyup` listener matching
        // the `^(` keystroke, which silently did nothing on any keyboard layout
        // where `(` is not shift-9. Watching the buffer instead is
        // layout-independent. Upstream issues #416, #455, #465.
        disposables.add(editor.getBuffer().onDidChangeText(({ changes }) => {
            if (!changes.some((change) => change.newText.includes('(')))
                return;
            void this.completeArguments(editor, editor.getCursorBufferPosition(), false);
        }));
        if (this.settings().showTooltips) {
            disposables.add(editor.onDidChangeCursorPosition((event) => {
                void this.tooltips.handleCursorChange(editor, event);
            }));
        }
        if (this.settings().semanticHighlight) {
            const highlighter = new semantic_highlight_1.SemanticHighlighter(editor);
            disposables.add({ dispose: () => highlighter.dispose() });
            const refresh = () => void this.refreshHighlights(editor, highlighter);
            // `onDidStopChanging` is already debounced by Pulsar, so Jedi is asked
            // once the user pauses rather than on every keystroke.
            disposables.add(editor.getBuffer().onDidStopChanging(refresh));
            refresh();
        }
        disposables.add(editor.onDidDestroy(() => this.detachFromEditor(editor)));
        this.editorDisposables.set(editor.id, disposables);
        log.debug('Attached to editor', editor.id);
    }
    detachFromEditor(editor) {
        const disposables = this.editorDisposables.get(editor.id);
        if (!disposables)
            return;
        disposables.dispose();
        this.editorDisposables.delete(editor.id);
    }
    // --- requests -----------------------------------------------------------
    requestConfig(settings) {
        return {
            extraPaths: (0, config_1.applySubstitutions)(settings.extraPaths, atom.project.getPaths()),
            useSnippets: settings.useSnippets,
            caseInsensitiveCompletion: settings.caseInsensitiveCompletion,
            showDescriptions: settings.showDescriptions,
            fuzzyMatcher: settings.fuzzyMatcher
        };
    }
    buildRequest(lookup, editor, bufferPosition, options = {}) {
        const source = options.source ?? editor.getText();
        const filePath = editor.getPath() ?? null;
        return {
            id: this.daemon.requestId(lookup, filePath, source, bufferPosition.row, bufferPosition.column),
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
    async getSuggestions(request) {
        const { editor, prefix, scopeDescriptor } = request;
        if (!this.triggerCompletionRegex.test(prefix)) {
            return (this.cachedLastSuggestions = []);
        }
        if ((0, scope_helpers_1.scopesMatchSelectors)(scopeDescriptor.getScopesArray(), DISABLE_FOR_SELECTOR_PARSED)) {
            return (this.cachedLastSuggestions = []);
        }
        const useFuzzyMatcher = this.settings().fuzzyMatcher;
        let { row, column } = request.bufferPosition;
        let source = editor.getText();
        if (useFuzzyMatcher) {
            // Ask Jedi about the position just after the dot and filter locally, so
            // one daemon round trip serves every keystroke of the same identifier.
            const lines = editor.getBuffer().getLines();
            const truncated = (0, completion_rules_1.truncateToIdentifierStart)(lines[row] ?? '', column);
            if (truncated) {
                column = truncated.column;
                lines[row] = truncated.line;
                source = lines.join('\n');
            }
        }
        const daemonRequest = this.buildRequest('completions', editor, { row, column }, { source, prefix });
        const cached = this.daemon.cachedResponse(daemonRequest.id);
        const results = cached
            ? cached.results
            : (await this.daemon.send(daemonRequest)).results;
        return (this.cachedLastSuggestions = useFuzzyMatcher
            ? (0, completion_rules_1.filterSuggestions)(results, prefix)
            : results);
    }
    // --- feature commands ---------------------------------------------------
    async getDefinitions(editor, bufferPosition) {
        const response = await this.daemon.send(this.buildRequest('definitions', editor, bufferPosition));
        return response.results;
    }
    async getTooltip(editor, bufferPosition) {
        const response = await this.daemon.send(this.buildRequest('tooltip', editor, bufferPosition));
        return response.results;
    }
    async getUsages(editor, bufferPosition) {
        const response = await this.daemon.send(this.buildRequest('usages', editor, bufferPosition));
        return response.results;
    }
    /** Semantic classification of every name in the buffer. */
    async getHighlights(editor) {
        // A whole-file scan; the position is only there to key the request cache.
        const request = this.buildRequest('highlights', editor, {
            row: 0,
            column: 0
        });
        const cached = this.daemon.cachedResponse(request.id);
        const response = cached ?? (await this.daemon.send(request));
        return response.results;
    }
    /**
     * Refresh one editor's semantic decorations, skipping files large enough that
     * a per-pause Jedi scan would be felt.
     */
    async refreshHighlights(editor, highlighter) {
        if (editor.getLineCount() > SEMANTIC_HIGHLIGHT_LINE_CAP)
            return;
        highlighter.update(await this.getHighlights(editor));
    }
    /**
     * Ask Jedi what a subclass could override, by completing `self.` inside a
     * throwaway method injected below the cursor.
     */
    async getMethods(editor, bufferPosition) {
        const lines = editor.getBuffer().getLines();
        lines.splice(bufferPosition.row + 1, 0, '  def __autocomplete_python(s):');
        lines.splice(bufferPosition.row + 2, 0, '    s.');
        const response = await this.daemon.send(this.buildRequest('methods', editor, { row: bufferPosition.row + 2, column: 6 }, { source: lines.join('\n') }));
        return {
            methods: response.results,
            indent: bufferPosition.column,
            bufferPosition
        };
    }
    async goToDefinition(editor, bufferPosition) {
        const targetEditor = editor ?? atom.workspace.getActiveTextEditor();
        if (!targetEditor)
            return;
        const position = bufferPosition ?? targetEditor.getCursorBufferPosition();
        void this.definitionsView?.destroy();
        const view = (this.definitionsView = (0, definitions_view_1.createDefinitionsView)());
        view.show();
        const definitions = await this.getDefinitions(targetEditor, position);
        const only = definitions.length === 1 ? definitions[0] : undefined;
        if (only) {
            view.confirmItem(only);
            return;
        }
        await view.setItems(definitions);
    }
    async showUsages() {
        const editor = atom.workspace.getActiveTextEditor();
        if (!editor)
            return;
        void this.usagesView?.destroy();
        const view = (this.usagesView = (0, usages_view_1.createUsagesView)());
        view.show();
        await view.setItems(await this.getUsages(editor, editor.getCursorBufferPosition()));
    }
    async overrideMethod() {
        const editor = atom.workspace.getActiveTextEditor();
        if (!editor)
            return;
        const bufferPosition = editor.getCursorBufferPosition();
        void this.overrideView?.destroy();
        const view = (this.overrideView = (0, override_view_1.createOverrideView)((method) => {
            (0, override_view_1.insertOverride)(editor, method, bufferPosition.row, bufferPosition.column);
        }));
        view.show();
        const { methods } = await this.getMethods(editor, bufferPosition);
        await view.setItems(methods);
    }
    async rename() {
        const editor = atom.workspace.getActiveTextEditor();
        if (!editor)
            return;
        const usages = await this.getUsages(editor, editor.getCursorBufferPosition());
        if (usages.length === 0) {
            void this.usagesView?.destroy();
            const view = (this.usagesView = (0, usages_view_1.createUsagesView)());
            view.show();
            await view.setItems(usages);
            return;
        }
        this.renameView?.destroy();
        this.renameView = new rename_view_1.RenameView(usages);
        this.renameView.onInput((newName) => {
            void this.applyRename(usages, newName);
        });
    }
    /**
     * Rewrite every in-project usage. Edits within a file are applied from the
     * end of the buffer backwards, so earlier positions stay valid no matter how
     * the name's length changes - the old code tracked a per-line column offset
     * by hand and got it wrong whenever two usages shared a line out of order.
     */
    async applyRename(usages, newName) {
        const byFile = new Map();
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
            }));
            const buffer = editor.getBuffer();
            const ordered = [...fileUsages].sort((a, b) => b.line - a.line || b.column - a.column);
            for (const usage of ordered) {
                buffer.setTextInRange([
                    [usage.line - 1, usage.column],
                    [usage.line - 1, usage.column + usage.name.length]
                ], newName);
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
    async completeArguments(editor, bufferPosition, force) {
        if (!force && this.settings().useSnippets === 'none')
            return;
        if (!this.snippetsManager) {
            log.debug('No snippets service available; skipping argument completion');
            return;
        }
        const scopes = editor
            .scopeDescriptorForBufferPosition(bufferPosition)
            .getScopesArray();
        if ((0, scope_helpers_1.scopesMatchSelectors)(scopes, DISABLE_FOR_SELECTOR_PARSED)) {
            log.debug('Not completing arguments inside', scopes);
            return;
        }
        if (!(0, completion_rules_1.isArgumentCompletionSite)(editor.lineTextForBufferRow(bufferPosition.row) ?? '', bufferPosition.column)) {
            return;
        }
        const response = await this.daemon.send(this.buildRequest('arguments', editor, bufferPosition));
        if (!response.arguments)
            return;
        // The cursor may have moved while Jedi was thinking; re-check before
        // writing into the buffer.
        const current = editor.getCursorBufferPosition();
        if (current.row !== bufferPosition.row ||
            current.column !== bufferPosition.column) {
            log.debug('Discarding a stale argument completion');
            return;
        }
        this.snippetsManager.insertSnippet(response.arguments, editor);
    }
    // --- running ------------------------------------------------------------
    ensureRunPanel() {
        if (!this.runPanel) {
            this.runPanel = new run_panel_1.RunPanel(() => this.runner.stop(), (text) => this.runner.sendInput(text), () => this.runner.endInput());
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
    adjustOutputFontSize(delta) {
        const current = this.settings().outputFontSize;
        const base = current > 0 ? current : Number(atom.config.get('editor.fontSize')) || 14;
        const next = Math.min(72, Math.max(1, base + delta));
        atom.config.set('autocomplete-python-pulsar.outputFontSize', next);
    }
    /**
     * Bring the output pane into view. Opening the item is not enough when the
     * bottom dock itself is hidden, so show the dock too. Focus stays in the
     * editor: the user is running code, not reading yet.
     */
    async revealRunPanel() {
        this.ensureRunPanel();
        await atom.workspace.open(run_panel_1.RUN_PANEL_URI, {
            activatePane: false,
            activateItem: true,
            searchAllPanes: true
        });
        atom.workspace.getBottomDock().show();
    }
    /** The status bar button and its keybinding share this. */
    toggleRun() {
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
    async runActiveFile() {
        const editor = atom.workspace.getActiveTextEditor();
        if (!editor || !isPythonEditor(editor)) {
            atom_host_1.atomNotifier.warning('autocomplete-python-pulsar: no Python file is active.');
            return;
        }
        const settings = this.settings();
        if (settings.saveBeforeRun && editor.isModified()) {
            try {
                await editor.save();
            }
            catch (err) {
                // A read-only file or a full disk would otherwise reject the promise
                // that `toggleRun` fires and forgets, leaving the user with no output
                // and no idea the run never happened.
                atom_host_1.atomNotifier.error('autocomplete-python-pulsar could not save the file before running it.', { description: String(err), dismissable: true });
                return;
            }
        }
        const filePath = editor.getPath();
        if (!filePath) {
            atom_host_1.atomNotifier.warning('autocomplete-python-pulsar: save the file before running it.');
            return;
        }
        const interpreter = this.interpreters.bestPath();
        if (!interpreter) {
            atom_host_1.atomNotifier.warning('autocomplete-python-pulsar could not find a Python interpreter to run with.', {
                description: 'Run **Autocomplete Python Pulsar: Select Interpreter** and try again.',
                dismissable: true
            });
            return;
        }
        const panel = this.ensureRunPanel();
        if (settings.clearOutputOnRun)
            panel.clear();
        if (settings.showOutputOnRun) {
            // Keep focus in the editor: the user is running code, not reading yet.
            await this.revealRunPanel();
        }
        this.runner.run({
            interpreter,
            filePath,
            scriptArguments: (0, command_1.splitArguments)(settings.runArguments),
            projectPaths: atom.project.getPaths(),
            workingDirectory: settings.runWorkingDirectory
        });
    }
    /** The button is only meaningful while a Python file is in front. */
    refreshRunButton() {
        if (!this.runButton)
            return;
        const editor = atom.workspace.getActiveTextEditor();
        this.runButton.setVisible(Boolean(editor && isPythonEditor(editor)));
    }
    // --- diagnostics --------------------------------------------------------
    restartDaemon() {
        this.reloadDaemon();
        atom_host_1.atomNotifier.success('autocomplete-python-pulsar: completion daemon restarted.');
    }
    /**
     * Let the user pick an interpreter explicitly. The choice is stored in
     * `selectedInterpreter` and takes priority over every locator, which is what
     * makes a project with several candidate environments predictable.
     */
    async selectInterpreter() {
        void this.interpreterView?.destroy();
        const view = (this.interpreterView = (0, interpreter_view_1.createInterpreterView)((interpreter) => {
            atom.config.set('autocomplete-python-pulsar.selectedInterpreter', interpreter.filePath);
            this.reloadDaemon();
            atom_host_1.atomNotifier.success(`autocomplete-python-pulsar is now using ${interpreter.filePath}`);
        }));
        view.show();
        this.interpreters.invalidate();
        await view.setItems(this.interpreters.all());
    }
    refreshStatusView() {
        if (!this.statusView)
            return;
        const interpreter = this.interpreters.best();
        this.statusView.setText(interpreter ? this.interpreters.describe(interpreter) : 'no interpreter');
        this.statusTooltip?.dispose();
        this.statusTooltip = this.statusView.setTooltip(interpreter
            ? `autocomplete-python-pulsar: ${interpreter.filePath} (${locators_1.SOURCE_LABELS[interpreter.source]}). Click to change.`
            : 'autocomplete-python-pulsar found no Python interpreter. Click to choose one.');
    }
    /** Report the interpreter and Jedi version actually in use. */
    showEnvironment() {
        const chosen = this.interpreters.best();
        const all = this.interpreters.all();
        atom_host_1.atomNotifier.info('autocomplete-python-pulsar environment', {
            description: chosen
                ? `Using \`${chosen.filePath}\` (${locators_1.SOURCE_LABELS[chosen.source]}).`
                : 'No Python interpreter found.',
            detail: [
                `Jedi: ${this.daemon.runtime?.jedi ?? 'not reported yet'}`,
                `Python: ${this.daemon.runtime?.python ?? 'not reported yet'}`,
                '',
                'Candidates, in priority order:',
                ...all.map((entry, index) => `  ${index + 1}. [${locators_1.SOURCE_LABELS[entry.source]}] ${entry.filePath}`)
            ].join('\n'),
            dismissable: true
        });
    }
}
exports.PythonProvider = PythonProvider;
exports.default = new PythonProvider();
//# sourceMappingURL=provider.js.map