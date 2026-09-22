"""Readers for Jedi ``Name``/``Signature`` objects."""

from __future__ import annotations

import pathlib

import pytest

from acp_jedi import names

from conftest import FakeName, FakeParam, FakeSignature


class Exploding:
    """A definition whose accessors raise, as Jedi's occasionally do."""

    name = "boom"
    type = "function"

    def in_builtin_module(self):
        raise RuntimeError("no")

    def get_signatures(self):
        raise RuntimeError("no")

    def goto(self):
        raise RuntimeError("no")


# --- path_str -------------------------------------------------------------


def test_path_str_converts_a_path_object():
    assert names.path_str(pathlib.Path("/work/app.py")) == "/work/app.py"


def test_path_str_returns_none_for_a_definition_without_a_file():
    # `os.fspath(None)` raises TypeError, which used to escape as a raw
    # traceback for builtins. Upstream issues #453, #465.
    assert names.path_str(None) is None


# --- definition_type ------------------------------------------------------


def test_definition_type_maps_jedi_types_onto_autocomplete_icons():
    assert names.definition_type(FakeName(type="module")) == "import"
    assert names.definition_type(FakeName(type="instance")) == "variable"
    assert names.definition_type(FakeName(type="param")) == "variable"


def test_definition_type_passes_unmapped_types_through():
    assert names.definition_type(FakeName(type="function")) == "function"
    assert names.definition_type(FakeName(type="class")) == "class"


def test_definition_type_detects_builtins():
    assert names.definition_type(FakeName(type="function", builtin=True)) == "builtin"


def test_definition_type_does_not_call_an_import_a_builtin():
    assert names.definition_type(FakeName(type="import", builtin=True)) == "import"
    assert names.definition_type(FakeName(type="keyword", builtin=True)) == "keyword"


def test_definition_type_treats_an_uppercase_statement_as_a_constant():
    assert names.definition_type(FakeName(name="MAX", type="statement")) == "constant"
    assert names.definition_type(FakeName(name="total", type="statement")) == "value"


def test_definition_type_survives_an_accessor_that_raises():
    assert names.definition_type(Exploding()) == "function"


# --- highlight_type -------------------------------------------------------


def test_highlight_type_keeps_the_distinctions_worth_a_color():
    # Unlike definition_type, params and modules keep their own class.
    assert names.highlight_type(FakeName(type="param")) == "param"
    assert names.highlight_type(FakeName(type="module")) == "module"
    assert names.highlight_type(FakeName(type="function")) == "function"
    assert names.highlight_type(FakeName(type="class")) == "class"


def test_highlight_type_treats_an_import_binding_as_a_module():
    assert names.highlight_type(FakeName(type="import")) == "module"


def test_highlight_type_folds_the_plain_identifiers_into_variable():
    assert names.highlight_type(FakeName(type="statement")) == "variable"
    assert names.highlight_type(FakeName(type="instance")) == "variable"


def test_highlight_type_detects_builtins_and_constants():
    assert names.highlight_type(FakeName(type="function", builtin=True)) == "builtin"
    assert names.highlight_type(FakeName(name="MAX", type="statement")) == "constant"


def test_highlight_type_gives_self_and_cls_their_own_class():
    method = FakeName(type="function")
    assert (
        names.highlight_type(FakeName(name="self", type="param", parent_name=method))
        == "self"
    )
    assert (
        names.highlight_type(FakeName(name="cls", type="param", parent_name=method))
        == "self"
    )
    # An ordinary parameter keeps the plain param class.
    assert names.highlight_type(FakeName(name="value", type="param")) == "param"


def test_highlight_type_colors_self_references_in_the_body():
    # Jedi reports `self` used inside a method as an instance; it is colored to
    # match its param binding, while other instances stay plain variables.
    method = FakeName(type="function")
    assert (
        names.highlight_type(FakeName(name="self", type="instance", parent_name=method))
        == "self"
    )
    assert names.highlight_type(FakeName(name="obj", type="instance")) == "variable"


def test_highlight_type_leaves_a_module_level_self_alone():
    # `self` outside a method is an ordinary name; only a method binds the class.
    module = FakeName(type="module")
    assert (
        names.highlight_type(FakeName(name="self", type="instance", parent_name=module))
        == "variable"
    )
    assert (
        names.highlight_type(FakeName(name="self", type="param", parent_name=module))
        == "param"
    )


def test_highlight_type_marks_dunder_methods_as_magic():
    assert names.highlight_type(FakeName(name="__init__", type="function")) == "magic"
    assert names.highlight_type(FakeName(name="__doc__", type="property")) == "magic"
    # A plain method keeps the function class; a builtin dunder stays a builtin.
    assert names.highlight_type(FakeName(name="run", type="function")) == "function"
    assert (
        names.highlight_type(FakeName(name="__len__", type="function", builtin=True))
        == "builtin"
    )


def test_is_dunder_needs_more_than_the_underscores():
    assert names.is_dunder("__init__")
    assert not names.is_dunder("____")
    assert not names.is_dunder("_private")
    assert not names.is_dunder("plain")


def test_decorator_head_column_points_at_the_decorated_name():
    assert names.decorator_head_column("@deco") == 1
    assert names.decorator_head_column("    @deco") == 5
    # Whitespace after the @ is legal; the column follows it.
    assert names.decorator_head_column("@ deco") == 2
    # For a dotted decorator, only the head is placed.
    assert names.decorator_head_column("@app.route") == 1


def test_decorator_head_column_ignores_the_matrix_multiply_operator():
    # A binary `@` always has an operand before it, so the line never starts
    # with one - this is what keeps `a @ b` from being read as a decorator.
    assert names.decorator_head_column("a @ b") is None
    assert names.decorator_head_column("def f():") is None
    assert names.decorator_head_column("") is None


def test_decorator_span_covers_the_dotted_name_up_to_the_call():
    # A bare decorator runs to the end of the line.
    assert names.decorator_span("@app.route") == (1, 10)
    # With a call, the span stops at the paren so arguments are left out.
    assert names.decorator_span("@app.route('/')") == (1, 10)
    assert names.decorator_span("a @ b") is None


def test_highlight_type_survives_an_accessor_that_raises():
    # in_builtin_module() raises; the builtin check swallows it and the type
    # still resolves.
    assert names.highlight_type(Exploding()) == "function"


# --- parameters -----------------------------------------------------------


@pytest.mark.parametrize(
    "description,expected",
    [
        ("param x", "x"),
        ("param x: int", "x: int"),
        ("param  y=3", "y=3"),
        ("z", "z"),
    ],
)
def test_parameter_description_strips_the_param_prefix(description, expected):
    assert names.parameter_description(FakeParam(description)) == expected


@pytest.mark.parametrize(
    "description,expected",
    [
        ("x", ("x", None)),
        ("x=3", ("x", "3")),
        ("x: int", ("x: int", None)),
        # Annotated parameter with a default: the old `split('=')` raised
        # ValueError as soon as a second `=` appeared.
        ("x: int=3", ("x: int", "3")),
        ('y: str="a=b"', ("y: str", '"a=b"')),
    ],
)
def test_split_parameter_separates_name_from_default(description, expected):
    assert names.split_parameter(description) == expected


def test_parameter_descriptions_reads_the_first_signature():
    definition = FakeName(
        signatures=[
            FakeSignature(params=[FakeParam("param self"), FakeParam("param x: int")])
        ]
    )
    assert names.parameter_descriptions(definition) == ["self", "x: int"]


def test_parameter_descriptions_is_empty_without_a_signature():
    assert names.parameter_descriptions(FakeName()) == []


@pytest.mark.parametrize(
    "params,expected",
    [
        (["self", "x"], ["x"]),
        (["cls", "x"], ["x"]),
        (["self: Foo", "x"], ["x"]),
        (["x", "y"], ["x", "y"]),
        ([], []),
        (["selfish", "x"], ["selfish", "x"]),
    ],
)
def test_strip_implicit_first_param(params, expected):
    assert names.strip_implicit_first_param(params) == expected


# --- signatures -----------------------------------------------------------


def test_signatures_returns_an_empty_list_when_the_call_raises():
    assert names.signatures(Exploding()) == []


def test_generate_signature_renders_the_parameter_list():
    definition = FakeName(
        name="connect",
        signatures=[
            FakeSignature(params=[FakeParam("param host"), FakeParam("param port=80")])
        ],
    )
    assert names.generate_signature(definition) == "connect(host, port=80)"


def test_generate_signature_is_empty_for_a_module():
    assert names.generate_signature(FakeName(name="os", type="module")) == ""


def test_generate_signature_is_empty_without_a_signature():
    assert names.generate_signature(FakeName(name="x", type="statement")) == ""


def test_generate_signature_handles_a_zero_argument_callable():
    definition = FakeName(name="run", signatures=[FakeSignature(params=[])])
    assert names.generate_signature(definition) == "run()"


# --- statement_value ------------------------------------------------------


def test_statement_value_returns_the_right_hand_side():
    definition = FakeName(type="statement", description="total = 41 + 1")
    assert names.statement_value(definition) == "41 + 1"


def test_statement_value_collapses_newlines():
    definition = FakeName(type="statement", description="data = [\n1,\n2]")
    assert names.statement_value(definition) == "[1,2]"


def test_statement_value_is_empty_for_other_types():
    assert names.statement_value(FakeName(type="function", description="f()")) == ""


def test_statement_value_is_empty_without_an_assignment():
    assert names.statement_value(FakeName(type="statement", description="total")) == ""


# --- parameter eligibility ------------------------------------------------


def test_is_completable_param_skips_a_leading_self():
    assert names.is_completable_param(FakeParam("param self"), 0) is False
    # `self` elsewhere in the list is an ordinary parameter name.
    assert names.is_completable_param(FakeParam("param self"), 1) is True


class _Param:
    """A parameter with an arbitrary name, bypassing FakeParam's inference."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.description = f"param {name}"


def test_is_completable_param_requires_a_word_character():
    assert names.is_completable_param(_Param("x"), 0) is True
    # Jedi reports unnamed and star parameters that cannot be filled by name.
    assert names.is_completable_param(_Param(""), 0) is False
    assert names.is_completable_param(_Param("*"), 0) is False
    assert names.is_completable_param(_Param("/"), 0) is False


# --- follow_imports -------------------------------------------------------


def test_follow_imports_returns_the_first_real_target():
    target = FakeName(name="real", type="function")
    alias = FakeName(name="alias", type="import", goto_targets=[target])
    assert names.follow_imports(alias) is target


def test_follow_imports_walks_a_chain_of_imports():
    final = FakeName(name="final", type="class")
    middle = FakeName(name="middle", type="import", goto_targets=[final])
    first = FakeName(name="first", type="import", goto_targets=[middle])
    assert names.follow_imports(first) is final


def test_follow_imports_skips_a_self_reference():
    definition = FakeName(name="self_ref", type="import")
    definition.goto_targets = [definition]
    assert names.follow_imports(definition) is definition


def test_follow_imports_returns_the_input_when_goto_raises():
    definition = Exploding()
    assert names.follow_imports(definition) is definition
