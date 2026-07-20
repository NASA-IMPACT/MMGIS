import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// The Configure SPA mirrors the backend deployment STATUS constants
// (separate build trees, so the values are duplicated and pinned here,
// same trick as the staticHandlers parity spec).

const root = path.join(__dirname, '..', '..')

function extractStatusValues(source) {
    const block = source.match(/STATUS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
    expect(block).not.toBeNull()
    return [...block[1].matchAll(/[A-Z_]+:\s*"([a-z_]+)"/g)]
        .map((m) => m[1])
        .sort()
}

test('Configure deploymentStatus mirrors the backend model STATUS', () => {
    const backend = extractStatusValues(
        fs.readFileSync(
            path.join(root, 'API/Backend/Deployments/models/deployment.js'),
            'utf8'
        )
    )
    const configure = extractStatusValues(
        fs.readFileSync(
            path.join(root, 'configure/src/core/deploymentStatus.js'),
            'utf8'
        )
    )
    expect(backend.length).toBeGreaterThan(0)
    expect(configure).toEqual(backend)
})
