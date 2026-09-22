"use strict";
/**
 * Turns the user's per-class color overrides into a stylesheet that layers over
 * the package's theme-aware defaults. Only classes whose color differs from the
 * default are emitted, so untouched classes keep adapting to light themes; a
 * customized class is pinned to the chosen color exactly. Kept pure so the
 * mapping is testable without the `atom` global; the provider does the actual
 * injection through `atom.styles`.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHighlightStyle = buildHighlightStyle;
const config_1 = require("../config");
/** CSS overriding only the classes the user recolored; '' when none did. */
function buildHighlightStyle(colors, defaults) {
    const rules = [];
    for (const type of config_1.SEMANTIC_HIGHLIGHT_TYPES) {
        const color = colors[type];
        if (!color || color === defaults[type])
            continue;
        // Same selector shape as the stylesheet, added afterwards, so it wins on
        // equal specificity without needing `!important`.
        rules.push(`atom-text-editor .acp-hl-${type} { color: ${color}; }`);
    }
    return rules.join('\n');
}
//# sourceMappingURL=highlight-style.js.map