// Pure, testable logic for seeding tool metadata into config.json files.
// No filesystem or DOM access — the wrapper (scripts/seed-tool-metadata.js)
// handles I/O. The metadata schema mirrors ToolMetadataUtils.js /
// PanelManager_/types/layout.ts. If PANEL_POSITION or TOOL_ORIENTATION change
// in those TS files, update POSITIONS / ORIENTATIONS here to match.

const POSITIONS = [
    'top',
    'left',
    'right',
    'bottom',
    'float-top-left',
    'float-top-center',
    'float-top-right',
    'float-bottom-left',
    'float-bottom-center',
    'float-bottom-right',
]

const ORIENTATIONS = ['any', 'horizontal', 'vertical']

// Marker key placed on the generated row so re-runs can find and replace it.
const MANAGED_KEY = '_metadataManaged'

function computeLegacyDefaults(config) {
    return {
        modernLayoutSupport: false,
        requiredOrientation: 'any',
        compatiblePositions: ['top', 'left', 'right', 'bottom'],
        preferredPosition: 'left',
        width: typeof config.width === 'number' ? config.width : 300,
        height: typeof config.height === 'number' ? config.height : 0,
        separatedTool: false,
        expandable: false,
        startHidden: false,
        startUnloaded: false,
    }
}

function switchComp(field, name, description, value) {
    return { field, name, description, type: 'switch', width: 4, defaultChecked: !!value }
}

function numberComp(field, name, description, value) {
    return { field, name, description, type: 'number', width: 4, min: 0, max: 2000, step: 1, default: value }
}

function buildMetadataSection(defaults) {
    const d = defaults
    return {
        subname: 'Modern Layout',
        subdescription:
            'Metadata the modern layout system uses to place this tool into panels. These values are saved to this mission’s configuration.',
        [MANAGED_KEY]: true,
        components: [
            switchComp(
                'metadata.modernLayoutSupport',
                'Modern Layout Support',
                'Whether this tool can be placed by the modern layout system.',
                d.modernLayoutSupport
            ),
            {
                field: 'metadata.requiredOrientation',
                name: 'Required Orientation',
                description:
                    'Restricts which panels this tool can go in. "vertical" → left/right, "horizontal" → top/bottom, "any" → no restriction.',
                type: 'dropdown',
                width: 4,
                options: ORIENTATIONS,
                default: d.requiredOrientation,
            },
            {
                field: 'metadata.compatiblePositions',
                name: 'Compatible Positions',
                description: 'The specific panel positions this tool is allowed in.',
                type: 'multiselect',
                width: 4,
                options: POSITIONS,
                default: d.compatiblePositions,
            },
            {
                field: 'metadata.preferredPosition',
                name: 'Preferred Position',
                description: 'The position this tool should ideally be placed in.',
                type: 'dropdown',
                width: 4,
                options: POSITIONS,
                default: d.preferredPosition,
            },
            numberComp('metadata.width', 'Width (px)', 'Preferred panel width in pixels (0 = auto).', d.width),
            numberComp('metadata.height', 'Height (px)', 'Preferred panel height in pixels (0 = auto).', d.height),
            switchComp(
                'metadata.separatedTool',
                'Separated Tool',
                'Whether this tool renders separated from the standard tool panel.',
                d.separatedTool
            ),
            switchComp(
                'metadata.expandable',
                'Expandable',
                'Whether this tool can expand beyond its default size.',
                d.expandable
            ),
            switchComp(
                'metadata.startHidden',
                'Start Hidden',
                'Whether this tool starts hidden.',
                d.startHidden
            ),
            switchComp(
                'metadata.startUnloaded',
                'Start Unloaded',
                'Whether this tool starts unloaded (not instantiated until first shown).',
                d.startUnloaded
            ),
        ],
    }
}

// Idempotently inject the metadata block + Modern Layout editor row into a tool
// config object. Returns the same object (mutated) for convenience.
function injectMetadata(config, toolName) {
    // 1. Defaults: keep an existing block (modern tools), else compute legacy.
    const defaults =
        config.metadata && typeof config.metadata === 'object'
            ? config.metadata
            : computeLegacyDefaults(config)

    // 2. Ensure the block is present (unchanged if it already existed).
    config.metadata = defaults

    // 3. Ensure config.rows exists.
    if (!config.config || typeof config.config !== 'object') config.config = {}
    if (!Array.isArray(config.config.rows)) config.config.rows = []

    // 4. Remove any previously-managed row, then append a fresh one.
    config.config.rows = config.config.rows.filter((r) => !r || !r[MANAGED_KEY])
    config.config.rows.push(buildMetadataSection(defaults))

    return config
}

module.exports = {
    POSITIONS,
    ORIENTATIONS,
    MANAGED_KEY,
    computeLegacyDefaults,
    buildMetadataSection,
    injectMetadata,
}
