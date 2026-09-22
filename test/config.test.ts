import { describe, it, expect } from 'bun:test';
import {
  applySubstitutions,
  compileTriggerRegex,
  configSchema,
  DEFAULT_HIGHLIGHT_COLORS,
  DEFAULT_TRIGGER_REGEX,
  parseHighlightColors,
  parseHighlightTypes,
  resolveSettings,
  SEMANTIC_HIGHLIGHT_TYPES,
  splitPathList
} from '../src/config';

describe('splitPathList', () => {
  it('splits on semicolons and drops blanks and padding', () => {
    expect(splitPathList(' /a ; ;/b;  ')).toEqual(['/a', '/b']);
  });

  it('returns an empty list for anything that is not a string', () => {
    expect(splitPathList(undefined)).toEqual([]);
    expect(splitPathList(42)).toEqual([]);
  });
});

describe('applySubstitutions', () => {
  it('leaves templates without a variable untouched', () => {
    expect(applySubstitutions(['/usr/bin/python3'], ['/work/app'])).toEqual([
      '/usr/bin/python3'
    ]);
  });

  it('expands $PROJECT and $PROJECT_NAME', () => {
    expect(
      applySubstitutions(['$PROJECT/.venv/bin/python'], ['/work/app'])
    ).toEqual(['/work/app/.venv/bin/python']);
    expect(
      applySubstitutions(['/envs/$PROJECT_NAME/bin/python'], ['/work/app'])
    ).toEqual(['/envs/app/bin/python']);
  });

  // Upstream issue #312: the old implementation reassigned the template while
  // looping, so the second root was substituted into an already-resolved path.
  it('expands each project root against the original template', () => {
    expect(
      applySubstitutions(
        ['$PROJECT/.venv/bin/python'],
        ['/work/one', '/work/two']
      )
    ).toEqual([
      '/work/one/.venv/bin/python',
      '/work/two/.venv/bin/python'
    ]);
  });

  it('deduplicates identical expansions', () => {
    expect(
      applySubstitutions(['/shared/python', '/shared/python'], ['/work/app'])
    ).toEqual(['/shared/python']);
  });

  it('drops a $PROJECT template entirely when no project is open', () => {
    expect(applySubstitutions(['$PROJECT/.venv/bin/python'], [])).toEqual([]);
  });
});

describe('resolveSettings', () => {
  it('fills in defaults for an empty config', () => {
    const settings = resolveSettings({});
    expect(settings.useSnippets).toBe('none');
    expect(settings.showDescriptions).toBe(true);
    expect(settings.fuzzyMatcher).toBe(true);
    expect(settings.suggestionPriority).toBe(3);
    expect(settings.daemonIdleTimeout).toBe(10);
    expect(settings.triggerCompletionRegex).toBe(DEFAULT_TRIGGER_REGEX);
    expect(settings.pythonPaths).toEqual([]);
  });

  it('rejects a snippet mode it does not know', () => {
    expect(resolveSettings({ useSnippets: 'sometimes' }).useSnippets).toBe(
      'none'
    );
    expect(resolveSettings({ useSnippets: 'all' }).useSnippets).toBe('all');
  });

  it('coerces numbers and clamps a negative idle timeout to zero', () => {
    expect(resolveSettings({ suggestionPriority: '7' }).suggestionPriority).toBe(7);
    expect(resolveSettings({ daemonIdleTimeout: -5 }).daemonIdleTimeout).toBe(0);
    expect(
      resolveSettings({ suggestionPriority: 'nonsense' }).suggestionPriority
    ).toBe(3);
  });

  it('defaults the output font size to zero and clamps negatives', () => {
    expect(resolveSettings({}).outputFontSize).toBe(0);
    expect(resolveSettings({ outputFontSize: 18 }).outputFontSize).toBe(18);
    expect(resolveSettings({ outputFontSize: -4 }).outputFontSize).toBe(0);
  });

  it('trims the selected interpreter', () => {
    expect(
      resolveSettings({ selectedInterpreter: '  /usr/bin/python3  ' })
        .selectedInterpreter
    ).toBe('/usr/bin/python3');
  });
});

describe('compileTriggerRegex', () => {
  it('compiles a valid pattern', () => {
    const { regex, error } = compileTriggerRegex('^ab');
    expect(error).toBeNull();
    expect(regex.test('abc')).toBe(true);
  });

  it('falls back to the default and reports the error', () => {
    const { regex, error } = compileTriggerRegex('([unclosed');
    expect(error).not.toBeNull();
    expect(regex.source).toBe(new RegExp(DEFAULT_TRIGGER_REGEX).source);
  });

  it('matches the prefixes completions should trigger on', () => {
    const { regex } = compileTriggerRegex(DEFAULT_TRIGGER_REGEX);
    for (const prefix of ['.', ' ', '(', 'os', '_private']) {
      expect(regex.test(prefix)).toBe(true);
    }
  });
});

describe('configSchema', () => {
  it('declares every setting resolveSettings reads', () => {
    for (const key of Object.keys(resolveSettings({}))) {
      expect(configSchema).toHaveProperty(key);
    }
  });

  it('agrees with resolveSettings on the defaults', () => {
    const defaults = resolveSettings({});
    expect(configSchema.showDescriptions.default).toBe(defaults.showDescriptions);
    expect(configSchema.useSnippets.default).toBe(defaults.useSnippets);
    expect(configSchema.suggestionPriority.default).toBe(
      defaults.suggestionPriority
    );
    expect(configSchema.daemonIdleTimeout.default).toBe(
      defaults.daemonIdleTimeout
    );
  });

  it('gives every setting a title and a description', () => {
    for (const [key, entry] of Object.entries(configSchema)) {
      expect(entry.title, `${key} needs a title`).toBeTruthy();
      expect(entry.description, `${key} needs a description`).toBeTruthy();
    }
  });
});

describe('parseHighlightTypes', () => {
  it('defaults to every kind when the setting is absent', () => {
    expect(parseHighlightTypes(undefined)).toEqual([...SEMANTIC_HIGHLIGHT_TYPES]);
  });

  it('keeps only known kinds and fixes their order', () => {
    expect(parseHighlightTypes(['bogus', 'self', 'function'])).toEqual([
      'function',
      'self'
    ]);
  });

  it('honors an explicit empty list', () => {
    expect(parseHighlightTypes([])).toEqual([]);
  });
});

describe('parseHighlightColors', () => {
  it('fills in every default when nothing is set', () => {
    expect(parseHighlightColors(undefined)).toEqual(DEFAULT_HIGHLIGHT_COLORS);
  });

  it('layers overrides onto the defaults', () => {
    const colors = parseHighlightColors({ function: '#123456' });
    expect(colors.function).toBe('#123456');
    expect(colors.class).toBe(DEFAULT_HIGHLIGHT_COLORS.class);
  });

  it('reads a Color object via toHexString', () => {
    const colors = parseHighlightColors({
      self: { toHexString: () => '#abcdef' }
    });
    expect(colors.self).toBe('#abcdef');
  });
});
