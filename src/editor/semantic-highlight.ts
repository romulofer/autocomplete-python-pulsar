/**
 * Renders Jedi's semantic classification of a buffer as text decorations,
 * layered on top of the grammar. The grammar keeps coloring keywords, strings
 * and numbers; this only recolors identifiers by what they actually are -
 * function, class, parameter, builtin, and so on.
 *
 * One marker layer per type keeps the decoration classes static: each layer is
 * decorated once, and an update only re-marks ranges. Nothing here talks to the
 * daemon; the provider feeds it the `highlights` results.
 */

import type { DisplayMarkerLayer, LayerDecoration, TextEditor } from 'atom';
import type { Highlight } from '../daemon/protocol';

export class SemanticHighlighter {
  /** One layer per semantic type, created on first use. */
  private readonly layers = new Map<string, DisplayMarkerLayer>();
  private readonly decorations: LayerDecoration[] = [];
  private disposed = false;

  constructor(private readonly editor: TextEditor) {}

  /** Replace all decorations with the given spans. */
  update(highlights: readonly Highlight[]): void {
    if (this.disposed) return;

    for (const layer of this.layers.values()) layer.clear();

    for (const { type, line, column, length } of highlights) {
      if (length <= 0) continue;
      this.layerFor(type).markBufferRange(
        [
          [line, column],
          [line, column + length]
        ],
        // `touch`: an edit anywhere in the name drops the stale marker rather
        // than leaving it stretched over the wrong text until the next update.
        { invalidate: 'touch' }
      );
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const decoration of this.decorations) decoration.destroy();
    for (const layer of this.layers.values()) layer.destroy();
    this.layers.clear();
    this.decorations.length = 0;
  }

  private layerFor(type: string): DisplayMarkerLayer {
    let layer = this.layers.get(type);
    if (layer) return layer;

    layer = this.editor.addMarkerLayer();
    this.decorations.push(
      this.editor.decorateMarkerLayer(layer, {
        type: 'text',
        class: `acp-hl acp-hl-${type}`
      })
    );
    this.layers.set(type, layer);
    return layer;
  }
}
