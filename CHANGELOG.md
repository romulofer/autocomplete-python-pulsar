# Changelog

## 2.5.1

### Changed

- **Semantic highlighting only accents what Jedi resolves specifically** -
  functions, classes, parameters, builtins, constants and modules. Plain and
  unresolved identifiers are left to the grammar instead of being recolored to a
  single flat color, so the result adds information rather than washing the
  buffer out.

### Added

- **Toggle Semantic Highlighting** command and menu item
  (`autocomplete-python-pulsar:toggle-semantic-highlighting`, under **Packages →
  Autocomplete Python**), flipping the setting without opening the settings pane.

## 2.5.0

### Added

- **Semantic highlighting.** A new **Semantic Highlighting** setting (off by
  default) recolors identifiers by what Jedi resolves them to be - function,
  class, parameter, builtin, constant, module - layered on top of the grammar,
  which keeps coloring keywords, strings and numbers. Highlights refresh shortly
  after you stop typing and are skipped in very large files. Needs a working
  interpreter, the same as completions. The palette lives in the package
  stylesheet and can be overridden per theme.

## 2.4.4

### Added

- **Output font size from the menu.** **Packages → Autocomplete Python → Output
  Font Size** now has **Increase**, **Decrease** and **Reset (follow editor)**,
  backed by the `autocomplete-python-pulsar:increase-output-font-size`,
  `decrease-output-font-size` and `reset-output-font-size` commands. Each step
  writes the **Run: Output Font Size** setting, so the change sticks and applies
  to the pane immediately. Increasing from the default grows from the editor
  font size.

## 2.4.3

### Fixed

- **A failed run no longer passes unnoticed.** When a script ended with a
  non-zero exit code - a `SyntaxError`, an uncaught exception, `sys.exit(1)` -
  the traceback went only to the output pane. With "Show Output On Run" turned
  off, or after the pane was closed, the failure was silent: the run button
  simply went idle and nothing said the script had crashed. The output pane is
  now revealed on any non-zero exit, so the error is always shown.

### Added

- **Output pane font size.** A new **Run: Output Font Size (pixels)** setting
  sets the font size of the run output pane independently of the editor. Set it
  to 0 to keep following the editor font size. Changes apply immediately.

## 2.4.1

### Added

- **Interpreter discovery reads a script's shebang.** A `.py` file at a project
  root whose `#!` line names an absolute path to a Python executable is now
  offered as an interpreter, ranked below a workspace virtual environment and
  above the tool-managed caches (Poetry, Pipenv, pyenv, Conda). A
  `#!/usr/bin/env python` shebang defers to `PATH` and is ignored, as is a
  relative path or one naming a missing interpreter. Upstream issue #270.

### Notes

- Confirmed and now covered by end-to-end tests: argument completion for class
  construction from `__init__` (including an inherited or dataclass `__init__`),
  go-to-definition on async methods, and argument completion for
  `@staticmethod`, `@classmethod` and `functools.wraps`-decorated methods.
  Upstream issues #406, #230, #340. Upstream #233 (huge memory) does not
  reproduce on Jedi 0.19/0.20: resident memory plateaus in the tens of MB across
  thousands of requests.

## 2.2.0

### Added

- **Send input to a running script.** The Python Output pane now has an input
  field while a script is running: type a line, press Enter, and it is fed to the
  script's stdin and echoed into the transcript. The **EOF** button closes stdin
  so a script reading to end-of-input can finish. Scripts that call `input()` or
  read `sys.stdin` are now usable from the pane rather than appearing to hang.

### Fixed

- **Run arguments quote the way a shell does.** A quote that opened partway
  through a word, as in `--name="a b"` or `--json='{"k": 1}'`, used to be cut at
  the space and handed to the script as two broken arguments. The quoted and
  unquoted halves of a word now stay one argument, an unbalanced quote runs to
  the end rather than being dropped, and an explicitly empty `""` is kept.
- **A failed save no longer swallows the run.** With `saveBeforeRun` on, a save
  that failed (a read-only file, a full disk) left the run silently abandoned
  with no output and no message. The failure is now reported and the run stops.
- **Completing a top-level name no longer drops its first character.** The
  cursor rewind that lets one Jedi lookup serve a whole identifier assumed a
  leading dot, so completing a bare name like `getcwd` looked it up on the wrong
  prefix.

## 2.1.0

### Added

- **Run the current file** with the interpreter the package discovered, from a
  button in the status bar, `F5`, the context menu, or
  `autocomplete-python-pulsar:run-file`. Running it from here rather than from a
  generic task runner means the script runs in the same environment the
  completions came from.
- **A Python Output pane** in the bottom dock: stdout and stderr as the script
  produces them, with the command, the working directory and the exit code in
  the header. Output is unbuffered, and the pane keeps the last 5000 lines.
- **Stop**, from the same status bar button while a script is running, from the
  pane, or with `Shift+F5`. Starting a run while one is going stops the old one
  first. A script that ignores `SIGTERM` is killed after two seconds.
- Settings: `runArguments`, `runWorkingDirectory` (`file` or `project`),
  `saveBeforeRun`, `clearOutputOnRun` and `showOutputOnRun`.

Scripts are spawned directly with no shell involved, so nothing in
`runArguments` is interpreted as a shell operator.

## 2.0.0

A rewrite for Pulsar and modern Python. See
[docs/MIGRATION.md](docs/MIGRATION.md) for what this means if you are coming
from 1.17, and [docs/UPSTREAM-ISSUES.md](docs/UPSTREAM-ISSUES.md) for how the
inherited issue backlog was triaged.

### Removed

- **Kite integration, entirely.** Kite shut down in 2022 and its servers no
  longer exist. The `useKite` setting, the installer flow and the
  `kite-installer` dependency are gone.
- **All telemetry.** The `mixpanel` dependency went with Kite. The package now
  sends nothing anywhere.
- **Touch Bar support.** It relied on Electron's `remote` module, which modern
  Pulsar does not expose.
- **Python 2 support.** Python 3.10 or newer is now required.
- Dependencies: `kite-installer`, `mixpanel`, `space-pen`,
  `atom-space-pen-views`, `atom-slick`, `selector-kit`, `underscore`. Only
  `atom-select-list` and `fuzzaldrin-plus` remain.

### Added

- **Interpreter picker** (`autocomplete-python-pulsar:select-interpreter`) listing every
  environment found, labelled by where it came from.
- **Status bar entry** showing the active environment. Click it to change.
- **`autocomplete-python-pulsar:show-environment`**, reporting the interpreter, how it
  was found, the Jedi version in use, and every other candidate in priority
  order.
- **`autocomplete-python-pulsar:restart-daemon`.**
- **Broad interpreter discovery**, modelled on the VS Code Python extension:
  Poetry, Pipenv, pyenv (honouring `.python-version`), Conda, virtualenvwrapper,
  project virtual environments, `VIRTUAL_ENV`/`CONDA_PREFIX`, and `PATH`.
- **`daemonIdleTimeout` setting** controlling when the Python process is shut
  down after inactivity.
- **Actionable startup errors.** A missing interpreter, a missing Jedi, or a Jedi
  that is too old now produce a notification telling you what to run, instead of
  a raw traceback.
- Context menu and Packages menu entries for every command.

### Fixed

- Parameter lists are read from `get_signatures()`. Jedi 0.18 removed
  `Name.params`, which silently emptied every parameter list from 1.17 onward.
  (upstream #445, #451, #449, #450, #463)
- Request ids use SHA-256 instead of MD5, which is unavailable when OpenSSL runs
  in FIPS mode. (upstream #432)
- Daemon output is buffered and framed on newlines, so a response split across
  two chunks no longer throws `Failed to parse JSON from ...`. Lines that are
  not JSON are skipped instead of taking down the response stream. (upstream
  #354, #366)
- Anything a project module prints while Jedi imports it is discarded rather
  than corrupting the response stream.
- An interpreter must be an executable regular file, so a directory named
  `python` on `PATH` no longer hangs the editor. (upstream #251)
- `$PROJECT` and `$PROJECT_NAME` expand the original template once per project
  root. With two roots open, the second is no longer substituted into an
  already-resolved path. (upstream #312)
- Argument snippets use the bare parameter name. An annotated parameter with a
  default previously produced `foo(x: int=1)`, a syntax error at a call site.
- Argument completion watches the buffer instead of listening for the `^(`
  keystroke, so it works on every keyboard layout. (upstream #416, #455, #465)
- Override method generates `super().method(...)` rather than
  `super(Class, self).method(...)` with a guessed class name. (upstream #186)
- The injected `__autocomplete_python` probe no longer appears in the override
  list, and `self` is stripped from the parameters it reports.
- Rename applies edits from the end of each file backwards, fixing corrupted
  output when two usages shared a line.
- Definitions without a backing file, such as builtins, no longer raise
  `TypeError` from `os.fspath(None)`. (upstream #453, #465)
- Daemon streams are forced to UTF-8, so non-ASCII paths and sources no longer
  raise `UnicodeEncodeError`. (upstream #377)
- The idle timeout no longer kills a daemon that is in active use, and requests
  time out after 15 seconds instead of hanging. (upstream #439, #409)
- `Regex To Trigger Autocompletions` applies immediately, without restarting the
  editor.
- `sys.path` is restored from a copy on every request, so one project's extra
  paths cannot leak into the next.
- The package activates only once a Python file is opened. (upstream #331)

### Changed

- Source is TypeScript in `src/`, compiled to `dist/`. `dist/` is committed
  because `ppm` installs the git tag without building.
- The Python backend is a package, `python/acp_jedi/`, behind the
  `python/completion.py` entry point.
- Views use `atom-select-list` instead of the jQuery-based
  `atom-space-pen-views`.
- Scope matching is done directly instead of through a CSS selector engine.
- Requires Pulsar 1.100+, Python 3.10+, Jedi 0.19+.

### Internal

- Test suites where there were none: 116 TypeScript tests (`bun test`) and 142
  Python tests (`pytest`), including end-to-end coverage that spawns the real
  daemon against a real Jedi.
- Interpreter discovery runs against an in-memory filesystem in tests, so the
  Windows layout is covered from any platform.
- `docs/` covers the architecture, configuration, troubleshooting, migration and
  the upstream issue triage. `AGENTS.md` documents the rules for AI agents.

## 1.17.1 and earlier

See the
[upstream releases](https://github.com/autocomplete-python/autocomplete-python/releases).
