"""Turn Jedi results into the JSON-ready shapes the editor consumes.

Each function takes already-resolved Jedi objects and returns plain data, so
they can be tested with stand-ins and reused outside the daemon loop.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Iterable

from . import names

#: Marker method the editor injects to ask "what could this class override?".
OVERRIDE_PROBE_NAME = "__autocomplete_python"


@dataclass
class CallParam:
    """One parameter of the call the cursor sits inside."""

    signature: Any
    #: The bare parameter name. This is what goes into generated code, so it
    #: must never carry an annotation: `foo(x: int=1)` is a syntax error at a
    #: call site, even though `x: int=1` is how the parameter is *declared*.
    name: str
    #: The declaration as Jedi renders it, e.g. `x: int`. For display only.
    display: str
    #: The default as written, or ``None`` when the parameter is required.
    default: str | None


def call_signature_params(script: Any, line: int, column: int) -> list[CallParam]:
    """Named parameters of the call the cursor sits inside.

    Skips ``self`` and ``*args``/``**kwargs``, which cannot be filled in by
    name.
    """
    try:
        call_signatures = script.get_signatures(line, column)
    except Exception:
        return []

    results: list[CallParam] = []
    for signature in call_signatures:
        for position, param in enumerate(signature.params):
            if not names.is_completable_param(param, position):
                continue
            display, default = names.split_parameter(
                names.parameter_description(param)
            )
            if display.startswith("*"):
                continue
            results.append(
                CallParam(
                    signature=signature,
                    name=param.name,
                    display=display,
                    default=default,
                )
            )
    return results


def describe(definition: Any, show_doc_strings: bool) -> str:
    """The description column: a docstring, or a generated signature."""
    if show_doc_strings:
        try:
            return definition.docstring()
        except Exception:
            return ""
    return names.generate_signature(definition)


def completions(
    script: Any,
    line: int,
    column: int,
    *,
    show_doc_strings: bool = True,
    fuzzy_matcher: bool = False,
    prefix: str = "",
) -> list[dict[str, Any]]:
    """Keyword arguments for the enclosing call, then ordinary completions."""
    results: list[dict[str, Any]] = []

    for param in call_signature_params(script, line, column):
        if not fuzzy_matcher and not param.name.lower().startswith(prefix.lower()):
            continue
        completion: dict[str, Any] = {
            "type": "property",
            "rightLabel": names.statement_value(param.signature),
            "description": describe(param.signature, show_doc_strings),
        }
        if param.default:
            completion["snippet"] = f"{param.name}=${{1:{param.default}}}$0"
            completion["text"] = f"{param.name}={param.default}"
        else:
            completion["snippet"] = f"{param.name}=$1$0"
            completion["text"] = param.name
        # The annotation is worth showing but must not be inserted.
        completion["displayText"] = param.display
        results.append(completion)

    already_offered = {entry["text"].split("=")[0] for entry in results}

    try:
        jedi_completions = script.complete(line, column)
    except Exception:
        jedi_completions = []

    for completion in jedi_completions:
        if completion.name in already_offered:
            # Do not offer a keyword argument that is already listed above.
            continue
        results.append(
            {
                "text": completion.name,
                "type": names.definition_type(completion),
                "description": describe(completion, show_doc_strings),
                "rightLabel": names.statement_value(completion),
            }
        )
    return results


def arguments(
    script: Any, line: int, column: int, *, use_snippets: str | None
) -> str:
    """The snippet body filling in the arguments of the enclosing call.

    ``use_snippets='all'`` includes parameters that have defaults;
    ``'required'`` includes only those that do not.
    """
    seen: set[str] = set()
    parts: list[str] = []
    index = 1

    for param in call_signature_params(script, line, column):
        if param.name in seen:
            continue
        if not param.default:
            # A bare placeholder: if the user tabs past it without typing, the
            # result is still syntactically valid.
            part = f"${{{index}:{param.name}}}"
        elif use_snippets == "all":
            part = f"{param.name}=${{{index}:{param.default}}}"
        else:
            # `required` mode: skip parameters that already have a default.
            continue
        seen.add(param.name)
        parts.append(part)
        index += 1

    return ", ".join(parts) + "$0"


def methods(script: Any, line: int, column: int) -> list[dict[str, Any]]:
    """Methods a subclass could override, found by completing `self.`."""
    try:
        found = list(script.complete(line, column))
    except Exception:
        return []

    instance = "self.__class__"
    for completion in found:
        if completion.name == OVERRIDE_PROBE_NAME:
            try:
                instance = completion.parent().name
            except Exception:
                pass
            break

    results: list[dict[str, Any]] = []
    for completion in found:
        if completion.name == OVERRIDE_PROBE_NAME:
            # The probe itself is not a candidate.
            continue
        try:
            parent = completion.parent()
        except Exception:
            continue
        if parent is None or parent.type != "class":
            continue

        results.append(
            {
                "parent": parent.name,
                "instance": instance,
                "name": completion.name,
                "params": names.strip_implicit_first_param(
                    names.parameter_descriptions(completion)
                ),
                "moduleName": completion.module_name,
                "fileName": names.path_str(completion.module_path),
                "line": completion.line,
                "column": completion.column,
            }
        )
    return results


def definitions(found: Iterable[Any]) -> list[dict[str, Any]]:
    """Go-to-definition targets. Lines are converted to zero-based rows."""
    results: list[dict[str, Any]] = []
    for definition in found:
        if definition.type == "import":
            definition = names.follow_imports(definition)
        file_name = names.path_str(definition.module_path)
        if file_name is None:
            continue
        results.append(
            {
                "text": definition.name,
                "type": names.definition_type(definition),
                "fileName": file_name,
                "line": definition.line - 1,
                "column": definition.column,
            }
        )
    return results


def tooltip(found: Iterable[Any]) -> list[dict[str, Any]]:
    """At most one definition, carrying the text to show in the overlay."""
    for definition in found:
        if definition.type == "import":
            definition = names.follow_imports(definition)
        file_name = names.path_str(definition.module_path)
        if file_name is None:
            continue

        try:
            description = (definition.docstring() or "").strip()
        except Exception:
            description = ""
        if not description:
            description = names.statement_value(definition)

        return [
            {
                "text": definition.name,
                "type": names.definition_type(definition),
                "fileName": file_name,
                "description": description,
                "line": definition.line - 1,
                "column": definition.column,
            }
        ]
    return []


def highlights(script: Any) -> list[dict[str, Any]]:
    """Every name in the module, classified for semantic highlighting.

    Rows are converted to zero-based, matching ``markBufferRange``. Keywords are
    skipped: the editor's grammar already colors them, and this layer only
    refines identifiers (function vs class vs parameter vs builtin, and so on).
    Each span is the length of the bare name and never crosses a line.
    """
    try:
        found = script.get_names(
            all_scopes=True, definitions=True, references=True
        )
    except Exception:
        return []

    results: list[dict[str, Any]] = []
    for name in found:
        text = getattr(name, "name", "") or ""
        if not text or getattr(name, "type", None) == "keyword":
            continue
        highlight = names.highlight_type(name)
        # `variable` is the catch-all for statements, instances and references
        # Jedi did not resolve to anything specific. Leaving them to the grammar
        # keeps its own coloring instead of flattening every name to one color.
        if highlight == "variable":
            continue
        results.append(
            {
                "type": highlight,
                "line": name.line - 1,
                "column": name.column,
                "length": len(text),
            }
        )
    return results


def usages(found: Iterable[Any]) -> list[dict[str, Any]]:
    """Every reference to a name. Lines stay one-based, as Jedi reports them."""
    return [
        {
            "name": usage.name,
            "moduleName": usage.module_name,
            "fileName": names.path_str(usage.module_path),
            "line": usage.line,
            "column": usage.column,
        }
        for usage in found
    ]
