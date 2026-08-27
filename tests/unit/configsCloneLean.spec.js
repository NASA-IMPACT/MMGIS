import { test, expect, vi, beforeEach, afterEach } from 'vitest'
import express from 'express'
import child_process from 'child_process'
import Module from 'module'

// Tests for the /clone route of the Config router
// (API/Backend/Config/routes/configs.js).
//
// Full mode clones by running private/api/create_mission.py over the local
// Missions/ filesystem and then copying the config row. Lean mode has no
// local filesystem: the route instead rewrites the config's root-relative
// /assets/<oldFolderName>/… upload URLs to the clone's name and copies the
// stored objects between prefixes of the shared asset bucket
// (scripts/lib/aws-provision.js copyPrefix).
//
// Same harness pattern as configsAddLean.spec.js: the deployment mode is
// read from env at module load, so each test pins the env and re-requires
// the router under a fresh module cache; the Sequelize Config model and the
// aws-provision helper are stubbed via the module cache (deep CJS requires
// that vi.mock does not intercept); child_process.execFile is spied before
// the router loads (the router captures the function reference at load).

const MODE_PATH = '../../API/Backend/Utils/deploymentMode.js'
const ROUTER_PATH = '../../API/Backend/Config/routes/configs.js'
const MODEL_PATH = '../../API/Backend/Config/models/config.js'
const PROVISION_PATH = '../../scripts/lib/aws-provision.js'

// Env the router reads at load or per request. Saved/restored around every
// test (same pattern as configsAddLean.spec.js).
const ENV_KEYS = [
    'MMGIS_DEPLOYMENT_MODE',
    'HIDE_CONFIG',
    'MMGIS_SHARED_ASSET_BUCKET',
]

const EXISTING = 'OldMission'
const CLONE = 'NewMission'

// Shared state the stubs read/write so each test can seed the existing
// mission, inspect created/destroyed rows, and drive/inspect the S3 copy.
const state = {
    rows: {},
    created: [],
    destroyed: [],
    copyCalls: [],
    copyError: null,
}

// A config whose upload references use the lean-mode root-relative
// /assets/<missionFolderName>/… form (plus one absolute URL that must
// never be touched).
function seedExistingMission() {
    state.rows = {
        [EXISTING]: {
            mission: EXISTING,
            version: 0,
            config: {
                msv: { mission: EXISTING, missionFolderName: EXISTING },
                look: {
                    logourl: `/assets/${EXISTING}/look/uploads/logo.png`,
                },
                layers: [
                    {
                        name: 'Cards',
                        type: 'vector',
                        url: `/assets/${EXISTING}/CardTool/uploads/a.geojson`,
                        legend: `/assets/${EXISTING}/CardTool/uploads/legend.png`,
                    },
                    {
                        name: 'Remote',
                        type: 'tile',
                        url: 'https://example.com/tiles/{z}/{x}/{y}.png',
                    },
                ],
            },
        },
    }
}

// Stub the Sequelize Config model by seeding the module cache before the
// router requires it. get() uses findAll/findOne, add() uses findOne/create,
// and the lean clone's rollback uses destroy — all resolved in-memory.
const MODEL_ABS = require.resolve(MODEL_PATH)
function installModelStub() {
    const stub = new Module(MODEL_ABS)
    stub.filename = MODEL_ABS
    stub.loaded = true
    stub.exports = {
        findAll: async ({ where }) =>
            state.rows[where.mission] ? [state.rows[where.mission]] : [],
        findOne: async ({ where }) => state.rows[where.mission] || null,
        create: async (row) => {
            state.created.push(row)
            // Sequelize hands back the persisted row, id included — the lean
            // clone's rollback deletes by that id.
            return {
                id: 100 + state.created.length,
                mission: row.mission,
                version: row.version,
            }
        },
        destroy: async ({ where }) => {
            state.destroyed.push(where.id)
            return 1
        },
    }
    require.cache[MODEL_ABS] = stub
}

// Stub scripts/lib/aws-provision.js (required lazily by the lean clone
// path) so no test touches the AWS SDK. Records copyPrefix's arguments and
// optionally rejects.
const PROVISION_ABS = require.resolve(PROVISION_PATH)
function installProvisionStub() {
    const stub = new Module(PROVISION_ABS)
    stub.filename = PROVISION_ABS
    stub.loaded = true
    stub.exports = {
        copyPrefix: async (args) => {
            state.copyCalls.push(args)
            if (state.copyError) throw state.copyError
            return 2
        },
    }
    require.cache[PROVISION_ABS] = stub
}

function freshRouter(mode) {
    if (mode === undefined) delete process.env.MMGIS_DEPLOYMENT_MODE
    else process.env.MMGIS_DEPLOYMENT_MODE = mode
    // configs.js only mounts /clone when HIDE_CONFIG != 'true'. Pin it to a
    // non-'true' value (not just delete it: the router re-runs dotenv on
    // load, and dotenv only fills in vars that are unset, so a real .env
    // with HIDE_CONFIG=true would otherwise hide the route from every test).
    process.env.HIDE_CONFIG = 'false'
    installModelStub()
    installProvisionStub()
    delete require.cache[require.resolve(MODE_PATH)]
    delete require.cache[require.resolve(ROUTER_PATH)]
    return require(ROUTER_PATH)
}

async function startServer(router) {
    const app = express()
    app.use(express.json())
    // clone() runs behind a SuperAdmin gate; grant it for the harness.
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

async function postClone(base, body) {
    const res = await fetch(`${base}/api/configure/clone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    const text = await res.text()
    try {
        return { status: res.status, body: JSON.parse(text) }
    } catch (err) {
        throw new Error(`Non-JSON response (status ${res.status}): ${text}`)
    }
}

test.describe('config /clone deployment-mode behavior', () => {
    const savedEnv = {}
    let execSpy

    beforeEach(() => {
        ENV_KEYS.forEach((key) => {
            savedEnv[key] = process.env[key]
        })
        process.env.MMGIS_SHARED_ASSET_BUCKET = 'test-shared-bucket'
        seedExistingMission()
        state.created = []
        state.destroyed = []
        state.copyCalls = []
        state.copyError = null
        // Never spawn python: execFile is a recorded stub reporting success.
        // Installed before freshRouter() because the router captures the
        // function reference at load.
        execSpy = vi
            .spyOn(child_process, 'execFile')
            .mockImplementation((cmd, args, cb) =>
                cb(null, JSON.stringify({ status: 'success' }), '')
            )
    })

    afterEach(() => {
        ENV_KEYS.forEach((key) => {
            if (savedEnv[key] === undefined) delete process.env[key]
            else process.env[key] = savedEnv[key]
        })
        execSpy.mockRestore()
        delete require.cache[require.resolve(MODE_PATH)]
        delete require.cache[require.resolve(ROUTER_PATH)]
        delete require.cache[MODEL_ABS]
        delete require.cache[PROVISION_ABS]
    })

    test('lean: clone creates the row with rewritten asset URLs, copies the asset prefix, and never runs the script', async () => {
        const router = freshRouter('lean')
        const { server, base } = await startServer(router)
        try {
            const res = await postClone(base, {
                existingMission: EXISTING,
                cloneMission: CLONE,
                hasPaths: false,
            })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('success')
            expect(res.body.mission).toBe(CLONE)

            // The python filesystem script is never invoked in lean mode.
            expect(execSpy).not.toHaveBeenCalled()

            // The clone's row is created with every /assets/<old>/ URL
            // rewritten to /assets/<new>/ — and absolute URLs untouched.
            expect(state.created).toHaveLength(1)
            const config = state.created[0].config
            expect(state.created[0].mission).toBe(CLONE)
            expect(config.msv.mission).toBe(CLONE)
            expect(config.msv.missionFolderName).toBe(CLONE)
            expect(config.look.logourl).toBe(
                `/assets/${CLONE}/look/uploads/logo.png`
            )
            expect(config.layers[0].url).toBe(
                `/assets/${CLONE}/CardTool/uploads/a.geojson`
            )
            expect(config.layers[0].legend).toBe(
                `/assets/${CLONE}/CardTool/uploads/legend.png`
            )
            expect(config.layers[1].url).toBe(
                'https://example.com/tiles/{z}/{x}/{y}.png'
            )
            expect(JSON.stringify(config)).not.toContain(
                `/assets/${EXISTING}/`
            )

            // The stored assets are copied between prefixes of the shared
            // bucket.
            expect(state.copyCalls).toEqual([
                {
                    sourceBucket: 'test-shared-bucket',
                    destBucket: 'test-shared-bucket',
                    prefix: `assets/${EXISTING}/`,
                    destPrefix: `assets/${CLONE}/`,
                },
            ])
        } finally {
            await closeServer(server)
        }
    })

    test('lean: no shared asset bucket configured — clone succeeds without copying', async () => {
        delete process.env.MMGIS_SHARED_ASSET_BUCKET
        const router = freshRouter('lean')
        const { server, base } = await startServer(router)
        try {
            const res = await postClone(base, {
                existingMission: EXISTING,
                cloneMission: CLONE,
                hasPaths: false,
            })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('success')
            expect(state.created).toHaveLength(1)
            expect(state.copyCalls).toEqual([])
        } finally {
            await closeServer(server)
        }
    })

    test('lean: asset copy failure rolls the clone back and reports failure', async () => {
        state.copyError = new Error('AccessDenied')
        const router = freshRouter('lean')
        const { server, base } = await startServer(router)
        try {
            const res = await postClone(base, {
                existingMission: EXISTING,
                cloneMission: CLONE,
                hasPaths: false,
            })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('failure')
            expect(res.body.message).toBe(
                'Failed to copy the mission\'s assets. The clone was rolled back.'
            )
            // The row was created, then destroyed by the rollback — by the
            // created row's id, not name-wide.
            expect(state.created).toHaveLength(1)
            expect(state.destroyed).toEqual([101])
        } finally {
            await closeServer(server)
        }
    })

    test('full: clone still runs the filesystem script and leaves asset URLs alone', async () => {
        const router = freshRouter('full')
        const { server, base } = await startServer(router)
        try {
            const res = await postClone(base, {
                existingMission: EXISTING,
                cloneMission: CLONE,
                hasPaths: false,
            })
            expect(res.status).toBe(200)
            expect(res.body.status).toBe('success')

            // Full mode goes through private/api/create_mission.py.
            expect(execSpy).toHaveBeenCalledTimes(1)
            expect(execSpy.mock.calls[0][0]).toBe('python')
            expect(execSpy.mock.calls[0][1]).toEqual([
                'private/api/create_mission.py',
                encodeURIComponent(CLONE),
            ])

            // The row is created with the mission renamed but URLs untouched,
            // and no S3 prefix copy happens.
            expect(state.created).toHaveLength(1)
            const config = state.created[0].config
            expect(config.msv.mission).toBe(CLONE)
            expect(config.look.logourl).toBe(
                `/assets/${EXISTING}/look/uploads/logo.png`
            )
            expect(state.copyCalls).toEqual([])
        } finally {
            await closeServer(server)
        }
    })
})
