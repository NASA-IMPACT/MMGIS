import { test, expect } from 'vitest'
import {
    copyShareLink,
    downloadSharePng,
    downloadSharePdf,
    writeTextToClipboard,
    PNG_FILENAME,
    PDF_FILENAME,
    buildExportFilename,
} from '../../../src/essence/Tools/ShareExport/adapters/shareActions.ts'

// Issue #144 - the adapter must call the right plugin-API methods and package
// the results. All core access is injected here so the wiring is exercised
// without a live map or DOM.

test.describe('copyShareLink', () => {
    test('writes the share URL to the clipboard and returns it', async () => {
        const clipboardWrites = []
        const url = await copyShareLink({
            writeCoordinateURL: () => 'https://mmgis/?v=1',
            writeClipboard: async (text) => {
                clipboardWrites.push(text)
            },
        })
        expect(url).toBe('https://mmgis/?v=1')
        expect(clipboardWrites).toEqual(['https://mmgis/?v=1'])
    })

    test('throws when no link is available', async () => {
        await expect(
            copyShareLink({
                writeCoordinateURL: () => null,
                writeClipboard: async () => {},
            }),
        ).rejects.toThrow('No share link available')
    })
})

test.describe('writeTextToClipboard', () => {
    function makeMockDocument(execResult = true) {
        const appended = []
        const removed = []
        const node = {
            value: '',
            style: {},
            selected: false,
            attrs: {},
            setAttribute(k, v) {
                this.attrs[k] = v
            },
            select() {
                this.selected = true
            },
        }
        return {
            _node: node,
            _appended: appended,
            _removed: removed,
            _execCalls: [],
            createElement: () => node,
            execCommand(cmd) {
                this._execCalls.push(cmd)
                return execResult
            },
            body: {
                appendChild: (n) => appended.push(n),
                removeChild: (n) => removed.push(n),
            },
        }
    }

    test('uses the async Clipboard API when available', async () => {
        const writes = []
        const nav = { clipboard: { writeText: async (t) => writes.push(t) } }
        const doc = makeMockDocument()

        await writeTextToClipboard('hello', { nav, doc })

        expect(writes).toEqual(['hello'])
        // The legacy fallback must not run when the modern API exists.
        expect(doc._execCalls).toEqual([])
    })

    test('falls back to a hidden textarea + execCommand on insecure origins', async () => {
        // navigator.clipboard is undefined on insecure origins (HTTP by IP).
        const nav = {}
        const doc = makeMockDocument(true)

        await writeTextToClipboard('share-url', { nav, doc })

        expect(doc._node.value).toBe('share-url')
        expect(doc._execCalls).toEqual(['copy'])
        // The transient textarea is appended and then cleaned up.
        expect(doc._appended).toEqual([doc._node])
        expect(doc._removed).toEqual([doc._node])
    })

    test('surfaces a failure when the fallback copy command is rejected', async () => {
        const nav = {}
        const doc = makeMockDocument(false)

        await expect(
            writeTextToClipboard('x', { nav, doc }),
        ).rejects.toThrow('Clipboard copy command was rejected')
        // Even on failure, the textarea must be removed (finally cleanup).
        expect(doc._removed).toEqual([doc._node])
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
            getViewState: () => ({
                missionName: 'Earth',
                time: null,
                center: { lat: 33.1, lng: -84.2 },
                zoom: 5,
            }),
        })
        expect(downloads).toEqual(['mmgis-Earth_33.1000_-84.2000.png'])
    })
})
