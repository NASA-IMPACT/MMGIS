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

// The legend model and colormap helpers are shared, host-agnostic code used
// by both this plugin and the export pipeline — as portable as anything
// inside lib/ itself, so lib/ may reach it the same way it reaches its own
// modules. Nothing else outside lib/ is exempt.
const SHARED_LEGEND_ROOT = resolve(PLUGIN_ROOT, '../_shared/legend')

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
                if (target.startsWith(SHARED_LEGEND_ROOT)) continue
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
})
