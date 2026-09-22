"use strict";
/**
 * The settings schema Pulsar renders, and the pure functions that turn raw
 * config values into the shapes the rest of the package uses.
 *
 * Nothing here touches the `atom` global: `resolveSettings` takes whatever the
 * editor hands back, so the defaulting and parsing rules can be tested directly.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.configSchema = exports.DEFAULT_HIGHLIGHT_COLORS = exports.SEMANTIC_HIGHLIGHT_TYPES = exports.DEFAULT_TRIGGER_REGEX = void 0;
exports.parseHighlightTypes = parseHighlightTypes;
exports.parseHighlightColors = parseHighlightColors;
exports.splitPathList = splitPathList;
exports.applySubstitutions = applySubstitutions;
exports.resolveSettings = resolveSettings;
exports.compileTriggerRegex = compileTriggerRegex;
const path = __importStar(require("path"));
/** The default trigger: a word character, a dot, a space or an open paren. */
exports.DEFAULT_TRIGGER_REGEX = '([. (]|[a-zA-Z_][a-zA-Z0-9_]*)';
/** Every semantic highlight class the daemon can emit, in palette order. */
exports.SEMANTIC_HIGHLIGHT_TYPES = [
    'function',
    'property',
    'magic',
    'decorator',
    'class',
    'param',
    'self',
    'builtin',
    'constant',
    'module'
];
/**
 * The base hue for each class, matching the defaults in the stylesheet. A user
 * color equal to one of these means "unchanged", so the theme-aware stylesheet
 * keeps handling it; anything else is injected verbatim.
 */
exports.DEFAULT_HIGHLIGHT_COLORS = {
    function: '#61afef',
    property: '#d16d9e',
    magic: '#61afef',
    decorator: '#e5c07b',
    class: '#e5c07b',
    param: '#d19a66',
    self: '#e06c75',
    builtin: '#56b6c2',
    constant: '#c678dd',
    module: '#98c379'
};
const SNIPPET_MODES = ['none', 'all', 'required'];
const WORKING_DIRECTORY_MODES = ['file', 'project'];
function asString(value, fallback = '') {
    return typeof value === 'string' ? value : fallback;
}
function asBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}
function asNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}
/**
 * A configured color as a string. Atom hands back a `Color` object for `color`
 * settings and a plain string when read from JSON; both collapse to a hex here.
 */
function asColor(value, fallback) {
    if (typeof value === 'string' && value.trim())
        return value.trim();
    if (value &&
        typeof value === 'object' &&
        typeof value.toHexString === 'function') {
        return value.toHexString();
    }
    return fallback;
}
/** The enabled highlight classes, all of them when the setting is absent. */
function parseHighlightTypes(value) {
    if (!Array.isArray(value))
        return [...exports.SEMANTIC_HIGHLIGHT_TYPES];
    const chosen = new Set(value.map(String));
    // Filter against the known list so order stays fixed and typos are dropped;
    // an explicit empty list is honored, leaving every class to the grammar.
    return exports.SEMANTIC_HIGHLIGHT_TYPES.filter((type) => chosen.has(type));
}
/** Every class mapped to its color, user overrides layered onto the defaults. */
function parseHighlightColors(value) {
    const raw = (value && typeof value === 'object' ? value : {});
    const colors = {};
    for (const type of exports.SEMANTIC_HIGHLIGHT_TYPES) {
        colors[type] = asColor(raw[type], exports.DEFAULT_HIGHLIGHT_COLORS[type]);
    }
    return colors;
}
/** Split a semicolon-separated setting into clean entries. */
function splitPathList(value) {
    return asString(value)
        .split(';')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
}
/**
 * Expand `$PROJECT` / `$PROJECT_NAME` against every project root.
 *
 * Each root gets its own expansion of the original template. The previous
 * implementation reassigned the template in place while looping, so with two
 * roots open the second was substituted into a string already resolved against
 * the first, producing a nonsense path. Upstream issue #312.
 */
function applySubstitutions(templates, projectPaths) {
    const expanded = [];
    const push = (value) => {
        if (value && !expanded.includes(value))
            expanded.push(value);
    };
    for (const template of templates) {
        if (!template)
            continue;
        if (!/\$PROJECT/i.test(template)) {
            push(template);
            continue;
        }
        for (const projectPath of projectPaths) {
            const projectName = path.basename(projectPath);
            push(template
                .replace(/\$PROJECT_NAME/gi, projectName)
                .replace(/\$PROJECT/gi, projectPath));
        }
    }
    return expanded;
}
/** Apply defaults and coerce types. Never throws. */
function resolveSettings(raw = {}) {
    const useSnippets = asString(raw.useSnippets, 'none');
    return {
        selectedInterpreter: asString(raw.selectedInterpreter).trim(),
        pythonPaths: splitPathList(raw.pythonPaths),
        extraPaths: splitPathList(raw.extraPaths),
        useSnippets: SNIPPET_MODES.includes(useSnippets) ? useSnippets : 'none',
        showDescriptions: asBoolean(raw.showDescriptions, true),
        caseInsensitiveCompletion: asBoolean(raw.caseInsensitiveCompletion, true),
        fuzzyMatcher: asBoolean(raw.fuzzyMatcher, true),
        triggerCompletionRegex: asString(raw.triggerCompletionRegex, exports.DEFAULT_TRIGGER_REGEX),
        showTooltips: asBoolean(raw.showTooltips, false),
        semanticHighlight: asBoolean(raw.semanticHighlight, false),
        semanticHighlightTypes: parseHighlightTypes(raw.semanticHighlightTypes),
        semanticHighlightColors: parseHighlightColors(raw.semanticHighlightColors),
        suggestionPriority: asNumber(raw.suggestionPriority, 3),
        daemonIdleTimeout: Math.max(0, asNumber(raw.daemonIdleTimeout, 10)),
        outputProviderErrors: asBoolean(raw.outputProviderErrors, false),
        outputDebug: asBoolean(raw.outputDebug, false),
        runArguments: asString(raw.runArguments),
        runWorkingDirectory: WORKING_DIRECTORY_MODES.includes(asString(raw.runWorkingDirectory, 'file'))
            ? asString(raw.runWorkingDirectory, 'file')
            : 'file',
        saveBeforeRun: asBoolean(raw.saveBeforeRun, true),
        clearOutputOnRun: asBoolean(raw.clearOutputOnRun, true),
        showOutputOnRun: asBoolean(raw.showOutputOnRun, true),
        outputFontSize: Math.max(0, asNumber(raw.outputFontSize, 0))
    };
}
/**
 * Compile the user's trigger pattern, falling back to the default when it does
 * not compile. Returns the error too, so the caller can tell the user once
 * rather than swallowing it.
 */
function compileTriggerRegex(source) {
    try {
        return { regex: new RegExp(source), error: null };
    }
    catch (err) {
        return {
            regex: new RegExp(exports.DEFAULT_TRIGGER_REGEX),
            error: String(err)
        };
    }
}
/** The schema Pulsar reads to build the settings pane. */
exports.configSchema = {
    selectedInterpreter: {
        type: 'string',
        default: '',
        order: 0,
        title: 'Selected Interpreter',
        description: 'Full path to the interpreter chosen through **Autocomplete Python Pulsar: Select Interpreter** or the status bar. Takes priority over everything below. Clear it to go back to automatic discovery.'
    },
    showDescriptions: {
        type: 'boolean',
        default: true,
        order: 1,
        title: 'Show Descriptions',
        description: 'Show docstrings for functions, classes and modules.'
    },
    useSnippets: {
        type: 'string',
        default: 'none',
        order: 2,
        enum: SNIPPET_MODES,
        title: 'Autocomplete Function Parameters',
        description: 'Fill in function arguments after typing the opening parenthesis. `required` inserts only parameters without a default. Use the `autocomplete-python-pulsar:complete-arguments` command to trigger this manually. Requires the bundled `snippets` package.'
    },
    pythonPaths: {
        type: 'string',
        default: '',
        order: 3,
        title: 'Python Executable Paths',
        description: 'Semicolon-separated list of full paths to Python executables, highest priority first. When empty, the package looks at `VIRTUAL_ENV`/`CONDA_PREFIX`, then virtual environments inside your project, then Poetry, Pipenv, pyenv and Conda environments, then `PATH`. `$PROJECT` and `$PROJECT_NAME` are substituted per project root, e.g. `$PROJECT/.venv/bin/python;/usr/bin/python3`.'
    },
    extraPaths: {
        type: 'string',
        default: '',
        order: 4,
        title: 'Extra Paths For Packages',
        description: 'Semicolon-separated list of additional import paths for Jedi. Supports the same `$PROJECT` / `$PROJECT_NAME` substitutions. Packages installed into the interpreter above are already visible and do not need to be listed.'
    },
    caseInsensitiveCompletion: {
        type: 'boolean',
        default: true,
        order: 5,
        title: 'Case Insensitive Completion',
        description: 'Match completions regardless of case.'
    },
    triggerCompletionRegex: {
        type: 'string',
        default: exports.DEFAULT_TRIGGER_REGEX,
        order: 6,
        title: 'Regex To Trigger Autocompletions',
        description: 'Completions are requested when the prefix matches this pattern. Applied immediately - no restart needed.'
    },
    fuzzyMatcher: {
        type: 'boolean',
        default: true,
        order: 7,
        title: 'Use Fuzzy Matcher For Completions',
        description: 'Typing `stdr` matches `stderr`. The first character must always match. Also lets one Jedi lookup serve a whole identifier, so completions are faster.'
    },
    showTooltips: {
        type: 'boolean',
        default: false,
        order: 8,
        title: 'Show Tooltips',
        description: 'Show the docstring of the symbol under the cursor as an editor overlay.'
    },
    semanticHighlight: {
        type: 'boolean',
        default: false,
        order: 19,
        title: 'Semantic Highlighting',
        description: 'Recolor identifiers by what Jedi knows them to be - function, class, parameter, builtin, constant, module - layered on top of the grammar. Updates shortly after you stop typing. Needs a working interpreter, same as completions.'
    },
    semanticHighlightTypes: {
        type: 'array',
        default: [...exports.SEMANTIC_HIGHLIGHT_TYPES],
        order: 20,
        title: 'Semantic Highlighting: Enabled Kinds',
        description: 'Which name kinds get recolored. Remove a kind to leave it to the grammar. Applies once you stop typing.',
        items: { type: 'string', enum: [...exports.SEMANTIC_HIGHLIGHT_TYPES] }
    },
    semanticHighlightColors: {
        type: 'object',
        order: 21,
        title: 'Semantic Highlighting: Colors',
        description: 'Override the color of a kind. Left at the default, a kind adapts to light themes automatically; a custom color is used exactly as set.',
        properties: {
            function: { type: 'color', default: '#61afef', order: 1, title: 'Function / Property' },
            property: { type: 'color', default: '#d16d9e', order: 2, title: 'Property' },
            magic: { type: 'color', default: '#61afef', order: 3, title: 'Dunder Method' },
            decorator: { type: 'color', default: '#e5c07b', order: 4, title: 'Decorator' },
            class: { type: 'color', default: '#e5c07b', order: 5, title: 'Class' },
            param: { type: 'color', default: '#d19a66', order: 6, title: 'Parameter' },
            self: { type: 'color', default: '#e06c75', order: 7, title: 'self / cls' },
            builtin: { type: 'color', default: '#56b6c2', order: 8, title: 'Builtin' },
            constant: { type: 'color', default: '#c678dd', order: 9, title: 'Constant' },
            module: { type: 'color', default: '#98c379', order: 10, title: 'Module' }
        }
    },
    suggestionPriority: {
        type: 'integer',
        default: 3,
        minimum: 0,
        maximum: 99,
        order: 9,
        title: 'Suggestion Priority',
        description: 'Ranking of these suggestions against other autocomplete-plus providers. Snippets use 2, so a lower value here puts Python completions above them.'
    },
    daemonIdleTimeout: {
        type: 'integer',
        default: 10,
        minimum: 0,
        maximum: 1440,
        order: 10,
        title: 'Daemon Idle Timeout (minutes)',
        description: 'Shut the Python completion process down after this many minutes without a request; it restarts on the next one. Set to 0 to keep it running for the whole session.'
    },
    outputProviderErrors: {
        type: 'boolean',
        default: false,
        order: 11,
        title: 'Output Provider Errors',
        description: 'Show tracebacks coming from the completion daemon as notifications. Errors that stop the package from working are always shown.'
    },
    runArguments: {
        type: 'string',
        default: '',
        order: 13,
        title: 'Run: Script Arguments',
        description: 'Arguments passed to the script when you run it. Quoted runs are kept together; no shell is involved.'
    },
    runWorkingDirectory: {
        type: 'string',
        default: 'file',
        enum: WORKING_DIRECTORY_MODES,
        order: 14,
        title: 'Run: Working Directory',
        description: '`file` runs from the file\'s own directory, matching `python script.py` in a terminal. `project` runs from the project root, matching how the code usually runs in production.'
    },
    saveBeforeRun: {
        type: 'boolean',
        default: true,
        order: 15,
        title: 'Run: Save Before Running',
        description: 'Save the file first, so you never run a stale version of it.'
    },
    clearOutputOnRun: {
        type: 'boolean',
        default: true,
        order: 16,
        title: 'Run: Clear Output On Each Run',
        description: 'Empty the output pane when a new run starts.'
    },
    showOutputOnRun: {
        type: 'boolean',
        default: true,
        order: 17,
        title: 'Run: Show Output On Run',
        description: 'Reveal the output pane when a run starts. Focus stays in the editor either way.'
    },
    outputFontSize: {
        type: 'integer',
        default: 0,
        minimum: 0,
        maximum: 72,
        order: 18,
        title: 'Run: Output Font Size (pixels)',
        description: 'Font size for the run output pane. Set to 0 to follow the editor font size.'
    },
    outputDebug: {
        type: 'boolean',
        default: false,
        order: 12,
        title: 'Output Debug Logs',
        description: 'Write detailed logs to the developer tools console. Slows the editor down.'
    }
};
//# sourceMappingURL=config.js.map