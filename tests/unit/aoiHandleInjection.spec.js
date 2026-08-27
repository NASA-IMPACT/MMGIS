import { describe, test, expect, vi, afterEach } from 'vitest'

// Viewer_ is JSX in a .js file that vite's import-analysis can't parse, and
// the real mmgisAPI pulls it in; nothing here needs a viewer. The panel
// component pulls in @trussworks/react-uswds and a SCSS entry point, and
// nothing here renders it.
vi.mock('../../src/essence/Basics/Viewer_/Viewer_', () => ({ default: {} }))
vi.mock('../../src/essence/Tools/AOI/AOIComponent', () => ({ default: () => null }))
vi.mock('react-dom/client', () => ({
    createRoot: () => ({ render() {}, unmount() {} }),
}))

const { mmgisAPI } = await import('../../src/essence/mmgisAPI/mmgisAPI')
const { default: L_ } = await import('../../src/essence/Basics/Layers_/Layers_')
const { default: AOITool } = await import('../../src/essence/Tools/AOI/AOITool')

// `getVars` reads the tool configuration off here; an unconfigured mission is
// an empty list, not the uninitialised null the module starts at.
L_.tools = []

/** Let make()'s boundary load settle before the tool is taken back down. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

afterEach(() => {
    AOITool.destroy()
    AOITool.api?.release?.()
    delete AOITool.api
    document.getElementById('toolPanel')?.remove()
    delete window.mmgisAPI
    // A spy left installed by a test that failed part-way would otherwise
    // silence console.warn for every test after it.
    vi.restoreAllMocks()
})

/** Mount the tool into a fresh panel, the way the controller does. */
async function mount() {
    window.mmgisAPI = mmgisAPI
    const container = document.createElement('div')
    container.id = 'toolPanel'
    document.body.appendChild(container)
    AOITool.make('toolPanel')
    await flush()
}

/**
 * The controller mints a plugin's bus handle and hands it over before the
 * tool runs any of its own code. Minting a second one for the same id would
 * re-register that id's `getVars` provider over the live one — which the bus
 * reports as a replaced handler, and which leaves the controller holding a
 * handle whose release no longer unregisters what is actually installed.
 */
describe('the handle AOI runs on', () => {
    test('is the one the controller injected, not a second mint', async () => {
        const injected = mmgisAPI.forPlugin('aoi')
        AOITool.api = injected

        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        await mount()

        expect(AOITool._api).toBe(injected)
        expect(
            warn.mock.calls
                .map((call) => String(call[0]))
                .filter((message) => message.includes('is being replaced'))
        ).toEqual([])
    })

    test('falls back to an inert stand-in when nothing injected one', async () => {
        // `provide` is the one call the tool does not guard, so make()
        // returning at all is the assertion that the stand-in answers it.
        await mount()

        // Reads the plugin's configuration off the handle; the stand-in has no
        // variables, so the built-in shapes stand.
        expect(AOITool._resolveDrawShapes()).toEqual([
            'polygon',
            'rectangle',
            'circle',
        ])

        // Clearing a selection broadcasts `drawingCleared` and re-renders —
        // the tool's own emit path, running against the stand-in.
        AOITool._state.currentAOI = { feature: null, source: 'draw', label: 'x' }
        expect(() => AOITool._clearSelection()).not.toThrow()
        expect(AOITool._state.currentAOI).toBeNull()

        // And the blind popup retract, which is the request path.
        expect(() => AOITool._hidePopup()).not.toThrow()
    })
})
