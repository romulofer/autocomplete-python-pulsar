"""Jedi results in, JSON-ready data out."""

from __future__ import annotations

import pathlib

from acp_jedi import serializers

from conftest import ExplodingScript, FakeName, FakeParam, FakeScript, FakeSignature


def signature(*descriptions: str) -> FakeSignature:
    return FakeSignature(params=[FakeParam(d) for d in descriptions])


class DocstringRaises(FakeName):
    """A name whose ``docstring()`` blows up, as a C extension's can."""

    def docstring(self) -> str:
        raise RuntimeError("docstring exploded")


class ParentRaises(FakeName):
    """A name whose ``parent()`` blows up while resolving the class."""

    def parent(self) -> FakeName | None:
        raise RuntimeError("parent exploded")


# --- call_signature_params ------------------------------------------------


def test_call_signature_params_returns_name_and_default():
    script = FakeScript(signatures=[signature("param host", "param port=80")])
    found = serializers.call_signature_params(script, 1, 0)
    assert [(param.name, param.default) for param in found] == [
        ("host", None),
        ("port", "80"),
    ]


def test_call_signature_params_skips_self_and_star_args():
    script = FakeScript(
        signatures=[signature("param self", "param x", "param *args", "param **kw")]
    )
    found = serializers.call_signature_params(script, 1, 0)
    assert [param.name for param in found] == ["x"]


def test_call_signature_params_is_empty_when_jedi_raises():
    assert serializers.call_signature_params(ExplodingScript(), 1, 0) == []


def test_call_signature_params_skips_a_star_arg_jedi_still_names():
    # Jedi names a ``*args`` parameter ``args``, so it passes the word test in
    # is_completable_param; the star only shows up in the description. It still
    # cannot be filled in by name, so the display-level guard must drop it.
    script = FakeScript(signatures=[FakeSignature(params=[FakeParam("param *args", name="args")])])
    assert serializers.call_signature_params(script, 1, 0) == []


# --- completions ----------------------------------------------------------


def test_completions_offers_keyword_arguments_first():
    script = FakeScript(
        signatures=[signature("param host", "param port=80")],
        completions=[FakeName(name="something", type="function")],
    )
    results = serializers.completions(script, 1, 0, fuzzy_matcher=True)

    assert results[0]["text"] == "host"
    assert results[0]["type"] == "property"
    assert results[-1]["text"] == "something"


def test_call_signature_params_keeps_the_annotation_out_of_the_name():
    # `foo(x: int=1)` is a syntax error at a call site, so the name used in
    # generated code must be bare; the annotation is display-only.
    script = FakeScript(signatures=[signature("param punctuation: str=\"!\"")])
    param = serializers.call_signature_params(script, 1, 0)[0]

    assert param.name == "punctuation"
    assert param.display == "punctuation: str"
    assert param.default == '"!"'


def test_arguments_never_emits_an_annotation():
    script = FakeScript(signatures=[signature("param x: int", "param y: str=\"a\"")])
    snippet = serializers.arguments(script, 1, 0, use_snippets="all")
    assert snippet == '${1:x}, y=${2:"a"}$0'


def test_completions_builds_a_snippet_for_each_keyword_argument():
    script = FakeScript(signatures=[signature("param host", "param port=80")])
    results = serializers.completions(script, 1, 0, fuzzy_matcher=True)

    assert results[0]["snippet"] == "host=$1$0"
    assert results[0]["displayText"] == "host"
    assert results[1]["snippet"] == "port=${1:80}$0"
    assert results[1]["text"] == "port=80"


def test_completions_filters_keyword_arguments_by_prefix_without_fuzzy_matching():
    script = FakeScript(signatures=[signature("param host", "param port=80")])
    results = serializers.completions(
        script, 1, 0, fuzzy_matcher=False, prefix="po"
    )
    assert [entry["text"] for entry in results] == ["port=80"]


def test_completions_keeps_every_keyword_argument_when_fuzzy_matching():
    # The editor filters locally in this mode, so the daemon must not pre-filter.
    script = FakeScript(signatures=[signature("param host", "param port=80")])
    results = serializers.completions(
        script, 1, 0, fuzzy_matcher=True, prefix="zzz"
    )
    assert len(results) == 2


def test_completions_does_not_repeat_a_name_already_offered_as_a_keyword():
    script = FakeScript(
        signatures=[signature("param host")],
        completions=[FakeName(name="host"), FakeName(name="other")],
    )
    results = serializers.completions(script, 1, 0, fuzzy_matcher=True)
    assert [entry["text"] for entry in results] == ["host", "other"]


def test_completions_uses_docstrings_when_asked():
    script = FakeScript(
        completions=[FakeName(name="run", _docstring="Run the thing.")]
    )
    results = serializers.completions(script, 1, 0, show_doc_strings=True)
    assert results[0]["description"] == "Run the thing."


def test_completions_uses_a_generated_signature_when_docstrings_are_off():
    script = FakeScript(
        completions=[
            FakeName(
                name="run",
                _docstring="Run the thing.",
                signatures=[signature("param times=1")],
            )
        ]
    )
    results = serializers.completions(script, 1, 0, show_doc_strings=False)
    assert results[0]["description"] == "run(times=1)"


def test_completions_shows_a_statement_value_as_the_right_label():
    script = FakeScript(
        completions=[FakeName(name="total", type="statement", description="total = 42")]
    )
    results = serializers.completions(script, 1, 0)
    assert results[0]["rightLabel"] == "42"


def test_completions_is_empty_when_jedi_raises():
    assert serializers.completions(ExplodingScript(), 1, 0) == []


def test_describe_returns_empty_when_the_docstring_raises():
    # A completion source can raise from docstring(); the description column must
    # still resolve rather than take the request down.
    script = FakeScript(completions=[DocstringRaises(name="run")])
    results = serializers.completions(script, 1, 0, show_doc_strings=True)
    assert results[0]["description"] == ""


# --- arguments ------------------------------------------------------------


def test_arguments_fills_required_parameters_only_by_default():
    script = FakeScript(signatures=[signature("param x", "param y=3")])
    assert (
        serializers.arguments(script, 1, 0, use_snippets="required")
        == "${1:x}$0"
    )


def test_arguments_includes_defaults_in_all_mode():
    script = FakeScript(signatures=[signature("param x", "param y=3")])
    assert (
        serializers.arguments(script, 1, 0, use_snippets="all")
        == "${1:x}, y=${2:3}$0"
    )


def test_arguments_numbers_tab_stops_consecutively():
    script = FakeScript(signatures=[signature("param a", "param b", "param c")])
    assert (
        serializers.arguments(script, 1, 0, use_snippets="all")
        == "${1:a}, ${2:b}, ${3:c}$0"
    )


def test_arguments_deduplicates_overloaded_parameter_names():
    script = FakeScript(
        signatures=[signature("param x"), signature("param x", "param y")]
    )
    assert (
        serializers.arguments(script, 1, 0, use_snippets="all")
        == "${1:x}, ${2:y}$0"
    )


def test_arguments_is_just_the_final_tab_stop_for_a_zero_argument_call():
    assert serializers.arguments(FakeScript(), 1, 0, use_snippets="all") == "$0"


# --- methods --------------------------------------------------------------


def klass(name: str) -> FakeName:
    return FakeName(name=name, type="class")


def test_methods_lists_methods_of_parent_classes():
    parent = klass("Base")
    script = FakeScript(
        completions=[
            FakeName(
                name="run",
                parent_name=parent,
                module_path=pathlib.Path("/work/base.py"),
                line=4,
                column=4,
                signatures=[signature("param self", "param times=1")],
            )
        ]
    )
    results = serializers.methods(script, 1, 0)

    assert len(results) == 1
    assert results[0]["parent"] == "Base"
    assert results[0]["name"] == "run"
    assert results[0]["fileName"] == "/work/base.py"


def test_methods_strips_the_implicit_self_parameter():
    # The override template writes its own `self`, so keeping Jedi's would
    # produce `def run(self, self)`.
    script = FakeScript(
        completions=[
            FakeName(
                name="run",
                parent_name=klass("Base"),
                signatures=[signature("param self", "param times=1")],
            )
        ]
    )
    assert serializers.methods(script, 1, 0)[0]["params"] == ["times=1"]


def test_methods_names_the_instance_from_the_injected_probe():
    probe_parent = klass("Child")
    script = FakeScript(
        completions=[
            FakeName(name=serializers.OVERRIDE_PROBE_NAME, parent_name=probe_parent),
            FakeName(name="run", parent_name=klass("Base")),
        ]
    )
    assert serializers.methods(script, 1, 0)[0]["instance"] == "Child"


def test_methods_falls_back_when_the_probe_is_missing():
    script = FakeScript(completions=[FakeName(name="run", parent_name=klass("Base"))])
    assert serializers.methods(script, 1, 0)[0]["instance"] == "self.__class__"


def test_methods_excludes_the_probe_itself():
    script = FakeScript(
        completions=[
            FakeName(name=serializers.OVERRIDE_PROBE_NAME, parent_name=klass("Child")),
            FakeName(name="run", parent_name=klass("Base")),
        ]
    )
    names_found = [entry["name"] for entry in serializers.methods(script, 1, 0)]
    assert serializers.OVERRIDE_PROBE_NAME not in names_found


def test_methods_ignores_names_whose_parent_is_not_a_class():
    script = FakeScript(
        completions=[
            FakeName(name="helper", parent_name=FakeName(name="mod", type="module"))
        ]
    )
    assert serializers.methods(script, 1, 0) == []


def test_methods_tolerates_a_builtin_without_a_file():
    script = FakeScript(
        completions=[FakeName(name="run", parent_name=klass("object"), module_path=None)]
    )
    assert serializers.methods(script, 1, 0)[0]["fileName"] is None


def test_methods_is_empty_when_jedi_raises():
    assert serializers.methods(ExplodingScript(), 1, 0) == []


def test_methods_falls_back_when_the_probe_parent_raises():
    # Resolving the probe's parent can raise; the instance name then stays at the
    # generic fallback rather than aborting the whole override lookup.
    script = FakeScript(
        completions=[
            ParentRaises(name=serializers.OVERRIDE_PROBE_NAME),
            FakeName(name="run", parent_name=klass("Base")),
        ]
    )
    assert serializers.methods(script, 1, 0)[0]["instance"] == "self.__class__"


def test_methods_skips_a_completion_whose_parent_raises():
    script = FakeScript(
        completions=[
            ParentRaises(name="broken"),
            FakeName(name="run", parent_name=klass("Base")),
        ]
    )
    names_found = [entry["name"] for entry in serializers.methods(script, 1, 0)]
    assert names_found == ["run"]


# --- definitions, tooltip, usages -----------------------------------------


def test_definitions_converts_to_zero_based_rows():
    found = serializers.definitions(
        [FakeName(name="run", module_path=pathlib.Path("/work/a.py"), line=10, column=4)]
    )
    assert found == [
        {
            "text": "run",
            "type": "function",
            "fileName": "/work/a.py",
            "line": 9,
            "column": 4,
        }
    ]


def test_definitions_skips_a_definition_without_a_file():
    assert serializers.definitions([FakeName(module_path=None)]) == []


def test_definitions_follows_an_import_to_its_target():
    target = FakeName(
        name="real", type="function", module_path=pathlib.Path("/work/real.py"), line=3
    )
    alias = FakeName(
        name="alias",
        type="import",
        module_path=pathlib.Path("/work/a.py"),
        goto_targets=[target],
    )
    assert serializers.definitions([alias])[0]["fileName"] == "/work/real.py"


def test_tooltip_returns_at_most_one_entry():
    definitions = [
        FakeName(name="a", module_path=pathlib.Path("/work/a.py"), _docstring="A"),
        FakeName(name="b", module_path=pathlib.Path("/work/b.py"), _docstring="B"),
    ]
    found = serializers.tooltip(definitions)
    assert len(found) == 1
    assert found[0]["description"] == "A"


def test_tooltip_falls_back_to_the_statement_value():
    definition = FakeName(
        name="total",
        type="statement",
        description="total = 42",
        module_path=pathlib.Path("/work/a.py"),
    )
    assert serializers.tooltip([definition])[0]["description"] == "42"


def test_tooltip_is_empty_when_nothing_has_a_file():
    assert serializers.tooltip([FakeName(module_path=None)]) == []


def test_tooltip_follows_an_import_to_its_target():
    target = FakeName(
        name="real",
        type="function",
        module_path=pathlib.Path("/work/real.py"),
        _docstring="The real thing.",
    )
    alias = FakeName(
        name="alias",
        type="import",
        module_path=pathlib.Path("/work/a.py"),
        goto_targets=[target],
    )
    found = serializers.tooltip([alias])
    assert found[0]["fileName"] == "/work/real.py"
    assert found[0]["description"] == "The real thing."


def test_tooltip_falls_back_when_the_docstring_raises():
    definition = DocstringRaises(
        name="run", module_path=pathlib.Path("/work/a.py")
    )
    # No docstring and not a statement, so the description resolves to empty
    # rather than propagating the error.
    assert serializers.tooltip([definition])[0]["description"] == ""


# --- highlights -----------------------------------------------------------


def test_highlights_converts_rows_and_measures_the_name():
    script = FakeScript(
        names=[FakeName(name="merge", type="function", line=2, column=4)]
    )
    assert serializers.highlights(script) == [
        {"type": "function", "line": 1, "column": 4, "length": 5}
    ]


def test_highlights_skips_keywords_and_nameless_entries():
    script = FakeScript(
        names=[
            FakeName(name="for", type="keyword", line=1, column=0),
            FakeName(name="", type="function", line=1, column=4),
            FakeName(name="run", type="function", line=1, column=8),
        ]
    )
    assert [entry["type"] for entry in serializers.highlights(script)] == [
        "function"
    ]


def test_highlights_classifies_builtins_and_constants():
    script = FakeScript(
        names=[
            FakeName(name="len", type="function", builtin=True, line=1, column=0),
            FakeName(name="MAX", type="statement", line=2, column=0),
        ]
    )
    assert [entry["type"] for entry in serializers.highlights(script)] == [
        "builtin",
        "constant",
    ]


def test_highlights_leaves_plain_identifiers_to_the_grammar():
    # Statements and unresolved references classify as `variable`; the daemon
    # drops them so the grammar keeps coloring them rather than being flattened.
    script = FakeScript(
        names=[
            FakeName(name="total", type="statement", line=1, column=0),
            FakeName(name="obj", type="instance", line=2, column=0),
            FakeName(name="run", type="function", line=3, column=0),
        ]
    )
    assert [entry["type"] for entry in serializers.highlights(script)] == [
        "function"
    ]


def test_highlights_is_empty_when_jedi_raises():
    assert serializers.highlights(ExplodingScript()) == []


def test_usages_keeps_one_based_lines():
    found = serializers.usages(
        [
            FakeName(
                name="Foo",
                module_name="app",
                module_path=pathlib.Path("/work/a.py"),
                line=7,
                column=6,
            )
        ]
    )
    assert found == [
        {
            "name": "Foo",
            "moduleName": "app",
            "fileName": "/work/a.py",
            "line": 7,
            "column": 6,
        }
    ]
