"""Shared fixtures and stand-ins for the daemon tests.

The modules under test are duck-typed against Jedi's public API, so most of the
suite runs against the fakes below and never imports Jedi. The handful of tests
that exercise the real thing are marked ``requires_jedi``.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Any

import pytest

# `python/` holds the acp_jedi package; the daemon puts it on the path the same
# way at startup.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers", "requires_jedi: exercises a real jedi installation"
    )


@pytest.fixture(autouse=True)
def restore_sys_path():
    """Undo any ``sys.path`` edit a test made.

    The session deliberately rewrites ``sys.path`` per request, so tests that
    exercise it would otherwise leave the interpreter unable to import anything
    for the rest of the run.
    """
    saved = list(sys.path)
    try:
        yield
    finally:
        sys.path[:] = saved


@pytest.fixture(scope="session")
def jedi():
    """The real Jedi module, or skip."""
    return pytest.importorskip("jedi")


@pytest.fixture
def fixtures_dir() -> str:
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures")


# --- stand-ins for Jedi objects -------------------------------------------


@dataclass
class FakeParam:
    """Mimics ``jedi.api.classes.ParamName``."""

    description: str
    name: str = ""

    def __post_init__(self) -> None:
        if not self.name:
            stripped = self.description.replace("param ", "", 1)
            self.name = stripped.split(":")[0].split("=")[0].strip()


@dataclass
class FakeSignature:
    """Mimics ``jedi.api.classes.Signature``."""

    params: list[FakeParam] = field(default_factory=list)
    name: str = "call"
    type: str = "function"
    module_path: Any = None
    module_name: str = "mod"
    line: int = 1
    column: int = 0
    description: str = ""
    _docstring: str = ""

    def docstring(self) -> str:
        return self._docstring

    def get_signatures(self) -> list["FakeSignature"]:
        return [self]

    def in_builtin_module(self) -> bool:
        return False


@dataclass
class FakeName:
    """Mimics ``jedi.api.classes.Name``."""

    name: str = "thing"
    type: str = "function"
    module_name: str = "mod"
    module_path: Any = None
    line: int = 1
    column: int = 0
    description: str = ""
    builtin: bool = False
    signatures: list[FakeSignature] = field(default_factory=list)
    parent_name: "FakeName | None" = None
    goto_targets: list["FakeName"] = field(default_factory=list)
    _docstring: str = ""

    def docstring(self) -> str:
        return self._docstring

    def in_builtin_module(self) -> bool:
        return self.builtin

    def get_signatures(self) -> list[FakeSignature]:
        return self.signatures

    def parent(self) -> "FakeName | None":
        return self.parent_name

    def goto(self) -> list["FakeName"]:
        return self.goto_targets


class FakeScript:
    """Mimics the handful of ``jedi.Script`` methods the daemon calls."""

    def __init__(
        self,
        completions: list[FakeName] | None = None,
        signatures: list[FakeSignature] | None = None,
        goto: list[FakeName] | None = None,
        references: list[FakeName] | None = None,
        names: list[FakeName] | None = None,
    ) -> None:
        self._completions = completions or []
        self._signatures = signatures or []
        self._goto = goto or []
        self._references = references or []
        self._names = names or []
        self.calls: list[tuple[str, int, int]] = []

    def complete(self, line: int, column: int) -> list[FakeName]:
        self.calls.append(("complete", line, column))
        return self._completions

    def get_signatures(self, line: int, column: int) -> list[FakeSignature]:
        self.calls.append(("get_signatures", line, column))
        return self._signatures

    def goto(self, line: int, column: int) -> list[FakeName]:
        self.calls.append(("goto", line, column))
        return self._goto

    def get_references(self, line: int, column: int) -> list[FakeName]:
        self.calls.append(("get_references", line, column))
        return self._references

    def get_names(self, **kwargs: Any) -> list[FakeName]:
        self.calls.append(("get_names", -1, -1))
        return self._names


class ExplodingScript(FakeScript):
    """Every lookup raises, to prove the serializers degrade to empty results."""

    def complete(self, line: int, column: int) -> list[FakeName]:
        raise KeyError("jedi blew up")

    def get_signatures(self, line: int, column: int) -> list[FakeSignature]:
        raise KeyError("jedi blew up")

    def get_names(self, **kwargs: Any) -> list[FakeName]:
        raise KeyError("jedi blew up")


@pytest.fixture
def fake_script() -> type[FakeScript]:
    return FakeScript
