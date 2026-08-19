import { test, expect } from 'vitest'
import {
    copyShareLink,
    downloadSharePng,
    downloadSharePdf,
    PNG_FILENAME,
    PDF_FILENAME,
    buildExportFilename,
} from '../../../src/essence/Tools/_shared/adapters/shareActions.ts'
import {
    mmgisCopyText,
    mmgisWriteCoordinateURL,
    mmgisGetMapScreenshot,
    mmgisGetViewState,
} from '../../../src/essence/Tools/_shared/adapters/mmgisAPI.ts'

// Issue #144 - the adapter must call the right plugin-API methods and package
// the results. All core access is injected here so the wiring is exercised
// without a live map or DOM.

test.describe('copyShareLink', () => {
    test('copies the share URL via copyText and returns it', async () => {
        const copied = []
        const url = await copyShareLink({
            writeCoordinateURL: async () => 'https://mmgis/?v=1',
            copyText: async (text) => {
                copied.push(text)
                return true
            },
        })
        expect(url).toBe('https://mmgis/?v=1')
        expect(copied).toEqual(['https://mmgis/?v=1'])
    })

    test('throws when no link is available', async () => {
        await expect(
            copyShareLink({
                writeCoordinateURL: async () => null,
                copyText: async () => true,
            }),
        ).rejects.toThrow('No share link available')
    })

    test('throws when the clipboard write fails (copyText false)', async () => {
        // copyText never rejects; failure surfaces as false, which the action
        // converts to a throw so the adapter's existing catch handles it.
        await expect(
            copyShareLink({
                writeCoordinateURL: async () => 'https://mmgis/?v=1',
                copyText: async () => false,
            }),
        ).rejects.toThrow('Clipboard copy failed')
    })
})

// A fake core bus: hasHandler answers from the given responses map, and
// request() records every call, throwing on unregistered names exactly like
// the real bus does.
function makeBusApi(responses) {
    const requests = []
    return {
        api: {
            hasHandler: (name) => name in responses,
            request: async (name, params) => {
                requests.push({ name, params })
                if (!(name in responses))
                    throw new Error(`[mmgisAPI] No handler for: "${name}"`)
                return responses[name]
            },
        },
        requests,
    }
}

test.describe('bus wiring of the shared-client wrappers', () => {
    // The wrappers are the plugin's only strings-on-the-bus site; pin each
    // one to its registered core name so a rename can't silently no-op.
    test('each wrapper requests its registered bus name', async () => {
        const screenshot = { blob: new Blob(['p']), extension: 'png' }
        const viewState = { missionName: 'M', time: null, center: null, zoom: 2 }
        const { api, requests } = makeBusApi({
            'map:writeCoordinateURL': 'https://mmgis/?v=1',
            'map:getScreenshot': screenshot,
            'map:getViewState': viewState,
            'app:copyText': true,
        })
        window.mmgisAPI = api
        try {
            await expect(mmgisWriteCoordinateURL()).resolves.toBe(
                'https://mmgis/?v=1',
            )
            await expect(mmgisGetMapScreenshot()).resolves.toBe(screenshot)
            await expect(mmgisGetViewState()).resolves.toBe(viewState)
            await expect(mmgisCopyText('hello')).resolves.toBe(true)
            expect(requests.map((r) => r.name)).toEqual([
                'map:writeCoordinateURL',
                'map:getScreenshot',
                'map:getViewState',
                'app:copyText',
            ])
            expect(requests[3].params).toBe('hello')
        } finally {
            delete window.mmgisAPI
        }
    })

    test('wrappers resolve null when core is absent', async () => {
        delete window.mmgisAPI
        await expect(mmgisWriteCoordinateURL()).resolves.toBe(null)
        await expect(mmgisGetMapScreenshot()).resolves.toBe(null)
        await expect(mmgisGetViewState()).resolves.toBe(null)
    })

    test('wrappers resolve null (not reject) on a bus-era core that predates the share handlers', async () => {
        // Version skew: the core has request/provide but none of the four
        // share registrations. Every wrapper must degrade to null so the
        // actions surface their designed errors ('No share link available')
        // instead of a raw '[mmgisAPI] No handler for' rejection.
        const { api, requests } = makeBusApi({})
        window.mmgisAPI = api
        try {
            await expect(mmgisWriteCoordinateURL()).resolves.toBe(null)
            await expect(mmgisGetMapScreenshot()).resolves.toBe(null)
            await expect(mmgisGetViewState()).resolves.toBe(null)
            // hasHandler said no, so request() must never have been risked.
            expect(requests).toEqual([])
        } finally {
            delete window.mmgisAPI
        }
    })

    test('handler errors still propagate (they are real failures, not skew)', async () => {
        const { api } = makeBusApi({ 'map:getScreenshot': null })
        api.request = async () => {
            throw new Error('getMapScreenshot: no active map engine')
        }
        window.mmgisAPI = api
        try {
            await expect(mmgisGetMapScreenshot()).rejects.toThrow(
                /no active map engine/,
            )
        } finally {
            delete window.mmgisAPI
        }
    })
})

test.describe('mmgisCopyText wrapper', () => {
    test('returns false on old cores without a modern clipboard', async () => {
        // No app:copyText handler and no navigator.clipboard (insecure
        // origin): the wrapper deliberately degrades to false rather than
        // vendoring the legacy execCommand path per plugin.
        delete window.mmgisAPI
        await expect(mmgisCopyText('hello')).resolves.toBe(false)
    })

    test('falls back past a core that lacks the handler', async () => {
        // hasHandler false → the wrapper must not call request() (which
        // would throw), and with no clipboard available resolves false.
        const { api, requests } = makeBusApi({})
        window.mmgisAPI = api
        try {
            await expect(mmgisCopyText('hello')).resolves.toBe(false)
            expect(requests).toEqual([])
        } finally {
            delete window.mmgisAPI
        }
    })
})

test.describe('downloadSharePng', () => {
    test('fetches the screenshot Blob and downloads it as a PNG', async () => {
        const downloads = []
        const screenshotCalls = []
        const blob = new Blob(['PNGDATA'], { type: 'image/png' })
        const screenshot = {
            blob,
            mimeType: 'image/png',
            extension: 'png',
            width: 1024,
            height: 768,
        }
        const result = await downloadSharePng({
            getScreenshot: async () => {
                screenshotCalls.push(true)
                return screenshot
            },
            download: (downloadedBlob, filename) =>
                downloads.push({ blob: downloadedBlob, filename }),
        })
        expect(screenshotCalls.length).toBe(1)
        expect(result).toBe(screenshot)
        expect(downloads).toEqual([
            { blob, filename: PNG_FILENAME },
        ])
    })

    test('throws when no screenshot is available', async () => {
        await expect(
            downloadSharePng({
                getScreenshot: async () => null,
                download: () => {},
            }),
        ).rejects.toThrow('No screenshot available')
    })
})

test.describe('downloadSharePdf', () => {
    test('converts the screenshot Blob only for jsPDF and saves it', async () => {
        const saved = []
        const buildArgs = []
        const blob = new Blob(['PNGDATA'], { type: 'image/png' })
        const screenshot = {
            blob,
            mimeType: 'image/png',
            extension: 'png',
            width: 1024,
            height: 768,
        }
        const fakeDoc = {
            save: (filename) => saved.push(filename),
        }
        const doc = await downloadSharePdf({
            getScreenshot: async () => screenshot,
            blobToDataUrl: async (input) => {
                expect(input).toBe(blob)
                return 'data:image/png;base64,PNGDATA'
            },
            buildPdf: (data, w, h) => {
                buildArgs.push({ data, w, h })
                return fakeDoc
            },
        })
        expect(doc).toBe(fakeDoc)
        expect(buildArgs).toEqual([
            { data: 'data:image/png;base64,PNGDATA', w: 1024, h: 768 },
        ])
        expect(saved).toEqual([PDF_FILENAME])
    })

    test('throws when no screenshot is available', async () => {
        await expect(
            downloadSharePdf({
                getScreenshot: async () => null,
                blobToDataUrl: async () => 'data:image/png;base64,PNGDATA',
                buildPdf: () => ({ save: () => {} }),
            }),
        ).rejects.toThrow('No screenshot available')
    })
})

test.describe('buildExportFilename', () => {
    test('builds the core convention from a full view state', () => {
        const name = buildExportFilename('png', {
            missionName: 'MSL',
            time: '2026-07-01T12:00:00Z',
            center: { lat: 4.58921, lng: 137.44162 },
            zoom: 7,
        })
        expect(name).toBe('mmgis-MSL_2026-07-01T12-00-00Z_4.5892_137.4416.png')
    })

    test('omits fields the view cannot answer yet', () => {
        const name = buildExportFilename('pdf', {
            missionName: 'MSL',
            time: null,
            center: null,
            zoom: null,
        })
        expect(name).toBe('mmgis-MSL.pdf')
    })

    test('degrades to the generic name with no view state', () => {
        expect(buildExportFilename('png', null)).toBe('mmgis-map.png')
    })
})

test.describe('legend compositing in downloadSharePng', () => {
    const screenshot = {
        blob: new Blob(['png'], { type: 'image/png' }),
        mimeType: 'image/png',
        extension: 'png',
        width: 640,
        height: 480,
    }
    const composedBlob = new Blob(['composed'], { type: 'image/png' })
    const composed = { ...screenshot, blob: composedBlob, height: 700 }
    const emptyModel = { missionName: null, timeLabel: null, rows: [] }

    test('composes by default and downloads the composed blob', async () => {
        const composeCalls = []
        const downloads = []
        const result = await downloadSharePng({
            getScreenshot: async () => screenshot,
            download: (blob, filename) => downloads.push({ blob, filename }),
            getLegendModel: async () => emptyModel,
            compose: async (shot, model) => {
                composeCalls.push({ shot, model })
                return composed
            },
        })
        expect(composeCalls).toEqual([{ shot: screenshot, model: emptyModel }])
        expect(downloads).toEqual([
            { blob: composedBlob, filename: PNG_FILENAME },
        ])
        expect(result).toBe(composed)
    })

    test('includeLegend: false skips the legend entirely', async () => {
        const getLegendModel = () => {
            throw new Error('should not be called')
        }
        const compose = () => {
            throw new Error('should not be called')
        }
        const downloads = []
        const result = await downloadSharePng({
            getScreenshot: async () => screenshot,
            download: (blob, filename) => downloads.push({ blob, filename }),
            includeLegend: false,
            getLegendModel,
            compose,
        })
        expect(downloads).toEqual([
            { blob: screenshot.blob, filename: PNG_FILENAME },
        ])
        expect(result).toBe(screenshot)
    })

    test('a legend model failure downloads the plain map instead of throwing', async () => {
        const downloads = []
        const result = await downloadSharePng({
            getScreenshot: async () => screenshot,
            download: (blob, filename) => downloads.push({ blob, filename }),
            getLegendModel: async () => {
                throw new Error('legend model blew up')
            },
        })
        expect(downloads).toEqual([
            { blob: screenshot.blob, filename: PNG_FILENAME },
        ])
        expect(result).toBe(screenshot)
    })
})

test.describe('legend compositing in downloadSharePdf', () => {
    const screenshot = {
        blob: new Blob(['png'], { type: 'image/png' }),
        mimeType: 'image/png',
        extension: 'png',
        width: 640,
        height: 480,
    }
    const composedBlob = new Blob(['composed'], { type: 'image/png' })
    const composed = { ...screenshot, blob: composedBlob, height: screenshot.height + 100 }
    const emptyModel = { missionName: null, timeLabel: null, rows: [] }

    test('buildPdf receives the composed width/height, not the original', async () => {
        const buildArgs = []
        const doc = await downloadSharePdf({
            getScreenshot: async () => screenshot,
            blobToDataUrl: async () => 'data:image/png;base64,x',
            buildPdf: (data, w, h) => {
                buildArgs.push({ w, h })
                return { save: () => {} }
            },
            getLegendModel: async () => emptyModel,
            compose: async () => composed,
        })
        expect(buildArgs).toEqual([{ w: composed.width, h: composed.height }])
        expect(doc).toBeTruthy()
    })

    test('includeLegend: false uses the original dimensions', async () => {
        const buildArgs = []
        await downloadSharePdf({
            getScreenshot: async () => screenshot,
            blobToDataUrl: async () => 'data:image/png;base64,x',
            buildPdf: (data, w, h) => {
                buildArgs.push({ w, h })
                return { save: () => {} }
            },
            includeLegend: false,
        })
        expect(buildArgs).toEqual([{ w: screenshot.width, h: screenshot.height }])
    })
})

test.describe('provenance filenames in downloads', () => {
    test('PNG download names the file from the injected view state', async () => {
        const blob = new Blob(['png'], { type: 'image/png' })
        const downloads = []
        await downloadSharePng({
            getScreenshot: async () => ({
                blob,
                mimeType: 'image/png',
                extension: 'png',
                width: 640,
                height: 480,
            }),
            download: (b, filename) => downloads.push(filename),
            getViewState: async () => ({
                missionName: 'Earth',
                time: null,
                center: { lat: 33.1, lng: -84.2 },
                zoom: 5,
            }),
        })
        expect(downloads).toEqual(['mmgis-Earth_33.1000_-84.2000.png'])
    })
})
