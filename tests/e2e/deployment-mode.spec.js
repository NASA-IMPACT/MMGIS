import { test, expect, request } from '@playwright/test'

/**
 * Deployment-mode present/absent checks (acceptance #2 of the both-modes CI
 * coverage issue).
 *
 * The same codebase ships in two shapes selected by MMGIS_DEPLOYMENT_MODE:
 *   - full: the complete application as shipped today.
 *   - lean: a gated-down deployment that turns a set of server features OFF.
 *
 * The CI matrix boots the app once per shape and passes the mode in via
 * MMGIS_DEPLOYMENT_MODE; this test reads that and, per feature, asserts the
 * feature is reachable when it belongs to the running mode and gone otherwise.
 *
 * HAND-WRITTEN feature inventory — IMPORTANT: the expected on/off mapping below
 * is written by a person from the deployment ADR feature inventory, NOT read
 * from any capability table or from the gated code. That independence is the
 * whole point: a test that takes its expected answers from the thing it is
 * testing cannot catch a wrong entry. The route PATHS were looked up in the
 * code, but which mode each belongs to is hand-asserted here. Do NOT later
 * rewrite this to read its expectations from a capability table.
 *
 * How a route reports present vs. absent (verified against the code):
 *   - A MOUNTED route answers from its own handler. With AUTH=off these handlers
 *     return HTTP 200 with a JSON failure body (auth/guard rejection) or real
 *     data, and the sidecar proxy answers with a proxy/upstream error — in every
 *     case the status is NOT 404.
 *   - An UNMOUNTED route falls through to the app's catch-all
 *     (`app.all('*')` -> res.status(404).render('error')), i.e. a real HTTP 404.
 * So the reliable discriminator is: mounted => status !== 404; absent => 404.
 */

const MODE = process.env.MMGIS_DEPLOYMENT_MODE || 'full'

// Each feature: where it belongs, and a single HTTP probe that exercises a route
// the feature owns. `method`/`path` only — no body needed, because we only care
// whether the route is mounted (any non-404) or absent (404).
const FEATURES = [
    // --- Full-only: present in full, absent in lean ---
    {
        name: 'geodata management (datasets)',
        mode: 'full',
        method: 'post',
        // ensureAdmin allow-lists /api/datasets/get, so in full it reaches the
        // mounted router even without admin auth.
        path: '/api/datasets/get',
    },
    {
        name: 'geodata management (geodatasets)',
        mode: 'full',
        method: 'get',
        // ensureAdmin allow-lists /api/geodatasets/get.
        path: '/api/geodatasets/get',
    },
    {
        name: 'drawing (draw API)',
        mode: 'full',
        method: 'post',
        path: '/api/draw/add',
    },
    {
        name: 'on-disk mission filesystem (files API)',
        mode: 'full',
        method: 'post',
        path: '/api/files/getfiles',
    },
    {
        name: 'link shortener',
        mode: 'full',
        method: 'post',
        path: '/api/shortener/shorten',
    },
    {
        name: 'server-side raster utilities',
        mode: 'full',
        method: 'post',
        // /api/utils is mounted in both modes, but the raster endpoints inside
        // it (getbands/getprofile/...) are registered only when isFull().
        path: '/api/utils/getbands',
    },
    {
        name: 'bundled sidecar services / proxy (titiler)',
        mode: 'full',
        method: 'get',
        // The /titiler proxy is mounted only when isFull() AND WITH_TITILER=true
        // (the full CI leg keeps the sample.env sidecar flags on). The lean leg
        // turns the WITH_* flags off and the proxy is also isFull()-gated, so it
        // is absent there.
        path: '/titiler/healthz',
    },

    // --- Lean-only: present in lean, absent in full ---
    {
        name: 'dashboard publish flow (deployments)',
        mode: 'lean',
        method: 'get',
        // Mounted only when isLean(); ensureAdmin rejects with a 200 JSON body
        // (not 404) when present.
        path: '/api/deployments',
    },
]

async function probe(api, feature) {
    const res =
        feature.method === 'post'
            ? await api.post(feature.path, { data: {} })
            : await api.get(feature.path)
    return res.status()
}

test.describe(`Deployment mode present/absent — MODE=${MODE}`, () => {
    let api

    test.beforeAll(async () => {
        api = await request.newContext({
            baseURL: process.env.TEST_BASE_URL || 'http://localhost:8888',
            ignoreHTTPSErrors: true,
        })
    })

    test.afterAll(async () => {
        await api.dispose()
    })

    for (const feature of FEATURES) {
        const belongsToRunningMode = feature.mode === MODE

        test(`${feature.name} is ${
            belongsToRunningMode ? 'present' : 'absent'
        } in ${MODE}`, async () => {
            const status = await probe(api, feature)

            if (belongsToRunningMode) {
                // Reachable: the route is mounted, so it must NOT hit the
                // catch-all 404. (It may legitimately answer 200 with a guard
                // failure, real data, or a proxy/upstream error status.)
                expect(
                    status,
                    `${feature.name} should be MOUNTED in ${MODE} (got ${status}); a 404 means the route is gone`
                ).not.toBe(404)
            } else {
                // Gone: the route is unmounted and falls through to the
                // app catch-all, which returns a real 404.
                expect(
                    status,
                    `${feature.name} should be ABSENT in ${MODE} (got ${status}); anything but 404 means the route is still mounted`
                ).toBe(404)
            }
        })
    }
})
