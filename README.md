# autocomplete-python-pulsar

Python IDE features for [Pulsar](https://pulsar-edit.dev), powered by
[Jedi](https://github.com/davidhalter/jedi): completions, go-to-definition,
find usages, project-wide rename, method override and argument snippets.

A rewrite of the original Atom `autocomplete-python` for Pulsar. The Kite
integration and its telemetry are gone, the CoffeeScript is now TypeScript, and
the Jedi backend targets the modern API. See [CHANGELOG.md](CHANGELOG.md) for
what changed and [docs/MIGRATION.md](docs/MIGRATION.md) if you are coming from
1.x.

> Published as **autocomplete-python-pulsar**. The original
> `autocomplete-python` name still points at the unmaintained Atom package.

## Requirements

- Pulsar 1.100 or newer
- Python 3.10 or newer
- Jedi 0.19 or newer, installed for the interpreter you want completions from:

```sh
python3 -m pip install --upgrade "jedi>=0.19"
```

The package tells you which interpreter it picked, and says so plainly if Jedi
is missing from it.

## Install

```sh
ppm install autocomplete-python-pulsar
```

## Features

- **Completions** for modules, classes, functions, methods and variables, with
  docstrings and signatures.
- **Function argument completion**: type `(` and get a snippet of the
  parameters, tab-navigable. Off by default; see `Autocomplete Function
  Parameters`.
- **Go to definition**: `Ctrl+Alt+G` (`Alt+Cmd+G` on macOS), or Ctrl/Cmd-click
  with the [hyperclick](https://web.pulsar-edit.dev/packages/hyperclick) package
  installed.
- **Show usages** of the symbol under the cursor, across the project.
- **Rename** a symbol across every file in the project.
- **Override method**: pick an inherited method and get a correct
  `super()`-calling stub.
- **Tooltips** showing the docstring of the symbol under the cursor. Off by
  default.
- **Semantic highlighting**: recolor identifiers by what Jedi knows them to be -
  function, class, parameter, builtin, constant, module - layered over the
  grammar. Off by default; see `Semantic Highlighting`.
- **Run button** in the status bar: run the current file with the interpreter
  the package discovered, with output in a dock pane. `F5`, or click the button
  again to stop. The pane takes stdin, so scripts that call `input()` work.
- **Interpreter picker** in the status bar, listing every environment found.

## Choosing an interpreter

Most of the time there is nothing to configure. The package looks for
interpreters the way the VS Code Python extension does, in this order:

1. The interpreter you picked with **Autocomplete Python Pulsar: Select Interpreter**
2. `Python Executable Paths` from the settings
3. `VIRTUAL_ENV` / `CONDA_PREFIX`: the environment Pulsar was launched from
4. Virtual environments inside your project (`.venv`, `venv`, `env`, or any
   directory with a `pyvenv.cfg`)
5. Poetry, Pipenv, pyenv (honouring `.python-version`), Conda, virtualenvwrapper
6. `PATH`
7. Well-known system locations

Whichever it picked is shown in the status bar. Click it to choose another, or
run **Autocomplete Python Pulsar: Show Environment** to see the full list and the Jedi
version in use.

Full details in [docs/CONFIGURATION.md](docs/CONFIGURATION.md).

## Commands

| Command | Default binding |
| --- | --- |
| `autocomplete-python-pulsar:run-file` | `F5`, `Ctrl+Alt+R` / `Alt+Cmd+R` |
| `autocomplete-python-pulsar:stop` | `Shift+F5` |
| `autocomplete-python-pulsar:toggle-output` | none |
| `autocomplete-python-pulsar:go-to-definition` | `Ctrl+Alt+G` / `Alt+Cmd+G` |
| `autocomplete-python-pulsar:show-usages` | none |
| `autocomplete-python-pulsar:rename` | none |
| `autocomplete-python-pulsar:override-method` | none |
| `autocomplete-python-pulsar:complete-arguments` | none |
| `autocomplete-python-pulsar:select-interpreter` | none |
| `autocomplete-python-pulsar:show-environment` | none |
| `autocomplete-python-pulsar:restart-daemon` | none |

## Something not working?

Start with **Autocomplete Python Pulsar: Show Environment**: it reports the
interpreter and the Jedi version actually in use, which answers most
reports. [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) covers the rest.

## Contributing

`CONTRIBUTING.md` has the setup, and
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit
together.

```sh
npm install          # TypeScript toolchain
npm run build        # src/*.ts -> dist/
npm test             # typecheck + TypeScript tests + Python tests
```

## Support

If this saves you time, you can
[buy me a coffee](https://buymeacoffee.com/legendaryredfox).

## Credits

Originally written by [Dmitry Sadovnychyi](https://github.com/sadovnychyi) and
contributors, as `autocomplete-python` for Atom. Completions come from
[Jedi](https://github.com/davidhalter/jedi) by David Halter.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
