"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SemanticHighlighter = void 0;
class SemanticHighlighter {
    editor;
    /** One layer per semantic type, created on first use. */
    layers = new Map();
    decorations = [];
    disposed = false;
    /**
     * The last applied spans, serialized. Editing a string or comment changes the
     * buffer without changing any identifier's classification, so the daemon keeps
     * returning the same spans; this skips clearing and re-marking every layer
     * when nothing an update would draw has moved.
     */
    lastSignature = null;
    constructor(editor) {
        this.editor = editor;
    }
    /** Replace all decorations with the given spans. */
    update(highlights) {
        if (this.disposed)
            return;
        const signature = JSON.stringify(highlights);
        if (signature === this.lastSignature)
            return;
        this.lastSignature = signature;
        for (const layer of this.layers.values())
            layer.clear();
        for (const { type, line, column, length } of highlights) {
            if (length <= 0)
                continue;
            this.layerFor(type).markBufferRange([
                [line, column],
                [line, column + length]
            ], 
            // `touch`: an edit anywhere in the name drops the stale marker rather
            // than leaving it stretched over the wrong text until the next update.
            { invalidate: 'touch' });
        }
    }
    dispose() {
        if (this.disposed)
            return;
        this.disposed = true;
        for (const decoration of this.decorations)
            decoration.destroy();
        for (const layer of this.layers.values())
            layer.destroy();
        this.layers.clear();
        this.decorations.length = 0;
    }
    layerFor(type) {
        let layer = this.layers.get(type);
        if (layer)
            return layer;
        layer = this.editor.addMarkerLayer();
        this.decorations.push(this.editor.decorateMarkerLayer(layer, {
            type: 'text',
            class: `acp-hl acp-hl-${type}`
        }));
        this.layers.set(type, layer);
        return layer;
    }
}
exports.SemanticHighlighter = SemanticHighlighter;
//# sourceMappingURL=semantic-highlight.js.map