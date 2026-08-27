import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Pins the premise of the immutable Cache-Control tier in
// scripts/lib/aws-provision.js: every production filename webpack writes under
// build/static/(js|css|media) carries a content hash. Drop the hash from one of
// these options (or rename it) and a stable filename lands in the immutable
// tier, where customers' CloudFront edges would pin it for a year.
const CONFIG = fs.readFileSync(
    path.join(__dirname, '..', '..', 'configuration', 'webpack.config.js'),
    'utf8'
)

const HASH_TOKEN = /\[contenthash|\[hash/

// The literal `re` captures, failing the test when it matches nothing — a
// renamed or restructured option must break the suite, not skip its assertion.
function capture(label, re, text = CONFIG) {
    const match = text.match(re)
    expect(match, `no match for ${label}`).not.toBeNull()
    return match[1]
}

test.describe('webpack production output is content-hashed', () => {
    test('output.filename and output.chunkFilename carry a hash', () => {
        // Leading [^A-Za-z] so `filename:` does not match `chunkFilename:`.
        expect(
            capture(
                'output.filename',
                /[^A-Za-z]filename:\s*isEnvProduction\s*\?\s*"([^"]+)"/
            )
        ).toMatch(HASH_TOKEN)
        expect(
            capture(
                'output.chunkFilename',
                /chunkFilename:\s*isEnvProduction\s*\?\s*"([^"]+)"/
            )
        ).toMatch(HASH_TOKEN)
    })

    test("MiniCssExtractPlugin's filenames carry a hash", () => {
        const options = capture(
            'MiniCssExtractPlugin options',
            /new MiniCssExtractPlugin\(\{([\s\S]*?)\}\)/
        )
        expect(
            capture('css filename', /[^A-Za-z]filename:\s*"([^"]+)"/, options)
        ).toMatch(HASH_TOKEN)
        expect(
            capture('css chunkFilename', /chunkFilename:\s*"([^"]+)"/, options)
        ).toMatch(HASH_TOKEN)
    })

    test('the media loaders name files with a hash', () => {
        // The url-loader (small images, inlined above a size limit) and the
        // catch-all file-loader both emit into static/media.
        const names = [
            ...CONFIG.matchAll(/name:\s*"(static\/media\/[^"]+)"/g),
        ].map((m) => m[1])
        expect(names.length).toBeGreaterThanOrEqual(2)
        names.forEach((name) => expect(name).toMatch(HASH_TOKEN))
    })
})
