import { afterAll, test, expect } from 'vitest'
import crypto from 'crypto'
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
// then inherit, so the original is captured here and restored too.
const NODE_ENV_BEFORE = process.env.NODE_ENV
const CREATE_HASH_BEFORE = crypto.createHash
process.env.NODE_ENV = 'production'
const CONFIG = require('../../configuration/webpack.config.js')('production')

afterAll(() => {
    if (NODE_ENV_BEFORE === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = NODE_ENV_BEFORE
    crypto.createHash = CREATE_HASH_BEFORE
})

const HASH_TOKEN = /\[contenthash|\[hash/

// Every emitted-file name pattern in the rules, however they are nested — the
// production asset loaders sit inside a `oneOf`. Loaders name their output
// with `options.name`, whether the loader sits on the rule itself or in its
// `use` chain; webpack 5 asset modules use `generator.filename`.
function emittedNames(rules, found = []) {
    const list = rules || []
    list.forEach((rule) => {
        if (!rule) return
        emittedNames(rule.oneOf, found)
        emittedNames(rule.rules, found)
        // `use` holds either one loader or a chain of them.
        const uses = [].concat(rule.use || [])
        uses.forEach((entry) => {
            const used = entry && entry.options && entry.options.name
            if (typeof used === 'string') found.push(used)
        })
        const name = rule.options && rule.options.name
        if (typeof name === 'string') found.push(name)
        const generated = rule.generator && rule.generator.filename
        if (typeof generated === 'string') found.push(generated)
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
    test('the compiler hashes the filenames it picks itself', () => {
        expect(CONFIG.output.filename).toMatch(HASH_TOKEN)
        expect(CONFIG.output.filename).toMatch(/^static\/js\//)
        expect(CONFIG.output.chunkFilename).toMatch(HASH_TOKEN)
        expect(CONFIG.output.chunkFilename).toMatch(/^static\/js\//)
    })

    test("MiniCssExtractPlugin's filenames land hashed under static/css", () => {
        const options = pluginNamed('MiniCssExtractPlugin').options
        expect(options.filename).toMatch(HASH_TOKEN)
        expect(options.filename).toMatch(/^static\/css\//)
        expect(options.chunkFilename).toMatch(HASH_TOKEN)
        expect(options.chunkFilename).toMatch(/^static\/css\//)
    })

    test('every rule names its emitted files with a content hash', () => {
        // Every rule has to hash, wherever it emits: a hashless name lands in
        // the immutable tier if it goes to one of those three prefixes, and
        // collides with the previous release's file if it does not. The
        // url-loader (small images, inlined below a size limit) and the
        // catch-all file-loader are the rules that reach an immutable prefix,
        // and static/media is the only one they may use — js and css belong to
        // the compiler's own output.
        const names = emittedNames(CONFIG.module.rules)
        expect(names.length).toBeGreaterThan(0)
        names.forEach((name) => {
            expect(name).toMatch(HASH_TOKEN)
            if (/^static\/(js|css|media)\//.test(name))
                expect(name).toMatch(/^static\/media\//)
        })
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
