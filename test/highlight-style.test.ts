import { describe, it, expect } from 'bun:test';
import { buildHighlightStyle } from '../src/editor/highlight-style';
import { DEFAULT_HIGHLIGHT_COLORS } from '../src/config';

describe('buildHighlightStyle', () => {
  it('emits nothing when every color is left at its default', () => {
    expect(
      buildHighlightStyle(DEFAULT_HIGHLIGHT_COLORS, DEFAULT_HIGHLIGHT_COLORS)
    ).toBe('');
  });

  it('emits a rule only for the classes the user changed', () => {
    const colors = { ...DEFAULT_HIGHLIGHT_COLORS, self: '#ff0000' };
    const css = buildHighlightStyle(colors, DEFAULT_HIGHLIGHT_COLORS);

    expect(css).toBe('atom-text-editor .acp-hl-self { color: #ff0000; }');
  });

  it('emits one rule per changed class', () => {
    const colors = {
      ...DEFAULT_HIGHLIGHT_COLORS,
      function: '#111111',
      module: '#222222'
    };
    const css = buildHighlightStyle(colors, DEFAULT_HIGHLIGHT_COLORS);

    expect(css.split('\n')).toEqual([
      'atom-text-editor .acp-hl-function { color: #111111; }',
      'atom-text-editor .acp-hl-module { color: #222222; }'
    ]);
  });
});
