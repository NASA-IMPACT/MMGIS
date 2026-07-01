import { test, expect, request } from '@playwright/test'

/**
 * Deployment-mode present/absent checks. Boots once per mode in CI; per feature,
 * asserts its route is reachable in the mode it belongs to and gone otherwise.
 *
 * The on/off mapping below is hand-written from the deployment ADR. Do NOT
 * rewrite it to read expectations from a capability table — a test that takes its
 * answers from the code under test can't catch a wrong entry.
 *
 * Discriminator: a mounted route answers from its handler (never 404); an
 * unmounted route hits the catch-all `app.all('*')` -> 404.
 */

const MODE = process.env.MMGIS_DEPLOYMENT_MODE || 'full'

// Each feature: which mode it belongs to, and one HTTP probe against a route it
// owns. We only care whether that route is mounted (non-404) or absent (404).
const FEATURES = [
    // --- Full-only: present in full, absent in lean ---
    {
        name: 'geodata management (datasets)',
        mode: 'full',
        method: 'post',
        // ensureAdmin allow-lists /get, so it reaches the router without auth.
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
        // it (getbands/getprofile/...) are registered only when the
        // localMissions capability is enabled (full).
        path: '/api/utils/getbands',
    },
    {
        name: 'bundled sidecar services / proxy (titiler)',
        mode: 'full',
        method: 'get',
        // The /titiler proxy is mounted only when the localSidecars capability
        // is enabled (full) AND WITH_TITILER=true (the full CI leg keeps the
        // sample.env sidecar flags on). The lean leg turns the WITH_* flags off
        // and the proxy is also localSidecars-gated, so it is absent there.
        path: '/titiler/healthz',
    },

    // --- Lean-only: present in lean, absent in full ---
    {
        name: 'dashboard publish flow (deployments)',
        mode: 'lean',
        method: 'get',
        // Mounted only when the deployments capability is enabled (lean);
        // ensureAdmin rejects with a 200 JSON body (not 404) when present.
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

        test(`${feature.name} is ${belongsToRunningMode ? 'present' : 'absent'
            } in ${MODE}`, async () => {
                const status = await probe(api, feature)

                if (belongsToRunningMode) {
                    // Mounted: any status but the catch-all 404.
                    expect(
                        status,
                        `${feature.name} should be MOUNTED in ${MODE} (got ${status}); a 404 means the route is gone`
                    ).not.toBe(404)
                } else {
                    // Absent: falls through to the app catch-all 404.
                    expect(
                        status,
                        `${feature.name} should be ABSENT in ${MODE} (got ${status}); anything but 404 means the route is still mounted`
                    ).toBe(404)
                }
            })
    }
})
