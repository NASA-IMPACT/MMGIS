import { test, expect } from '@playwright/test'
import { uploadCardImage } from '../../../configure/src/core/cardUpload.js'

const installFetchMock = (impl) => {
    global.window = global.window || {}
    global.window.mmgisglobal = { NODE_ENV: 'production', ROOT_PATH: '' }
    global.fetch = impl
    if (!global.FormData) {
        // Minimal FormData stand-in for the Node test env.
        global.FormData = class {
            constructor() {
                this._d = {}
            }
            append(k, v) {
                this._d[k] = v
            }
        }
    }
}

test.describe('uploadCardImage', () => {
    test('POSTs to the upload route and returns the path', async () => {
        let calledUrl = null
        let calledInit = null
        installFetchMock(async (url, init) => {
            calledUrl = url
            calledInit = init
            return {
                ok: true,
                json: async () => ({
                    status: 'success',
                    path: 'CardPlugin/uploads/x.png',
                }),
            }
        })
        const path = await uploadCardImage({ name: 'x.png' }, 'MSL')
        expect(path).toBe('CardPlugin/uploads/x.png')
        expect(calledUrl).toBe('api/cardplugin/upload?mission=MSL')
        expect(calledInit.method).toBe('POST')
    })

    test('throws on a failure response', async () => {
        installFetchMock(async () => ({
            ok: false,
            json: async () => ({
                status: 'failure',
                message: 'Unsupported image type',
            }),
        }))
        await expect(uploadCardImage({ name: 'x.svg' }, 'MSL')).rejects.toThrow(
            'Unsupported image type',
        )
    })
})
