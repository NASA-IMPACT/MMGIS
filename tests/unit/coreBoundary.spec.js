import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

/**
 * The other half of the plugin boundary.
 *
 * `Basics/` is the core: the map engines, the layer store, the bus. Tools are
 * on their way to being plugin packages installed on top of it, so a core
 * module that imports one inverts the dependency — the core stops being
 * installable without that plugin's directory present, and extracting the
 * plugin breaks the core path that reached into it.
 *
 * Sharing in the other direction is not: a plugin must not import a core
 * module at runtime either. The sanctioned surface between a plugin and core
 * is the bus, reached through the typed adapter at
 * `src/essence/Tools/_shared/adapters/mmgisAPI.ts`. Type-only imports
 * (`import type { ... }` / `export type { ... }`) are tolerated because they
 * vanish at build time and carry no runtime dependency. The runtime imports
 * that still exist elsewhere under `Tools/` are legacy debt this boundary is
 * tightening around, not precedent for new code.
 */

const CORE_ROOT = resolve(process.cwd(), 'src/essence/Basics')
const TOOLS_ROOT = resolve(process.cwd(), 'src/essence/Tools')
const SHARED_ROOT = resolve(process.cwd(), 'src/essence/Tools/_shared')
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

// Runtime (non-type-only) imports of core that predate this test. Legacy
// debt to be removed, not a precedent for new code under Tools/_shared.
const ALLOWLISTED_SHARED_RUNTIME_OFFENDERS = [
    'content/markdown.ts',
    'content/iconClass.ts',
]

const sourceFilesUnder = (dir) => {
    const found = []
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) {
            found.push(...sourceFilesUnder(path))
        } else if (SOURCE_EXTENSIONS.some((ext) => entry.endsWith(ext))) {
            found.push(path)
        }
    }
    return found
}

/** Every module specifier in `import ... from 'x'`, `export ... from 'x'`, and `import('x')`. */
const importedSpecifiers = (source) => {
    const specifiers = []
    const patterns = [
        /(?:^|\n)\s*(?:import|export)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g,
        /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]
    for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(source)) !== null) specifiers.push(match[1])
    }
    return specifiers
}

/**
 * Every `import ... from 'x'` / `export ... from 'x'` in source, alongside
 * whether the statement is type-only (`import type { ... }` or
 * `export type { ... }`). A type-only import vanishes at build time, so it
 * carries no runtime dependency on `x`.
 */
const importedSpecifiersWithTypeInfo = (source) => {
    const results = []
    const fromPattern =
        /(?:^|\n)\s*(import|export)(\s+type\b)?[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g
    let match
    while ((match = fromPattern.exec(source)) !== null) {
        results.push({ specifier: match[3], typeOnly: !!match[2] })
    }
    const barePattern = /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
    while ((match = barePattern.exec(source)) !== null) {
        results.push({ specifier: match[1], typeOnly: false })
    }
    const dynamicPattern = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g
    while ((match = dynamicPattern.exec(source)) !== null) {
        results.push({ specifier: match[1], typeOnly: false })
    }
    return results
}

const CORE_FILES = sourceFilesUnder(CORE_ROOT)
const SHARED_FILES = sourceFilesUnder(SHARED_ROOT)

describe('core is free of the plugins', () => {
    test('there are core files to check', () => {
        // Guards the walker: a move that emptied CORE_FILES would make the
        // assertion below pass over nothing.
        expect(CORE_FILES.length).toBeGreaterThan(10)
    })

    test('no module under Basics/ imports from Tools/', () => {
        const reaching = []
        for (const file of CORE_FILES) {
            for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
                const target = specifier.startsWith('.')
                    ? resolve(dirname(file), specifier)
                    : null
                const namesTools =
                    (target && target.startsWith(TOOLS_ROOT + '/')) ||
                    /(^|\/)essence\/Tools\//.test(specifier)
                if (namesTools) {
                    reaching.push(`${relative(CORE_ROOT, file)} -> ${specifier}`)
                }
            }
        }
        expect(reaching).toEqual([])
    })

    test('there are shared files to check', () => {
        // Guards the walker below: a move that emptied SHARED_FILES would
        // make that assertion pass over nothing.
        expect(SHARED_FILES.length).toBeGreaterThan(0)
    })

    test('no module under Tools/_shared imports core at runtime', () => {
        const violations = []
        for (const file of SHARED_FILES) {
            const relPath = relative(SHARED_ROOT, file)
            const isAllowlisted = ALLOWLISTED_SHARED_RUNTIME_OFFENDERS.includes(relPath)
            for (const { specifier, typeOnly } of importedSpecifiersWithTypeInfo(
                readFileSync(file, 'utf8')
            )) {
                if (typeOnly) continue
                const target = specifier.startsWith('.')
                    ? resolve(dirname(file), specifier)
                    : null
                const namesCore =
                    (target && target.startsWith(CORE_ROOT + '/')) ||
                    /(^|\/)essence\/Basics\//.test(specifier)
                if (namesCore && !isAllowlisted) {
                    violations.push(`${relPath} -> ${specifier}`)
                }
            }
        }
        expect(violations).toEqual([])
    })
})
