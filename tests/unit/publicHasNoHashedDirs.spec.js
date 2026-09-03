import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

const { cacheControlForKey } = require('../../scripts/lib/aws-provision')

// scripts/build.js copyPublicFolder copies public/ into build/ verbatim, under
// the names the files already have. Nothing in there is content-hashed, so a
// static/(js|css|media) subtree in public/ would put a stable name into the
// immutable Cache-Control tier of scripts/lib/aws-provision.js, where a
// customer's CloudFront edge pins it for a year and a republish can never
// dislodge it.

const PUBLIC = path.join(__dirname, '..', '..', 'public')

function keysUnder(dir, baseDir = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) return keysUnder(full, baseDir)
        if (!entry.isFile()) return []
        return [path.relative(baseDir, full).split(path.sep).join('/')]
    })
}

test('no file copied out of public/ lands in the immutable tier', () => {
    const keys = keysUnder(PUBLIC)
    expect(keys.length).toBeGreaterThan(0)
    const immutable = keys.filter((key) =>
        cacheControlForKey(`build/${key}`).includes('immutable'),
    )
    expect(immutable).toEqual([])
})
