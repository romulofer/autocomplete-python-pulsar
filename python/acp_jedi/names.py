"""Helpers for reading Jedi ``Name`` and ``Signature`` objects.

Everything here is duck-typed on purpose: no Jedi import, only the handful of
public attributes this package relies on. That keeps the rules about how a
definition becomes a suggestion in one place, and makes them testable with plain
stand-in objects.
"""

from __future__ import annotations

import os
import re
from typing import Any

WORD_RE = re.compile(r"\w")
PARAM_PREFIX_RE = re.compile(r"^param\s+")

#: Jedi ``type`` values mapped onto the icon names autocomplete-plus understands.
BASIC_TYPES = {
    "module": "import",
    "instance": "variable",
    "statement": "value",
    "param": "variable",
}

#: Parameter names a subclass template supplies itself.
IMPLICIT_FIRST_PARAMS = ("self", "cls")


def path_str(module_path: Any) -> str | None:
    """Jedi returns a ``pathlib.Path`` or ``None``; JSON wants a string or null.

    ``os.fspath(None)`` raises ``TypeError``, which used to escape as a raw
    traceback whenever a definition had no backing file - a builtin, for
    instance. Upstream issues #453, #465.
    """
    if module_path is None:
        return None
    return os.fspath(module_path)


def definition_type(definition: Any) -> str:
    """The suggestion icon to use for a definition."""
    try:
        is_built_in = definition.in_builtin_module()
    except Exception:
        is_built_in = False
    if definition.type not in ("import", "keyword") and is_built_in:
        return "builtin"
    if definition.type == "statement" and definition.name.isupper():
        return "constant"
    return BASIC_TYPES.get(definition.type, definition.type)


#: Jedi ``type`` values that map straight onto a highlight class.
HIGHLIGHT_TYPES = {"function", "class", "param", "module", "property"}


def is_dunder(text: str) -> bool:
    """A ``__name__`` special method or attribute, e.g. ``__init__``.

    Requires more than the two pairs of underscores themselves, so ``____`` is
    not mistaken for one.
    """
    return len(text) > 4 and text.startswith("__") and text.endswith("__")


def decorator_head_column(line: str) -> int | None:
    """Column of the identifier a decorator line applies, or ``None``.

    A decorator is an ``@`` that opens a logical line, so only a line whose first
    non-space character is ``@`` qualifies - this deliberately ignores the binary
    ``@`` matrix-multiply operator in ``a @ b``, which always has an operand
    before it. The column returned points at the first identifier of the
    decorator expression (``app`` in ``@app.route``), which is the only name this
    can place with certainty.
    """
    stripped = line.lstrip()
    if not stripped.startswith("@"):
        return None
    column = len(line) - len(stripped) + 1
    while column < len(line) and line[column] == " ":
        column += 1
    return column


def decorator_span(line: str) -> tuple[int, int] | None:
    """The ``[start, end)`` columns covering a decorator expression, or ``None``.

    Spans the dotted name after ``@`` up to the call paren, so every part of
    ``@app.route`` is placed as a decorator while the arguments in
    ``@app.route("/")`` are left to their own classification.
    """
    start = decorator_head_column(line)
    if start is None:
        return None
    paren = line.find("(", start)
    return start, paren if paren != -1 else len(line)


def in_function_scope(name: Any) -> bool:
    """Whether a name is declared directly inside a function (a method body).

    Used to keep the ``self`` class honest: ``self``/``cls`` only mean the
    instance when they sit in a method, so a module-level variable that happens
    to be named ``self`` is not miscolored.
    """
    try:
        parent = name.parent()
    except Exception:
        return False
    return getattr(parent, "type", None) == "function"


def highlight_type(name: Any) -> str:
    """The highlight class for a name, tuned for coloring rather than icons.

    Unlike :func:`definition_type` - which serves autocomplete icons and so
    folds ``param`` into ``variable`` and ``module`` into ``import`` - this keeps
    the distinctions that are worth a color of their own. The implicit first
    parameters ``self`` and ``cls`` get their own ``self`` class, since most
    themes color them apart from ordinary parameters; their references inside the
    method body - which Jedi reports as instances - are colored to match, so the
    name reads the same wherever it appears. Dunder methods (``__init__`` and the
    like) get the ``magic`` class. Everything it cannot place (statements, other
    instances, unresolved references) becomes ``variable``, the plain-identifier
    class.
    """
    name_type = getattr(name, "type", None)
    name_text = getattr(name, "name", "") or ""
    try:
        is_built_in = name.in_builtin_module()
    except Exception:
        is_built_in = False

    if name_type not in ("import", "keyword") and is_built_in:
        return "builtin"
    if name_type == "statement" and name_text.isupper():
        return "constant"
    if name_type == "import":
        return "module"
    # The `param` binding and its `instance` references share the `self` class so
    # `self`/`cls` reads the same at the definition and everywhere it is used -
    # but only inside a method, so a module-level `self` is left alone.
    if (
        name_type in ("param", "instance")
        and name_text in IMPLICIT_FIRST_PARAMS
        and in_function_scope(name)
    ):
        return "self"
    if name_type in ("function", "property") and is_dunder(name_text):
        return "magic"
    if name_type in HIGHLIGHT_TYPES:
        return name_type
    return "variable"


def signatures(definition: Any) -> list[Any]:
    """Signatures of a definition, or an empty list when it has none.

    Jedi 0.18 removed ``Name.params``; ``get_signatures()`` replaced it. The old
    code still probed for ``params`` with ``hasattr``, so from Jedi 0.18 onwards
    every parameter list silently came back empty. Upstream issues #445, #451.
    """
    try:
        return list(definition.get_signatures())
    except Exception:
        return []


def parameter_description(param: Any) -> str:
    """`param x: int=3` -> `x: int=3`."""
    return PARAM_PREFIX_RE.sub("", param.description or "").strip()


def split_parameter(description: str) -> tuple[str, str | None]:
    """Split `x: int=3` into its name (annotation included) and its default.

    ``partition`` rather than ``split``: an annotated parameter with a default
    contains two ``=``-free halves but a ``:`` as well, and the old
    ``split('=')`` raised ``ValueError`` on anything with more than one ``=``.
    """
    name, separator, value = description.partition("=")
    if not separator:
        return description.strip(), None
    return name.strip(), value.strip()


def parameter_descriptions(definition: Any) -> list[str]:
    """Parameter descriptions of a definition's first signature."""
    found = signatures(definition)
    if not found:
        return []
    return [parameter_description(param) for param in found[0].params]


def strip_implicit_first_param(params: list[str]) -> list[str]:
    """Drop a leading `self`/`cls`; the override template adds its own."""
    if not params:
        return params
    first = params[0].split(":")[0].split("=")[0].strip()
    return params[1:] if first in IMPLICIT_FIRST_PARAMS else params


def generate_signature(definition: Any) -> str:
    """`name(arg, other=3)`, or an empty string when there is no signature."""
    if getattr(definition, "type", None) == "module":
        return ""
    params = parameter_descriptions(definition)
    if not params and not signatures(definition):
        return ""
    return "{}({})".format(definition.name, ", ".join(params))


def statement_value(definition: Any) -> str:
    """The right-hand side of a statement, used as the suggestion's right label.

    Read from the public ``description`` rather than from Jedi's private parser
    nodes, which the old implementation reached into and which no longer exist.
    """
    if getattr(definition, "type", None) != "statement":
        return ""
    description = getattr(definition, "description", "") or ""
    _, separator, value = description.partition("=")
    return value.strip().replace("\n", "") if separator else ""


def is_completable_param(param: Any, position: int) -> bool:
    """Whether a parameter can be filled in by name at a call site."""
    if not param.name:
        return False
    if param.name == "self" and position == 0:
        return False
    return WORD_RE.match(param.name) is not None


def follow_imports(definition: Any) -> Any:
    """Follow a chain of imports to the definition that declares the name."""
    try:
        targets = definition.goto()
    except Exception:
        return definition
    for target in targets:
        if target == definition:
            continue
        if target.type == "import":
            return follow_imports(target)
        return target
    return definition
