import { describe, it, expect } from 'bun:test';
import { SemanticHighlighter } from '../src/editor/semantic-highlight';
import type { Highlight } from '../src/daemon/protocol';

interface FakeLayer {
  type: string;
  ranges: unknown[];
  cleared: number;
  destroyed: boolean;
}

/**
 * A stand-in for the bits of TextEditor the highlighter touches. It records one
 * layer per `decorateMarkerLayer` class so the tests can assert what got marked
 * where.
 */
function fakeEditor() {
  const layers: FakeLayer[] = [];
  let pendingClass = '';

  const editor = {
    addMarkerLayer() {
      const layer: FakeLayer = {
        type: '',
        ranges: [],
        cleared: 0,
        destroyed: false
      };
      // decorateMarkerLayer is called right after and names the layer.
      (layer as FakeLayer & { markBufferRange: unknown }).markBufferRange = (
        range: unknown
      ) => layer.ranges.push(range);
      (layer as FakeLayer & { clear: unknown }).clear = () => {
        layer.cleared += 1;
        layer.ranges = [];
      };
      (layer as FakeLayer & { destroy: unknown }).destroy = () => {
        layer.destroyed = true;
      };
      layers.push(layer);
      return layer;
    },
    decorateMarkerLayer(layer: FakeLayer, options: { class: string }) {
      layer.type = options.class;
      pendingClass = options.class;
      return { destroy() {} };
    }
  };

  return { editor, layers, lastClass: () => pendingClass };
}

const hl = (over: Partial<Highlight> = {}): Highlight => ({
  type: 'function',
  line: 0,
  column: 0,
  length: 3,
  ...over
});

describe('SemanticHighlighter', () => {
  it('marks each span with its type class as the layer class', () => {
    const { editor, layers } = fakeEditor();
    const highlighter = new SemanticHighlighter(editor as never);

    highlighter.update([hl({ type: 'param', line: 2, column: 4, length: 5 })]);

    expect(layers).toHaveLength(1);
    expect(layers[0].type).toBe('acp-hl acp-hl-param');
    expect(layers[0].ranges).toEqual([
      [
        [2, 4],
        [2, 9]
      ]
    ]);
  });

  it('reuses one layer per type across spans', () => {
    const { editor, layers } = fakeEditor();
    const highlighter = new SemanticHighlighter(editor as never);

    highlighter.update([
      hl({ type: 'function', column: 0 }),
      hl({ type: 'function', column: 10 }),
      hl({ type: 'builtin', column: 20 })
    ]);

    expect(layers.map((layer) => layer.type)).toEqual([
      'acp-hl acp-hl-function',
      'acp-hl acp-hl-builtin'
    ]);
    expect(layers[0].ranges).toHaveLength(2);
    expect(layers[1].ranges).toHaveLength(1);
  });

  it('clears previous markers on each update instead of stacking them', () => {
    const { editor, layers } = fakeEditor();
    const highlighter = new SemanticHighlighter(editor as never);

    highlighter.update([hl({ type: 'function' })]);
    highlighter.update([hl({ type: 'function', column: 5 })]);

    expect(layers).toHaveLength(1);
    expect(layers[0].cleared).toBe(1);
    expect(layers[0].ranges).toEqual([
      [
        [0, 5],
        [0, 8]
      ]
    ]);
  });

  it('skips re-marking when the spans are unchanged', () => {
    const { editor, layers } = fakeEditor();
    const highlighter = new SemanticHighlighter(editor as never);

    highlighter.update([hl({ type: 'function' })]);
    // Same spans again: an edit in a string or comment leaves the daemon's
    // classification untouched, so nothing should be cleared or re-marked.
    highlighter.update([hl({ type: 'function' })]);

    expect(layers).toHaveLength(1);
    expect(layers[0].cleared).toBe(0);
    expect(layers[0].ranges).toHaveLength(1);
  });

  it('skips zero-length spans', () => {
    const { editor, layers } = fakeEditor();
    const highlighter = new SemanticHighlighter(editor as never);

    highlighter.update([hl({ length: 0 })]);

    expect(layers).toHaveLength(0);
  });

  it('destroys its layers on dispose and goes inert', () => {
    const { editor, layers } = fakeEditor();
    const highlighter = new SemanticHighlighter(editor as never);

    highlighter.update([hl()]);
    highlighter.dispose();
    highlighter.update([hl({ type: 'class' })]);

    expect(layers).toHaveLength(1);
    expect(layers[0].destroyed).toBe(true);
  });
});
