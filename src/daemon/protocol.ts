/**
 * Wire format shared with `python/acp_jedi/protocol.py`, plus the pure pieces of
 * the conversation: request identity and line framing.
 *
 * Both ends speak newline-delimited JSON over the daemon's stdin/stdout. Every
 * request carries an `id` that the daemon echoes back, which is how responses
 * are matched to their callers and how the response cache is keyed.
 *
 * Nothing here spawns or talks to a process, so it is all directly testable.
 */

import * as crypto from 'crypto';
import type { SnippetMode } from '../config';

export type { SnippetMode };

export type LookupKind =
  | 'completions'
  | 'definitions'
  | 'usages'
  | 'methods'
  | 'arguments'
  | 'tooltip'
  | 'highlights';

export interface RequestConfig {
  extraPaths: string[];
  useSnippets: SnippetMode;
  caseInsensitiveCompletion: boolean;
  showDescriptions: boolean;
  fuzzyMatcher: boolean;
}

export interface DaemonRequest {
  id: string;
  lookup: LookupKind;
  /** `null` for buffers that have never been saved. */
  path: string | null;
  source: string;
  /** Zero-based, as Pulsar reports it; the daemon converts to Jedi's 1-based. */
  line: number;
  column: number;
  prefix?: string;
  config: RequestConfig;
}

/** An autocomplete-plus suggestion. */
export interface Suggestion {
  text: string;
  type: string;
  description?: string;
  rightLabel?: string;
  snippet?: string;
  displayText?: string;
}

export interface Definition {
  text: string;
  type: string;
  fileName: string;
  /** Zero-based row, ready to hand to `setCursorBufferPosition`. */
  line: number;
  column: number;
  description?: string;
}

export interface Usage {
  name: string;
  moduleName: string;
  fileName: string;
  /** One-based, as Jedi reports it. */
  line: number;
  column: number;
}

export interface MethodDefinition {
  parent: string;
  instance: string;
  name: string;
  params: string[];
  moduleName: string;
  fileName: string | null;
  line: number | null;
  column: number | null;
}

/**
 * One semantically classified name span for the `highlights` lookup. Rows are
 * zero-based, ready to hand to `markBufferRange`.
 */
export interface Highlight {
  /** A `names.definition_type` class, e.g. `function`, `param`, `builtin`. */
  type: string;
  line: number;
  column: number;
  /** Length of the name in characters; the span never crosses a line. */
  length: number;
}

export interface DaemonResponse<T = unknown> {
  id: string;
  results: T[];
  /** Only present for `arguments` lookups: the snippet body to insert. */
  arguments?: string;
}

/**
 * Reserved response ids. The daemon uses these instead of a request id to
 * report on its own state, so startup problems surface as a readable
 * notification rather than as a raw Python traceback on stderr.
 */
export const HANDSHAKE_ID = '__ready__';
export const FATAL_ERROR_ID = '__error__';

/** First line the daemon writes once Jedi has imported successfully. */
export interface DaemonHandshake extends DaemonResponse<never> {
  id: typeof HANDSHAKE_ID;
  python: string;
  jedi: string;
}

/** Written when the daemon cannot start at all; it exits right afterwards. */
export interface DaemonFatalError extends DaemonResponse<never> {
  id: typeof FATAL_ERROR_ID;
  error: 'jedi-missing' | 'jedi-too-old' | 'python-too-old' | 'unknown';
  message: string;
  detail: string;
}

/**
 * Request ids are a hash of everything that can change the answer, which makes
 * them double as the response cache key.
 *
 * SHA-256 rather than MD5: MD5 is unavailable when the host runs OpenSSL in
 * FIPS mode, which used to break the package outright. Upstream issue #432.
 */
export function generateRequestId(
  lookup: LookupKind,
  filePath: string | null,
  source: string,
  line: number,
  column: number
): string {
  return crypto
    .createHash('sha256')
    .update([filePath ?? '', source, line, column, lookup].join(' '))
    .digest('hex');
}

/**
 * Reassembles newline-delimited messages from arbitrary stdout chunks.
 *
 * A chunk boundary has nothing to do with a message boundary. The old code
 * parsed each chunk as it arrived and threw `Failed to parse JSON from ...`
 * whenever a response straddled two of them. Upstream issues #354, #366.
 */
export class LineFramer {
  private buffer = '';

  /** Feed a chunk; get back whatever complete, non-empty lines it completed. */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];

    let newlineIndex = this.buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);
      if (line.length > 0) lines.push(line);
      newlineIndex = this.buffer.indexOf('\n');
    }
    return lines;
  }

  /** Drop anything buffered but incomplete, e.g. after the process died. */
  reset(): void {
    this.buffer = '';
  }

  /** The incomplete tail, exposed for debugging. */
  get pending(): string {
    return this.buffer;
  }
}

/**
 * Parse one response line. Returns `null` for anything that is not JSON: that
 * is almost always a project module printing on import, which must not take
 * down the response stream.
 */
export function parseResponseLine(line: string): DaemonResponse<never> | null {
  try {
    const parsed = JSON.parse(line) as DaemonResponse<never>;
    return parsed && typeof parsed.id === 'string' ? parsed : null;
  } catch {
    return null;
  }
}

/** An empty answer, used whenever a request cannot be served. */
export function emptyResponse(id: string): DaemonResponse<never> {
  return { id, results: [] };
}
