"""Turning one editor request into one response payload.

The session owns everything that varies per request - the settings, the import
paths, the Jedi ``Script`` - and dispatches to :mod:`acp_jedi.serializers`.
"""

from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from typing import Any, Callable

from . import protocol, serializers


@dataclass
class RequestConfig:
    """The per-request settings the editor sends under ``config``."""

    extra_paths: list[str] = field(default_factory=list)
    use_snippets: str | None = None
    show_descriptions: bool = True
    fuzzy_matcher: bool = False
    case_insensitive_completion: bool = True

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "RequestConfig":
        return cls(
            extra_paths=[path for path in payload.get("extraPaths", []) if path],
            use_snippets=payload.get("useSnippets"),
            show_descriptions=payload.get("showDescriptions", True),
            fuzzy_matcher=payload.get("fuzzyMatcher", False),
            case_insensitive_completion=payload.get(
                "caseInsensitiveCompletion", True
            ),
        )


def top_level_package_dir(file_path: str) -> str:
    """Walk up out of the package ``file_path`` belongs to.

    Jedi resolves sibling modules relative to the file, but not modules *above*
    it, so the import root has to go on ``sys.path`` explicitly. The old
    implementation returned the *file* path when the file was not inside a
    package, and that path was then inserted into ``sys.path`` and handed to
    ``jedi.Project`` as if it were a directory.
    """
    directory = os.path.dirname(os.path.abspath(file_path))
    while os.path.isfile(os.path.join(directory, "__init__.py")):
        parent = os.path.dirname(directory)
        if parent == directory:
            break
        directory = parent
    return directory


class JediSession:
    """Answers requests against a Jedi module.

    ``jedi`` is injected rather than imported so the import failure can be
    reported by :mod:`acp_jedi.runtime` and so tests can supply a stand-in.
    """

    def __init__(self, jedi: Any, default_sys_path: list[str] | None = None) -> None:
        self.jedi = jedi
        # A copy: restoring the same list object would let a later mutation edit
        # the saved default as well.
        self.default_sys_path = list(
            default_sys_path if default_sys_path is not None else sys.path
        )

    # --- setup ----------------------------------------------------------

    def apply_config(self, config: RequestConfig) -> list[str]:
        """Reset ``sys.path`` for this request and return the extra paths."""
        sys.path = list(self.default_sys_path)
        self.jedi.settings.case_insensitive_completion = (
            config.case_insensitive_completion
        )
        return [path for path in config.extra_paths if path not in sys.path]

    def build_script(
        self, source: str, file_path: str | None, extra_paths: list[str]
    ) -> Any:
        project_path = (
            top_level_package_dir(file_path) if file_path else os.getcwd()
        )
        if project_path not in sys.path:
            sys.path.insert(0, project_path)
        return self.jedi.Script(
            code=source,
            path=file_path,
            project=self.jedi.Project(project_path, added_sys_path=extra_paths),
        )

    # --- dispatch -------------------------------------------------------

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        """Answer one request. Returns the payload; never writes to a stream."""
        identifier = request.get("id")
        config = RequestConfig.from_payload(request.get("config", {}))
        extra_paths = self.apply_config(config)

        file_path = request.get("path") or None
        script = self.build_script(request["source"], file_path, extra_paths)

        # Pulsar counts rows from zero; Jedi counts lines from one.
        line = request["line"] + 1
        column = request["column"]
        lookup = request.get("lookup", "completions")

        handler = self._handlers().get(lookup, self._completions)
        return handler(script, line, column, identifier, config, request)

    def _handlers(self) -> dict[str, Callable[..., dict[str, Any]]]:
        return {
            "completions": self._completions,
            "definitions": self._definitions,
            "tooltip": self._tooltip,
            "usages": self._usages,
            "methods": self._methods,
            "arguments": self._arguments,
            "highlights": self._highlights,
        }

    # --- lookups --------------------------------------------------------

    def _completions(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        return protocol.response(
            identifier,
            serializers.completions(
                script,
                line,
                column,
                show_doc_strings=config.show_descriptions,
                fuzzy_matcher=config.fuzzy_matcher,
                prefix=request.get("prefix", ""),
            ),
        )

    def _definitions(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        return protocol.response(
            identifier, serializers.definitions(script.goto(line, column))
        )

    def _tooltip(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        return protocol.response(
            identifier, serializers.tooltip(script.goto(line, column))
        )

    def _usages(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        return protocol.response(
            identifier, serializers.usages(script.get_references(line, column))
        )

    def _methods(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        return protocol.response(
            identifier, serializers.methods(script, line, column)
        )

    def _arguments(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        return protocol.response(
            identifier,
            [],
            arguments=serializers.arguments(
                script, line, column, use_snippets=config.use_snippets
            ),
        )

    def _highlights(
        self,
        script: Any,
        line: int,
        column: int,
        identifier: str | None,
        config: RequestConfig,
        request: dict[str, Any],
    ) -> dict[str, Any]:
        # Whole-file scan; the cursor position is irrelevant.
        return protocol.response(identifier, serializers.highlights(script))
