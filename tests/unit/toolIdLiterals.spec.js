import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildToolIds } from '../../API/updateTools'

// Issue #350: a tool that names another plugin — or itself — writes the id as a
// string literal. Nothing in the build ties those literals to the manifests, so
// a re-key leaves them pointing at an id that no longer exists and the feature
// goes quiet (no throw, no warning). This walks the tool sources, pulls out
// every literal that is used as a plugin id, and checks it against the ids
// buildToolIds derives from the checked-in manifests. cwd is the repo root
// under vitest.

const TOOLS_DIR = 'src/essence/Tools'
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx'])

// Each pattern's first capture group is the id.
const ID_PATTERNS = [
    // Bus names a plugin owns: 'plugin:<id>:<event>'.
    { label: 'bus name', regex: /['"]plugin:([^'":]+):/g },
    // The constant a plugin keeps its own id in.
    {
        label: 'id constant',
        regex: /\b(?:[A-Z0-9_]+_)?(?:TOOL|PLUGIN)_ID\b\s*=\s*['"]([^'"]+)['"]/g,
    },
    // Lifecycle commands addressed to a plugin by id.
    {
        label: 'lifecycle call',
        regex: /\bmmgis(?:Show|Hide|Unload)Plugin\(\s*['"]([^'"]+)['"]/g,
    },
    {
        label: 'lifecycle call',
        regex: /\bmmgisSetPluginState\(\s*['"]([^'"]+)['"]/g,
    },
]

function sourceFiles(dir) {
    const found = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === '__tests__' || entry.name === 'node_modules') continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) found.push(...sourceFiles(full))
        else if (SOURCE_EXTENSIONS.has(path.extname(entry.name)))
            found.push(full)
    }
    return found
}

// `<pluginId>` in a message template and `${id}` in an interpolation stand for
// an id rather than naming one, so neither is checked against the manifests.
const isPlaceholder = (id) => /[<>${}\s]/.test(id)

function literalsIn(file) {
    const text = fs.readFileSync(file, 'utf8')
    const found = []
    for (const { label, regex } of ID_PATTERNS) {
        for (const match of text.matchAll(regex)) {
            if (isPlaceholder(match[1])) continue
            found.push({ file, label, id: match[1] })
        }
    }
    return found
}

describe('plugin id literals in tool source', () => {
    const manifests = {}
    for (const dir of fs.readdirSync(TOOLS_DIR)) {
        if (dir[0] === '_' || dir[0] === '.') continue
        const configPath = path.join(TOOLS_DIR, dir, 'config.json')
        if (!fs.existsSync(configPath)) continue
        manifests[dir] = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    }
    const canonicalIds = new Set(Object.values(buildToolIds(manifests)))
    const literals = sourceFiles(TOOLS_DIR).flatMap(literalsIn)

    it('finds literals to check', () => {
        // A refactor that renames the patterns above would otherwise leave this
        // suite passing on an empty list.
        expect(literals.length).toBeGreaterThan(10)
    })

    it('name an id a manifest declares', () => {
        const unknown = literals
            .filter((literal) => !canonicalIds.has(literal.id))
            .map(
                (literal) =>
                    `${literal.file}: ${literal.label} '${literal.id}'`
            )
        expect(unknown).toEqual([])
    })
})
