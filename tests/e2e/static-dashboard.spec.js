import { test, expect } from '@playwright/test'
import fs from 'fs'
import http from 'http'
import path from 'path'
import staticIndex from '../../scripts/lib/static-index.js'

/**
 * Static dashboard smoke: stage the prebuilt build/ the way the publish task
 * does (scripts/publish-static.js, via scripts/lib/static-index.js), lay it
 * out like the dashboard bucket (index.html at the root, build/, public/,
 * Missions/<mission>/config.json), serve it from a plain static server, and
 * check that the page boots in its static personality: it loads the mission
 * config from Missions/<mission>/config.json and never calls /api/.
 *
 * Needs a production build first (`npm run build:themes && npm run build`);
 * skipped when build/index.html is absent. It starts its own server and
 * does not use the MMGIS backend.
 */

const { stageBuild, renderStaticIndex } = staticIndex

const ROOT = process.cwd()
const MISSION = 'StaticSmoke'

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.wasm': 'application/wasm',
}

let siteRoot
let server
let baseUrl

test.beforeAll(async () => {
    test.skip(
        !fs.existsSync(path.join(ROOT, 'build', 'index.html')),
        'needs a production build (npm run build)'
    )

    const stagedBuild = stageBuild(path.join(ROOT, 'build'))
    siteRoot = path.dirname(stagedBuild)
    const html = renderStaticIndex(
        fs.readFileSync(path.join(stagedBuild, 'index.html'), 'utf8'),
        {
            globals: {
                AUTH: 'off',
                NODE_ENV: 'production',
                MAIN_MISSION: MISSION,
                ENABLE_MMGIS_WEBSOCKETS: 'false',
                SKIP_CLIENT_INITIAL_LOGIN: 'true',
                ROOT_PATH: '',
                HOSTS: '{}',
            },
            config: {
                missions: { status: 'success', missions: [MISSION] },
                get_generaloptions: { status: 'success', options: {} },
            },
        }
    )
    fs.writeFileSync(path.join(siteRoot, 'index.html'), html)
    fs.cpSync(path.join(ROOT, 'public'), path.join(siteRoot, 'public'), {
        recursive: true,
    })
    const config = JSON.parse(
        fs.readFileSync(
            path.join(ROOT, 'API', 'templates', 'config_template.json'),
            'utf8'
        )
    )
    config.msv.mission = MISSION
    config.msv.missionFolderName = MISSION
    fs.mkdirSync(path.join(siteRoot, 'Missions', MISSION), { recursive: true })
    fs.writeFileSync(
        path.join(siteRoot, 'Missions', MISSION, 'config.json'),
        JSON.stringify(config)
    )

    server = http.createServer((req, res) => {
        const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname)
        let filePath = path.join(siteRoot, urlPath)
        if (!filePath.startsWith(siteRoot)) {
            res.writeHead(403)
            return res.end()
        }
        if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory())
            filePath = path.join(filePath, 'index.html')
        if (!fs.existsSync(filePath)) {
            res.writeHead(404)
            return res.end()
        }
        res.writeHead(200, {
            'Content-Type':
                CONTENT_TYPES[path.extname(filePath)] ||
                'application/octet-stream',
        })
        fs.createReadStream(filePath).pipe(res)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve))
    if (siteRoot) fs.rmSync(siteRoot, { recursive: true, force: true })
})

test('a staged prebuilt bundle boots static: config.json, no /api/', async ({
    page,
}) => {
    test.setTimeout(60 * 1000)
    const apiRequests = []
    page.on('request', (req) => {
        if (new URL(req.url()).pathname.includes('/api/'))
            apiRequests.push(req.url())
    })

    // The app appends a ?nocache= query, so match on the path.
    const configRequest = page.waitForRequest(
        (req) =>
            new URL(req.url()).pathname ===
            `/Missions/${MISSION}/config.json`
    )
    await page.goto(`${baseUrl}/`)
    await configRequest

    expect(
        await page.evaluate(() => window.mmgisglobal.SERVER)
    ).toBe('static')
    // Let the app finish its startup requests before judging them.
    await page.waitForLoadState('networkidle')
    expect(apiRequests).toEqual([])
})
