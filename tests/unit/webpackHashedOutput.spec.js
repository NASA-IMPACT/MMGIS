import { afterAll, test, expect } from 'vitest'
import path from 'path'

// Pins the premise of the immutable Cache-Control tier in
// scripts/lib/aws-provision.js: every production filename webpack writes under
// build/static/(js|css|media) carries a content hash. Drop the hash from one of
// these options, or send a verbatim copy to one of those prefixes, and a stable
// filename lands in the immutable tier, where customers' CloudFront edges would
// pin it for a year.
//
// configuration/env.js throws without NODE_ENV, so the variable is set here
// and put back afterwards. Building the config also patches
// crypto.createHash process-wide, which anything else in the same worker would
// then inherit, so the require stays inside this one spec file.
const NODE_ENV_BEFORE = process.env.NODE_ENV
process.env.NODE_ENV = 'production'
const CONFIG = require('../../configuration/webpack.config.js')('production')

afterAll(() => {
    if (NODE_ENV_BEFORE === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = NODE_ENV_BEFORE
})

const HASH_TOKEN = /\[contenthash|\[hash/

// Every loader `options.name` that emits into static/media, however the rules
// are nested — the production asset loaders sit inside a `oneOf`.
function mediaNames(rules, found = []) {
    const list = rules || []
    list.forEach((rule) => {
        if (!rule) return
        mediaNames(rule.oneOf, found)
        mediaNames(rule.rules, found)
        const name = rule.options && rule.options.name
        if (typeof name === 'string' && name.startsWith('static/media/'))
            found.push(name)
    })
    return found
}

function pluginsNamed(name) {
    return CONFIG.plugins.filter(
        (p) => p && p.constructor && p.constructor.name === name
    )
}

function pluginNamed(name) {
    const plugin = pluginsNamed(name)[0]
    expect(plugin, `no ${name} in the production config`).toBeDefined()
    return plugin
}

test.describe('webpack production output is content-hashed', () => {
    test('output.filename and output.chunkFilename carry a hash', () => {
        expect(CONFIG.output.filename).toMatch(HASH_TOKEN)
        expect(CONFIG.output.chunkFilename).toMatch(HASH_TOKEN)
    })

    test("MiniCssExtractPlugin's filenames carry a hash", () => {
        const options = pluginNamed('MiniCssExtractPlugin').options
        expect(options.filename).toMatch(HASH_TOKEN)
        expect(options.chunkFilename).toMatch(HASH_TOKEN)
    })

    test('the media loaders name files with a hash', () => {
        // The url-loader (small images, inlined below a size limit) and the
        // catch-all file-loader both emit into static/media.
        const names = mediaNames(CONFIG.module.rules)
        expect(names.length).toBeGreaterThanOrEqual(2)
        names.forEach((name) => expect(name).toMatch(HASH_TOKEN))
    })

    test('no copied file lands under a hashed prefix', () => {
        // CopyPlugin passes files through under their own names, so a
        // destination under static/js, static/css or static/media would drop a
        // stable name into the immutable tier. Cesium's copies go to
        // static/cesium, which is on the five-minute tier. Destinations are
        // built with path.join, so they carry the platform's separator.
        const copiers = pluginsNamed('CopyPlugin')
        expect(
            copiers.length,
            'no CopyPlugin in the production config'
        ).toBeGreaterThan(0)
        copiers.forEach((copier) => {
            copier.patterns.forEach((pattern) => {
                const to = String(pattern.to).split(path.sep).join('/')
                expect(to).not.toMatch(/^static\/(js|css|media)(\/|$)/)
            })
        })
    })
})
