import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname } from 'node:path'

/**
 * The plugin boundary, enforced.
 *
 * `lib/` is the portable half — the components and utilities a marketplace
 * host embeds. It may know nothing about MMGIS: not its modules, not its
 * globals. Everything host-specific belongs in `adapters/`, which reaches core
 * only through the shared message bus.
 *
 * That rule is invisible at runtime. A component that reads
 * `window.mmgisglobal?.something` still renders under any host — it just
 * quietly renders wrong, and the coupling is only discovered when someone
 * tries to extract the plugin. This spec is what makes the rule fail loudly
 * instead, at the point it is broken.
 */

// Resolved from the vitest root rather than `import.meta.url`, which the jsdom
// environment hands back as an http URL that `fileURLToPath` rejects.
const PLUGIN_ROOT = resolve(process.cwd(), 'src/essence/Tools/LayerManager')
const LIB_ROOT = join(PLUGIN_ROOT, 'lib')

// Only these four modules under _shared/legend are host-agnostic — pure
// types, formatting rules, and colormap-name/list/cache logic with no
// dependency on an MMGIS module or a network call — so lib/ may reach them
// the same way it reaches its own modules. Everything else in that
// directory is NOT exempt: getVisibleLayersWithLegends and
// getExportLegendModel import mmgisAPI (a host bus client), and
// resolveColormapColors makes a relative import into src/external/ — all
// host-coupled in ways lib/ must never be.
const SHARED_LEGEND_ROOT = resolve(PLUGIN_ROOT, '../_shared/legend')
const SHARED_LEGEND_ALLOWLIST = ['types', 'format', 'colormaps', 'colormapCache']

const isAllowedSharedLegendImport = (target) => {
    if (dirname(target) !== SHARED_LEGEND_ROOT) return false
    const base = target.replace(/\.(ts|tsx|js|jsx)$/, '').split('/').pop()
    return SHARED_LEGEND_ALLOWLIST.includes(base)
}

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

const LIB_FILES = sourceFilesUnder(LIB_ROOT)

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

describe('lib/ is free of the host', () => {
    test('there are lib files to check', () => {
        // Guards the walker itself: a rename that empties LIB_FILES would make
        // every assertion below pass over nothing.
        expect(LIB_FILES.length).toBeGreaterThan(10)
    })

    test('no relative import escapes lib/', () => {
        const escaping = []
        for (const file of LIB_FILES) {
            for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
                if (!specifier.startsWith('.')) continue
                const target = resolve(dirname(file), specifier)
                if (target.startsWith(LIB_ROOT)) continue
                if (isAllowedSharedLegendImport(target)) continue
                escaping.push(
                    `${relative(PLUGIN_ROOT, file)} -> ${specifier}`,
                )
            }
        }
        // Anything lib/ needs from the host arrives as a prop or an argument;
        // an import means the host has to ship that module too.
        expect(escaping).toEqual([])
    })

    test('no bare import names an MMGIS module', () => {
        const coupled = []
        for (const file of LIB_FILES) {
            for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
                if (specifier.startsWith('.')) continue
                if (/(^|\/)(essence|pre)\//.test(specifier)) {
                    coupled.push(`${relative(PLUGIN_ROOT, file)} -> ${specifier}`)
                }
            }
        }
        expect(coupled).toEqual([])
    })

    test('no module reads an MMGIS global', () => {
        // Both the bus (`mmgisAPI`) and the build/mission config
        // (`mmgisglobal`) are host surfaces. Reaching either from lib/ ties a
        // component to MMGIS in a way no prop makes visible.
        const offenders = []
        for (const file of LIB_FILES) {
            const source = readFileSync(file, 'utf8')
            for (const [index, line] of source.split('\n').entries()) {
                if (/\bmmgis(API|global)\b/i.test(line)) {
                    offenders.push(
                        `${relative(PLUGIN_ROOT, file)}:${index + 1}: ${line.trim()}`,
                    )
                }
            }
        }
        expect(offenders).toEqual([])
    })

    test('the guard would catch a violation it is meant to catch', () => {
        // Proves the matchers above are live rather than vacuously passing.
        const escaping = importedSpecifiers(
            "import ServiceUrls from '../../../../Basics/ServiceUrls/ServiceUrls'\n",
        )
        expect(escaping).toEqual(['../../../../Basics/ServiceUrls/ServiceUrls'])
        expect(
            resolve(join(LIB_ROOT, 'utils'), escaping[0]).startsWith(LIB_ROOT),
        ).toBe(false)

        expect(
            importedSpecifiers("import { isStaticBuild } from '../../../../../pre/capabilities'\n"),
        ).toEqual(['../../../../../pre/capabilities'])

        expect(/\bmmgis(API|global)\b/i.test("window.mmgisglobal?.WITH_TITILER === 'true'"))
            .toBe(true)
    })

    test('the shared-legend allowlist is scoped to the host-agnostic files, not the whole directory', () => {
        const allowed = (name) =>
            isAllowedSharedLegendImport(join(SHARED_LEGEND_ROOT, name))
        // What lib/ actually imports today — must stay allowed.
        expect(allowed('types')).toBe(true)
        expect(allowed('format')).toBe(true)
        expect(allowed('colormaps')).toBe(true)
        expect(allowed('colormapCache')).toBe(true)
        // Host-coupled modules in the same directory — a lib/ import of any
        // of these must now fail the "no relative import escapes lib/"
        // check above, the way it would for any other host module.
        expect(allowed('getExportLegendModel')).toBe(false)
        expect(allowed('getVisibleLayersWithLegends')).toBe(false)
        expect(allowed('resolveColormapColors')).toBe(false)
        // A file outside _shared/legend entirely, even with an allowlisted
        // basename, is not exempt.
        expect(isAllowedSharedLegendImport(join(PLUGIN_ROOT, '../_shared/adapters/types'))).toBe(false)
    })
})
