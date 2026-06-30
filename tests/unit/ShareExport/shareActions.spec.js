import { test, expect } from '@playwright/test'
import {
    copyShareLink,
    downloadSharePng,
    downloadSharePdf,
    writeTextToClipboard,
    PNG_FILENAME,
    PDF_FILENAME,
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
    test('fetches the screenshot and downloads it as a PNG', async () => {
        const downloads = []
        const screenshotCalls = []
        const dataUrl = await downloadSharePng({
            getScreenshot: async () => {
                screenshotCalls.push(true)
                return 'data:image/png;base64,PNGDATA'
            },
            download: (data, filename) => downloads.push({ data, filename }),
        })
        expect(screenshotCalls.length).toBe(1)
        expect(dataUrl).toBe('data:image/png;base64,PNGDATA')
        expect(downloads).toEqual([
            { data: 'data:image/png;base64,PNGDATA', filename: PNG_FILENAME },
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
    test('builds a PDF from the screenshot and saves it', async () => {
        const saved = []
        const buildArgs = []
        const fakeDoc = {
            save: (filename) => saved.push(filename),
        }
        const doc = await downloadSharePdf({
            getScreenshot: async () => 'data:image/png;base64,PNGDATA',
            getImageSize: async () => ({ width: 1024, height: 768 }),
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
                getImageSize: async () => ({ width: 1, height: 1 }),
                buildPdf: () => ({ save: () => {} }),
            }),
        ).rejects.toThrow('No screenshot available')
    })
})
