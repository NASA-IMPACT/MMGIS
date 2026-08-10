import { test, expect } from 'vitest'
import express from 'express'
import fs from 'fs'
import http from 'http'
import path from 'path'

// Tests for the Upload module's lean-mode storage repoint: in lean mode the
// router writes validated images to the shared S3 asset bucket (via an
// injected mock client — no test here ever calls real AWS) and returns a
// root-relative /assets/… path; in full mode it keeps writing to Missions/
// on disk and never touches S3.
//
// The router asks capabilities.js (enabled('s3AssetUploads')), which resolves
// the deployment mode through API/Backend/Utils/deploymentMode.js once at load
// — so each test clears the require cache for the router AND both mode modules
// and re-requires under a fresh environment (same pattern as
// deploymentMode.spec.js). The HTTP harness
// mirrors Card/uploadRouting.spec.js — a real express server on an ephemeral
// port — but drives it with http.request and a hand-built multipart body
// rather than global fetch: Card/uploadImage.spec.js replaces global.fetch
// with a mock and never restores it, which poisons any later fetch-based
// spec sharing its worker.

const ROUTER_PATH = '../../API/Backend/Upload/uploadRouter.js'
const MODE_PATH = '../../API/Backend/Utils/deploymentMode.js'
const CAPS_PATH = '../../API/Backend/Utils/capabilities.js'
const MISSIONS_DIR = path.join(__dirname, '../../Missions')

const ENV_KEYS = ['MMGIS_DEPLOYMENT_MODE', 'MMGIS_SHARED_ASSET_BUCKET']

function freshRouterModule(env) {
    ENV_KEYS.forEach((key) => {
        if (env[key] === undefined) delete process.env[key]
        else process.env[key] = env[key]
    })
    delete require.cache[require.resolve(MODE_PATH)]
    delete require.cache[require.resolve(CAPS_PATH)]
    delete require.cache[require.resolve(ROUTER_PATH)]
    return require(ROUTER_PATH)
}

async function startServer(routerModule, options = {}) {
    const app = express()
    app.use(
        '/api/upload',
        routerModule.createUploadRouter({ routePath: '/', ...options })
    )
    return await new Promise((resolve) => {
        const server = app.listen(0, () => {
            resolve({
                server,
                base: `http://127.0.0.1:${server.address().port}`,
            })
        })
    })
}

function closeServer(server) {
    return new Promise((resolve) => server.close(resolve))
}

function mockS3() {
    const calls = []
    return {
        calls,
        client: {
            send: async (command) => {
                calls.push(command)
                return {}
            },
        },
    }
}

// POST a single-file multipart upload and resolve { status, body }.
function postUpload(base, query, bytes, type = 'image/png', name = 'test.png') {
    const boundary = '----UploadRouterS3SpecBoundary'
    const payload = Buffer.concat([
        Buffer.from(
            `--${boundary}\r\n` +
                `Content-Disposition: form-data; name="image"; filename="${name}"\r\n` +
                `Content-Type: ${type}\r\n\r\n`
        ),
        bytes,
        Buffer.from(`\r\n--${boundary}--\r\n`),
    ])
    return new Promise((resolve, reject) => {
        const req = http.request(
            `${base}/api/upload?${query}`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': payload.length,
                },
            },
            (res) => {
                let data = ''
                res.on('data', (chunk) => (data += chunk))
                res.on('end', () =>
                    resolve({ status: res.statusCode, body: JSON.parse(data) })
                )
            }
        )
        req.on('error', reject)
        req.end(payload)
    })
}

const PNG_BYTES = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')

test.describe('upload router lean-mode S3 storage', () => {
    let savedEnv

    test.beforeEach(() => {
        savedEnv = {}
        ENV_KEYS.forEach((key) => {
            savedEnv[key] = process.env[key]
        })
    })

    test.afterEach(() => {
        ENV_KEYS.forEach((key) => {
            if (savedEnv[key] === undefined) delete process.env[key]
            else process.env[key] = savedEnv[key]
        })
        delete require.cache[require.resolve(MODE_PATH)]
        delete require.cache[require.resolve(CAPS_PATH)]
        delete require.cache[require.resolve(ROUTER_PATH)]
    })

    test('lean: PutObject to the asset bucket, root-relative /assets/ path, nothing on disk', async () => {
        const mission = `LeanUploadSpec${Date.now()}`
        const routerModule = freshRouterModule({
            MMGIS_DEPLOYMENT_MODE: 'lean',
            MMGIS_SHARED_ASSET_BUCKET: 'test-asset-bucket',
        })
        const s3 = mockS3()
        routerModule.setS3Client(s3.client)
        const { server, base } = await startServer(routerModule)
        try {
            const res = await postUpload(
                base,
                `mission=${encodeURIComponent(mission)}&subdir=CardPlugin`,
                PNG_BYTES
            )
            expect(res.status).toBe(200)
            const body = res.body
            expect(body.status).toBe('success')
            // Root-relative (leading slash), mission-scoped, uuid filename.
            expect(body.path).toMatch(
                new RegExp(
                    `^/assets/${mission}/CardPlugin/uploads/[0-9a-f-]{36}\\.png$`
                )
            )

            expect(s3.calls.length).toBe(1)
            const cmd = s3.calls[0]
            expect(cmd.constructor.name).toBe('PutObjectCommand')
            expect(cmd.input.Bucket).toBe('test-asset-bucket')
            // The S3 key is the response path without the leading slash.
            expect(cmd.input.Key).toBe(body.path.slice(1))
            expect(cmd.input.ContentType).toBe('image/png')
            expect(Buffer.compare(cmd.input.Body, PNG_BYTES)).toBe(0)
            expect(cmd.input.ContentLength).toBe(PNG_BYTES.length)

            // No partial/parallel write under Missions/.
            expect(fs.existsSync(path.join(MISSIONS_DIR, mission))).toBe(false)
        } finally {
            await closeServer(server)
        }
    })

    test('lean: oversize upload -> 413 and no PutObject (no partial object)', async () => {
        const routerModule = freshRouterModule({
            MMGIS_DEPLOYMENT_MODE: 'lean',
            MMGIS_SHARED_ASSET_BUCKET: 'test-asset-bucket',
        })
        const s3 = mockS3()
        routerModule.setS3Client(s3.client)
        const { server, base } = await startServer(routerModule, {
            maxFileBytes: 64,
        })
        try {
            const res = await postUpload(
                base,
                'mission=MSL&subdir=CardPlugin',
                Buffer.alloc(1024, 1)
            )
            expect(res.status).toBe(413)
            expect(res.body.status).toBe('failure')
            expect(s3.calls.length).toBe(0)
        } finally {
            await closeServer(server)
        }
    })

    test('lean: path-traversal mission name -> 400 and no PutObject', async () => {
        const routerModule = freshRouterModule({
            MMGIS_DEPLOYMENT_MODE: 'lean',
            MMGIS_SHARED_ASSET_BUCKET: 'test-asset-bucket',
        })
        const s3 = mockS3()
        routerModule.setS3Client(s3.client)
        const { server, base } = await startServer(routerModule)
        try {
            const res = await postUpload(
                base,
                `mission=${encodeURIComponent('../escape')}&subdir=CardPlugin`,
                PNG_BYTES
            )
            expect(res.status).toBe(400)
            expect(res.body.message).toBe('Invalid or missing mission')
            expect(s3.calls.length).toBe(0)
        } finally {
            await closeServer(server)
        }
    })

    test('lean: unsupported MIME type -> 400 and no PutObject', async () => {
        const routerModule = freshRouterModule({
            MMGIS_DEPLOYMENT_MODE: 'lean',
            MMGIS_SHARED_ASSET_BUCKET: 'test-asset-bucket',
        })
        const s3 = mockS3()
        routerModule.setS3Client(s3.client)
        const { server, base } = await startServer(routerModule)
        try {
            const res = await postUpload(
                base,
                'mission=MSL&subdir=CardPlugin',
                PNG_BYTES,
                'text/plain',
                'x.txt'
            )
            expect(res.status).toBe(400)
            expect(res.body.message).toBe('Unsupported image type')
            expect(s3.calls.length).toBe(0)
        } finally {
            await closeServer(server)
        }
    })

    test('lean: missing MMGIS_SHARED_ASSET_BUCKET -> graceful 500, no PutObject', async () => {
        const routerModule = freshRouterModule({
            MMGIS_DEPLOYMENT_MODE: 'lean',
            MMGIS_SHARED_ASSET_BUCKET: undefined,
        })
        const s3 = mockS3()
        routerModule.setS3Client(s3.client)
        const { server, base } = await startServer(routerModule)
        try {
            const res = await postUpload(
                base,
                'mission=MSL&subdir=CardPlugin',
                PNG_BYTES
            )
            expect(res.status).toBe(500)
            expect(res.body.status).toBe('failure')
            expect(s3.calls.length).toBe(0)
        } finally {
            await closeServer(server)
        }
    })

    test('full: writes to Missions/ disk, mission-relative path, S3 untouched', async () => {
        const mission = `FullUploadSpec${Date.now()}`
        const missionDir = path.join(MISSIONS_DIR, mission)
        const routerModule = freshRouterModule({
            MMGIS_DEPLOYMENT_MODE: 'full',
            // Set the bucket too: full mode must ignore it entirely.
            MMGIS_SHARED_ASSET_BUCKET: 'test-asset-bucket',
        })
        // Inject a tripwire client: any S3 use in full mode fails the test.
        const s3 = mockS3()
        routerModule.setS3Client(s3.client)
        const { server, base } = await startServer(routerModule)
        try {
            const res = await postUpload(
                base,
                `mission=${encodeURIComponent(mission)}&subdir=CardPlugin`,
                PNG_BYTES
            )
            expect(res.status).toBe(200)
            const body = res.body
            expect(body.status).toBe('success')
            // Mission-relative, no leading slash — byte-for-byte today's shape.
            expect(body.path).toMatch(
                /^CardPlugin\/uploads\/[0-9a-f-]{36}\.png$/
            )
            const written = fs.readFileSync(path.join(missionDir, body.path))
            expect(Buffer.compare(written, PNG_BYTES)).toBe(0)
            expect(s3.calls.length).toBe(0)
        } finally {
            await closeServer(server)
            fs.rmSync(missionDir, { recursive: true, force: true })
        }
    })
})
