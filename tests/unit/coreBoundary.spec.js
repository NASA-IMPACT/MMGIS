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
 * Sharing in the other direction is fine and expected: a plugin may import a
 * core module, and core code that needs to agree with a plugin (colormap
 * naming, say) owns the shared module itself.
 */

const CORE_ROOT = resolve(process.cwd(), 'src/essence/Basics')
const TOOLS_ROOT = resolve(process.cwd(), 'src/essence/Tools')
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

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

const CORE_FILES = sourceFilesUnder(CORE_ROOT)

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

    test('the guard would catch a violation it is meant to catch', () => {
        // Proves the matcher is live rather than vacuously passing.
        const specifier = '../../../Tools/_shared/legend/colormaps'
        const from = join(CORE_ROOT, 'MapEngines/Adapters/colormapLUT.ts')
        expect(
            resolve(dirname(from), specifier).startsWith(TOOLS_ROOT + '/'),
        ).toBe(true)
    })
})
