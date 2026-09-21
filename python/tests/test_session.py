"""Request configuration, import roots, and dispatch."""

from __future__ import annotations

import os
import sys

import pytest

from acp_jedi import protocol
from acp_jedi.session import JediSession, RequestConfig, top_level_package_dir

from conftest import FakeName, FakeScript


class FakeSettings:
    case_insensitive_completion = True


class FakeJedi:
    """Records how the session builds a Script and a Project."""

    def __init__(self, script: FakeScript | None = None) -> None:
        self.settings = FakeSettings()
        self.script = script or FakeScript()
        self.script_kwargs: dict = {}
        self.project_args: tuple = ()
        self.project_kwargs: dict = {}
        self.__version__ = "0.19.2"

    def Script(self, **kwargs):  # noqa: N802 - mirrors Jedi's public name
        self.script_kwargs = kwargs
        return self.script

    def Project(self, *args, **kwargs):  # noqa: N802 - mirrors Jedi's name
        self.project_args = args
        self.project_kwargs = kwargs
        return ("project", args, kwargs)


def request(**overrides) -> dict:
    payload = {
        "id": "req-1",
        "lookup": "completions",
        "path": None,
        "source": "import os",
        "line": 0,
        "column": 9,
        "config": {},
    }
    payload.update(overrides)
    return payload


# --- RequestConfig --------------------------------------------------------


def test_request_config_defaults_match_the_editor_defaults():
    config = RequestConfig.from_payload({})
    assert config.extra_paths == []
    assert config.use_snippets is None
    assert config.show_descriptions is True
    assert config.fuzzy_matcher is False
    assert config.case_insensitive_completion is True


def test_request_config_reads_the_editor_payload():
    config = RequestConfig.from_payload(
        {
            "extraPaths": ["/pkgs", ""],
            "useSnippets": "all",
            "showDescriptions": False,
            "fuzzyMatcher": True,
            "caseInsensitiveCompletion": False,
        }
    )
    assert config.extra_paths == ["/pkgs"]
    assert config.use_snippets == "all"
    assert config.show_descriptions is False
    assert config.fuzzy_matcher is True
    assert config.case_insensitive_completion is False


# --- import roots ---------------------------------------------------------


def test_top_level_package_dir_returns_the_containing_directory(tmp_path):
    module = tmp_path / "app.py"
    module.write_text("")
    assert top_level_package_dir(str(module)) == str(tmp_path)


def test_top_level_package_dir_walks_out_of_nested_packages(tmp_path):
    package = tmp_path / "pkg" / "sub"
    package.mkdir(parents=True)
    (tmp_path / "pkg" / "__init__.py").write_text("")
    (package / "__init__.py").write_text("")
    module = package / "mod.py"
    module.write_text("")

    # `pkg.sub.mod` is importable from tmp_path, so that is the root.
    assert top_level_package_dir(str(module)) == str(tmp_path)


def test_top_level_package_dir_stops_at_a_directory_without_init(tmp_path):
    package = tmp_path / "pkg"
    package.mkdir()
    (package / "__init__.py").write_text("")
    module = package / "mod.py"
    module.write_text("")
    assert top_level_package_dir(str(module)) == str(tmp_path)


def test_top_level_package_dir_stops_at_the_filesystem_root(monkeypatch):
    # A package that appears to reach all the way to the root must not spin
    # forever: the walk stops once the parent stops changing.
    import os

    monkeypatch.setattr(os.path, "isfile", lambda path: True)
    result = top_level_package_dir("/a/b/c.py")
    assert os.path.dirname(result) == result


# --- sys.path isolation ---------------------------------------------------


def test_apply_config_restores_sys_path_between_requests():
    original = list(sys.path)
    session = JediSession(FakeJedi(), default_sys_path=original)

    sys.path.append("/leaked")
    session.apply_config(RequestConfig())
    assert "/leaked" not in sys.path
    sys.path[:] = original


def test_apply_config_does_not_mutate_the_saved_default():
    # The old code assigned the same list object back, so a later mutation
    # edited the saved default too.
    original = ["/a", "/b"]
    session = JediSession(FakeJedi(), default_sys_path=original)

    session.apply_config(RequestConfig())
    sys.path.append("/c")
    session.apply_config(RequestConfig())

    assert session.default_sys_path == ["/a", "/b"]
    assert sys.path == ["/a", "/b"]


def test_apply_config_returns_extra_paths_not_already_present():
    session = JediSession(FakeJedi(), default_sys_path=["/a"])
    extra = session.apply_config(RequestConfig(extra_paths=["/a", "/pkgs"]))
    assert extra == ["/pkgs"]


def test_apply_config_forwards_case_sensitivity_to_jedi():
    jedi = FakeJedi()
    session = JediSession(jedi, default_sys_path=[])
    session.apply_config(RequestConfig(case_insensitive_completion=False))
    assert jedi.settings.case_insensitive_completion is False


# --- script construction --------------------------------------------------


def test_build_script_passes_extra_paths_to_the_project():
    jedi = FakeJedi()
    session = JediSession(jedi, default_sys_path=[])
    session.build_script("code", "/work/app.py", ["/pkgs"])

    assert jedi.script_kwargs["code"] == "code"
    assert jedi.script_kwargs["path"] == "/work/app.py"
    assert jedi.project_args == ("/work",)
    assert jedi.project_kwargs == {"added_sys_path": ["/pkgs"]}


def test_build_script_uses_the_cwd_for_an_unsaved_buffer():
    jedi = FakeJedi()
    session = JediSession(jedi, default_sys_path=[])
    session.build_script("code", None, [])

    assert jedi.script_kwargs["path"] is None
    assert jedi.project_args == (os.getcwd(),)


def test_build_script_puts_the_import_root_on_sys_path():
    jedi = FakeJedi()
    session = JediSession(jedi, default_sys_path=[])
    session.apply_config(RequestConfig())
    session.build_script("code", "/work/app.py", [])
    assert sys.path[0] == "/work"


# --- dispatch -------------------------------------------------------------


@pytest.mark.parametrize(
    "lookup,expected_call",
    [
        ("completions", "complete"),
        ("definitions", "goto"),
        ("tooltip", "goto"),
        ("usages", "get_references"),
        ("methods", "complete"),
        ("arguments", "get_signatures"),
        ("highlights", "get_names"),
    ],
)
def test_handle_dispatches_each_lookup(lookup, expected_call):
    script = FakeScript()
    session = JediSession(FakeJedi(script), default_sys_path=[])
    session.handle(request(lookup=lookup))
    assert any(call[0] == expected_call for call in script.calls)


def test_handle_converts_the_row_to_a_jedi_line():
    script = FakeScript()
    session = JediSession(FakeJedi(script), default_sys_path=[])
    session.handle(request(line=4, column=2))
    assert ("complete", 5, 2) in script.calls


def test_handle_echoes_the_request_id():
    session = JediSession(FakeJedi(), default_sys_path=[])
    assert session.handle(request(id="abc"))["id"] == "abc"


def test_handle_falls_back_to_completions_for_an_unknown_lookup():
    script = FakeScript()
    session = JediSession(FakeJedi(script), default_sys_path=[])
    session.handle(request(lookup="nonsense"))
    assert any(call[0] == "complete" for call in script.calls)


def test_handle_returns_the_arguments_snippet_under_its_own_key():
    from conftest import FakeParam, FakeSignature

    script = FakeScript(signatures=[FakeSignature(params=[FakeParam("param x")])])
    session = JediSession(FakeJedi(script), default_sys_path=[])
    payload = session.handle(
        request(lookup="arguments", config={"useSnippets": "all"})
    )

    assert payload["results"] == []
    assert payload["arguments"] == "${1:x}$0"


def test_handle_passes_the_prefix_through_to_completions():
    script = FakeScript(
        signatures=[],
        completions=[FakeName(name="value")],
    )
    session = JediSession(FakeJedi(script), default_sys_path=[])
    payload = session.handle(request(prefix="val"))
    assert payload["results"][0]["text"] == "value"


def test_handle_produces_a_payload_the_protocol_recognises():
    session = JediSession(FakeJedi(), default_sys_path=[])
    payload = session.handle(request(id="abc"))
    assert set(payload) >= {"id", "results"}
    assert payload["id"] not in (protocol.HANDSHAKE_ID, protocol.FATAL_ERROR_ID)
