import { describe, test, expect, beforeAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createRequire } from 'module'
import { JSDOM } from 'jsdom'
import staticIndex from '../../scripts/lib/static-index.js'

const {
    stageBuild,
    countStaticConfigAnchors,
    serializeStaticConfig,
    injectStaticConfig,
    readStaticConfig,
    interpolateStaticGlobals,
    renderStaticIndex,
} = staticIndex

const require = createRequire(import.meta.url)

// The publish task rewrites the MINIFIED build/index.html, so the fixture is
// public/index.html run through the same steps the image build applies:
// InterpolateHtmlPlugin's %KEY% substitution (SERVER unset -> "node"), then
// html-webpack-plugin's production minify options, loaded from the module
// webpack.config.js uses (configuration/html-minify-options.js).
const MINIFY_OPTIONS = require('../../configuration/html-minify-options.js')
// The minifier html-webpack-plugin itself resolves, so the fixture uses the
// exact version the build uses and needs no devDependency of its own.
const { minify } = require(
    require.resolve('html-minifier-terser', {
        paths: [
            path.dirname(require.resolve('html-webpack-plugin/package.json')),
        ],
    })
)

const ENV_RAW = {
    NODE_ENV: 'production',
    SERVER: 'node',
    HOSTS: '{"scienceIntent":""}',
}

let builtIndex
beforeAll(async () => {
    const template = fs.readFileSync(
        path.resolve(process.cwd(), 'public/index.html'),
        'utf8'
    )
    const interpolated = template.replace(
        /%([A-Z_]+)%/g,
        (m, key) => ENV_RAW[key] ?? ''
    )
    builtIndex = await minify(interpolated, MINIFY_OPTIONS)
})

// Runs the page's inline scripts the way a browser would and returns the
// resulting mmgisglobal.
const evaluate = (html) => {
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    const mmgisglobal = dom.window.mmgisglobal
    dom.window.close()
    return mmgisglobal
}

const STATIC_CONFIG = {
    missions: { status: 'success', missions: ['Jezero'] },
    get_generaloptions: { status: 'success', options: { a: 1 } },
}

describe('minified index.html fixture', () => {
    test('keeps exactly one static-config block, still empty', () => {
        expect(countStaticConfigAnchors(builtIndex)).toBe(1)
        expect(builtIndex).toContain(
            '<script id="mmgis-static-config" type="application/json">{}</script>'
        )
    })

    test('an unpublished build keeps the node personality', () => {
        const g = evaluate(builtIndex)
        expect(g.SERVER).toBe('node')
        expect(g.STATIC_CONFIG).toEqual({})
    })
})

describe('injectStaticConfig', () => {
    test('writes JSON that parses back, with SERVER "static"', () => {
        const html = injectStaticConfig(builtIndex, STATIC_CONFIG)
        expect(countStaticConfigAnchors(html)).toBe(1)
        expect(readStaticConfig(html)).toEqual({
            ...STATIC_CONFIG,
            SERVER: 'static',
        })
    })

    test('the page boots static and exposes the config', () => {
        const g = evaluate(injectStaticConfig(builtIndex, STATIC_CONFIG))
        expect(g.SERVER).toBe('static')
        expect(g.STATIC_CONFIG.missions).toEqual(STATIC_CONFIG.missions)
        expect(g.STATIC_CONFIG.get_generaloptions).toEqual(
            STATIC_CONFIG.get_generaloptions
        )
    })

    test('SERVER is always "static", whatever the caller passes', () => {
        const html = injectStaticConfig(builtIndex, { SERVER: 'node' })
        expect(readStaticConfig(html).SERVER).toBe('static')
    })

    test('fails with no anchor', () => {
        const html = builtIndex.replace(
            /<script id="mmgis-static-config"[^>]*>[^<]*<\/script>/,
            ''
        )
        expect(countStaticConfigAnchors(html)).toBe(0)
        expect(() => injectStaticConfig(html, STATIC_CONFIG)).toThrow(
            /exactly one .* found 0/
        )
    })

    test('fails with two anchors', () => {
        const block =
            '<script id="mmgis-static-config" type="application/json">{}</script>'
        const html = builtIndex.replace(block, block + block)
        expect(countStaticConfigAnchors(html)).toBe(2)
        expect(() => injectStaticConfig(html, STATIC_CONFIG)).toThrow(
            /exactly one .* found 2/
        )
    })

    test('escapes "<" so a value cannot close the script element', () => {
        const hostile = '</script><script>window.pwned=1</script><!--'
        const config = {
            get_generaloptions: { status: 'success', options: { s: hostile } },
        }
        expect(serializeStaticConfig(config)).not.toContain('<')
        const html = injectStaticConfig(builtIndex, config)
        expect(html).not.toContain('</script><script>window.pwned')
        expect(readStaticConfig(html).get_generaloptions.options.s).toBe(
            hostile
        )
        const g = evaluate(html)
        expect(g.SERVER).toBe('static')
        expect(g.STATIC_CONFIG.get_generaloptions.options.s).toBe(hostile)
    })
})

describe('renderStaticIndex', () => {
    test('fills the Pug placeholders, escaped per context', () => {
        const html = renderStaticIndex(builtIndex, {
            globals: {
                NODE_ENV: 'production',
                MAIN_MISSION: 'Jezero "Delta"</script>',
                LINK_PREVIEW_TITLE: 'A & <B>',
            },
            config: STATIC_CONFIG,
        })
        expect(html).not.toMatch(/#\{[A-Za-z_]+\}/)
        expect(html).toContain('<title>A &amp; &lt;B&gt;</title>')
        const g = evaluate(html)
        expect(g.MAIN_MISSION).toBe('Jezero "Delta"</script>')
        expect(g.SERVER).toBe('static')
    })

    test('does not interpolate placeholders inside baked values', () => {
        const html = renderStaticIndex(builtIndex, {
            globals: { MAIN_MISSION: 'm' },
            config: {
                get_generaloptions: { options: { t: '#{MAIN_MISSION}' } },
            },
        })
        expect(readStaticConfig(html).get_generaloptions.options.t).toBe(
            '#{MAIN_MISSION}'
        )
    })

    test('interpolateStaticGlobals blanks unknown placeholders', () => {
        expect(interpolateStaticGlobals('"#{NOPE}"', {})).toBe('""')
    })
})

describe('stageBuild', () => {
    test('copies the bundle and leaves the source untouched', () => {
        const src = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgis-src-'))
        fs.mkdirSync(path.join(src, 'static'))
        fs.writeFileSync(path.join(src, 'index.html'), builtIndex)
        fs.writeFileSync(path.join(src, 'static', 'a.js'), 'x')
        const staged = stageBuild(src)
        try {
            expect(staged).not.toBe(src)
            expect(fs.readFileSync(path.join(staged, 'static', 'a.js'), 'utf8')).toBe('x')
            fs.writeFileSync(
                path.join(staged, 'index.html'),
                injectStaticConfig(builtIndex, STATIC_CONFIG)
            )
            expect(fs.readFileSync(path.join(src, 'index.html'), 'utf8')).toBe(
                builtIndex
            )
        } finally {
            fs.rmSync(path.dirname(staged), { recursive: true, force: true })
            fs.rmSync(src, { recursive: true, force: true })
        }
    })

    test('fails without a built index.html', () => {
        const src = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgis-src-'))
        try {
            expect(() => stageBuild(src)).toThrow(/No prebuilt bundle/)
        } finally {
            fs.rmSync(src, { recursive: true, force: true })
        }
    })
})
