import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import fs from 'fs'
import http from 'http'
import Module from 'module'

// Tests for the mission-create path of the Config /add route
// (API/Backend/Config/routes/configs.js).
//
// The bug: add() creates the Config DB row first, then, under `makedir`,
// unconditionally mkdir's ./Missions/<name>. In lean mode there is no local
// Missions/ filesystem, so the mkdir throws ENOENT — the row is already
// committed while the endpoint reports "Failed to create new mission." The
// fix gates the directory creation on full mode (isLean() === false).
//
// The route resolves the deployment mode through
// API/Backend/Utils/deploymentMode.js, which reads the env once at load, so
// each test sets the env and re-requires the router under a fresh module
// cache (same pattern as deploymentMode.spec.js / uploadRouterS3.spec.js).
// The Sequelize Config model is mocked so no test touches a database, and
// fs.mkdirSync/existsSync are spied so no test touches disk.

const MODE_PATH = '../../API/Backend/Utils/deploymentMode.js'
const ROUTER_PATH = '../../API/Backend/Config/routes/configs.js'
const MODEL_PATH = '../../API/Backend/Config/models/config.js'

// Shared state the stub model reads/writes so each test can drive findOne's
// answer and inspect the rows create() received.
const state = { existing: null, created: [] }

// Stub the Sequelize Config model by seeding the module cache before the
// router requires it (the router captures Config at load, via a deep CJS
// require that a vi.mock does not intercept). This keeps every test off the
// database — findOne/create resolve in-memory.
const MODEL_ABS = require.resolve(MODEL_PATH)
function installModelStub() {
    const stub = new Module(MODEL_ABS)
    stub.filename = MODEL_ABS
    stub.loaded = true
    stub.exports = {
        findOne: async () => state.existing,
        create: async (row) => {
            state.created.push(row)
            return { mission: row.mission, version: row.version }
        },
    }
    require.cache[MODEL_ABS] = stub
}

function freshRouter(mode) {
    if (mode === undefined) delete process.env.MMGIS_DEPLOYMENT_MODE
    else process.env.MMGIS_DEPLOYMENT_MODE = mode
    installModelStub()
    delete require.cache[require.resolve(MODE_PATH)]
    delete require.cache[require.resolve(ROUTER_PATH)]
    return require(ROUTER_PATH)
}

async function startServer(router) {
    const app = express()
    app.use(express.json())
    // add() runs behind a SuperAdmin gate; grant it for the harness.
    app.use((req, _res, next) => {
        req.session = { permission: '111' }
        next()
    })
    app.use('/api/configure', router)
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

// mkdirSync is spied process-wide, so the logger's own log-dir creation shows
// up too; keep only the mission-directory calls this route is responsible for.
function missionsMkdirs(spy) {
    return spy.mock.calls
        .map((c) => c[0])
        .filter((p) => typeof p === 'string' && p.startsWith('./Missions/'))
}

function postAdd(base, body) {
    const payload = Buffer.from(JSON.stringify(body))
    return new Promise((resolve, reject) => {
        const req = http.request(
            `${base}/api/configure/add`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
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

test.describe('config /add mission-directory creation gating', () => {
    let savedMode
    let mkdirSpy
    let existsSpy

    beforeEach(() => {
        savedMode = process.env.MMGIS_DEPLOYMENT_MODE
        state.existing = null
        state.created = []
        // Never write to disk: existsSync returns false so full mode enters
        // the create-dirs branch, and mkdirSync is a recorded no-op.
        existsSpy = vi.spyOn(fs, 'existsSync').mockReturnValue(false)
        mkdirSpy = vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {})
    })

    afterEach(() => {
        if (savedMode === undefined) delete process.env.MMGIS_DEPLOYMENT_MODE
        else process.env.MMGIS_DEPLOYMENT_MODE = savedMode
        existsSpy.mockRestore()
        mkdirSpy.mockRestore()
        delete require.cache[require.resolve(MODE_PATH)]
        delete require.cache[require.resolve(ROUTER_PATH)]
        delete require.cache[MODEL_ABS]
    })

    test('lean: add succeeds, creates the DB row, and never mkdirs', async () => {
        const router = freshRouter('lean')
        const { server, base } = await startServer(router)
        try {
            const res = await postAdd(base, {
                mission: 'LeanAddSpec',
                makedir: true,
            })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('success')
            expect(res.body.mission).toBe('LeanAddSpec')
            // The DB-backed mission row is still created in lean mode...
            expect(state.created).toHaveLength(1)
            expect(state.created[0].mission).toBe('LeanAddSpec')
            // ...but no Missions/ directory is ever created.
            expect(missionsMkdirs(mkdirSpy)).toEqual([])
        } finally {
            await closeServer(server)
        }
    })

    test('full: add creates the DB row and mkdirs the Missions/ tree', async () => {
        const router = freshRouter('full')
        const { server, base } = await startServer(router)
        try {
            const res = await postAdd(base, {
                mission: 'FullAddSpec',
                makedir: true,
            })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('success')
            expect(state.created).toHaveLength(1)
            // Full mode makes ./Missions/<name> plus its Layers and Data dirs.
            expect(missionsMkdirs(mkdirSpy)).toEqual([
                './Missions/FullAddSpec',
                './Missions/FullAddSpec/Layers',
                './Missions/FullAddSpec/Data',
            ])
        } finally {
            await closeServer(server)
        }
    })

    test('full: makedir omitted leaves the filesystem untouched', async () => {
        const router = freshRouter('full')
        const { server, base } = await startServer(router)
        try {
            const res = await postAdd(base, { mission: 'FullNoDirSpec' })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('success')
            expect(state.created).toHaveLength(1)
            expect(missionsMkdirs(mkdirSpy)).toEqual([])
        } finally {
            await closeServer(server)
        }
    })
})
