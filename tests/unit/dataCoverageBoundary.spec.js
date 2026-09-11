import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Tools consume a layer's data coverage; core computes it.
 *
 * Core decides whether a layer holds data in the window it would request
 * (`Basics/TimeControl_/layerDataCoverage.js`), records the verdict through
 * `L_.assessLayerDataCoverage` / `L_.setLayerDataCoverage`, and keeps it in
 * its layer registry as `layers.dataCoverage`, alongside `layers.coverageHidden`
 * for what the gate took off the map. Tools read that verdict only over the
 * message bus —
 * 'layers:getDataCoverage' and 'layers:dataCoverageChanged', through the
 * typed wrappers in `_shared/adapters/mmgisAPI.ts`.
 *
 * Importing the coverage module would have a tool compute coverage its own
 * way; reading the registry or calling the recorders would tie it to core's
 * internals, and a recorder called from outside would put words in core's
 * mouth. Each works today and breaks the moment the tool runs anywhere but
 * inside this core. This spec makes all of them fail at the point they are
 * written.
 */

// Resolved from the vitest root rather than `import.meta.url`, which the jsdom
// environment hands back as an http URL that `fileURLToPath` rejects.
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

const TOOL_FILES = sourceFilesUnder(TOOLS_ROOT)

/**
 * Every module specifier in `import ... from 'x'`, `export ... from 'x'`,
 * `import 'x'`, `import('x')` and `require('x')`.
 */
const importedSpecifiers = (source) => {
    const specifiers = []
    const patterns = [
        /(?:^|\n)\s*(?:import|export)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g,
        /(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g,
        /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
        /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    ]
    for (const pattern of patterns) {
        let match
        while ((match = pattern.exec(source)) !== null) specifiers.push(match[1])
    }
    return specifiers
}

/** A specifier naming the core coverage module, with or without extension. */
const namesCoverageModule = (specifier) =>
    /(^|\/)layerDataCoverage(\.[jt]sx?)?$/.test(specifier)

/**
 * A read of the registry's coverage map, `layers.dataCoverage` — dotted,
 * optional-chained or bracketed, however `L_` is reached, and under the
 * `layerRegistry` name core also passes the registry around as. Only the
 * registry's map counts: a legend row carries its own `dataCoverage` field.
 */
const READS_COVERAGE_REGISTRY =
    /\b(?:layers|layerRegistry)\s*(?:\?\.|\.)\s*dataCoverage\b|\b(?:layers|layerRegistry)\s*(?:\?\.)?\s*\[\s*['"`]dataCoverage['"`]\s*\]/

/**
 * A read of the gate's own bookkeeping. The name is core's alone, so any
 * property access to it counts, whatever it hangs off.
 */
const READS_COVERAGE_HIDDEN =
    /(?:\?\.|\.)\s*coverageHidden\b|\[\s*['"`]coverageHidden['"`]\s*\]/

/**
 * Either registry entry destructured from the registry itself, over as many
 * lines as the pattern spans: `const { dataCoverage } = L_.layers`. The
 * right-hand side has to end at the registry — `L_.layers`, however `L_` is
 * reached, or `layerRegistry` — so a tool destructuring its own `layers`, or
 * an item found in them, is left alone.
 */
const DESTRUCTURES_REGISTRY =
    /\{[^{}]*\b(?:dataCoverage|coverageHidden)\b[^{}]*\}\s*=\s*(?:[\w$]+\s*(?:\?\.|\.)\s*)*(?:L_\s*(?:\?\.|\.)\s*layers|layerRegistry)\b(?!\s*(?:\?\.|\.|\[|\())/

/**
 * One of core's coverage recorders reached through the object holding it —
 * `L_.setLayerDataCoverage`, `L_['assessLayerDataCoverage']`. A bare name,
 * or one reached through `props` or `this.props`, is left alone:
 * `setLayerDataCoverage` is as natural a name for a tool's own state setter,
 * and for the same setter handed down to a child.
 */
const USES_COVERAGE_RECORDER =
    /(?<!\bprops\s*\??)(?:\?\.|\.)\s*(?:assess|set)LayerDataCoverage\b|(?<!\bprops\s*(?:\?\.)?\s*)\[\s*['"`](?:assess|set)LayerDataCoverage['"`]\s*\]/

const LINE_MATCHERS = [
    READS_COVERAGE_REGISTRY,
    READS_COVERAGE_HIDDEN,
    USES_COVERAGE_RECORDER,
]

/** Line number of a character offset, for pointing at a multi-line match. */
const lineOf = (source, offset) => source.slice(0, offset).split('\n').length

describe('tools read data coverage only over the bus', () => {
    test('there are tool files to check', () => {
        // Guards the walker: a move that empties TOOL_FILES would let every
        // assertion below pass over nothing.
        expect(TOOL_FILES.length).toBeGreaterThan(100)
        expect(
            TOOL_FILES.map((file) => relative(TOOLS_ROOT, file)),
        ).toContain(join('LayerManager', 'MMGISLayerManagerAdapter.tsx'))
    })

    test('no tool imports the core coverage module', () => {
        const offenders = []
        for (const file of TOOL_FILES) {
            for (const specifier of importedSpecifiers(readFileSync(file, 'utf8'))) {
                if (namesCoverageModule(specifier)) {
                    offenders.push(`${relative(TOOLS_ROOT, file)} -> ${specifier}`)
                }
            }
        }
        expect(offenders).toEqual([])
    })

    test("no tool reads core's coverage registry or calls its recorders", () => {
        const offenders = []
        for (const file of TOOL_FILES) {
            const source = readFileSync(file, 'utf8')
            for (const [index, line] of source.split('\n').entries()) {
                if (LINE_MATCHERS.some((matcher) => matcher.test(line))) {
                    offenders.push(
                        `${relative(TOOLS_ROOT, file)}:${index + 1}: ${line.trim()}`,
                    )
                }
            }
            const destructured = new RegExp(DESTRUCTURES_REGISTRY.source, 'g')
            let match
            while ((match = destructured.exec(source)) !== null) {
                offenders.push(
                    `${relative(TOOLS_ROOT, file)}:${lineOf(source, match.index)}: ` +
                        match[0].replace(/\s+/g, ' '),
                )
            }
        }
        expect(offenders).toEqual([])
    })

    test('the guard would catch a violation it is meant to catch', () => {
        // Proves the matchers above are live rather than vacuously passing.
        const imported = [
            ...importedSpecifiers(
                "import { evaluateLayerDataCoverage } from '../../Basics/TimeControl_/layerDataCoverage'\n",
            ),
            ...importedSpecifiers(
                "export { resolveDataCoverage } from '../Basics/TimeControl_/layerDataCoverage.js'\n",
            ),
            ...importedSpecifiers(
                "const m = await import('../../Basics/TimeControl_/layerDataCoverage')",
            ),
            ...importedSpecifiers(
                "const m = require('../../Basics/TimeControl_/layerDataCoverage')",
            ),
        ]
        expect(imported).toHaveLength(4)
        expect(imported.every(namesCoverageModule)).toBe(true)

        for (const read of [
            'const record = L_.layers.dataCoverage[uuid]',
            'const all = window.L_?.layers?.dataCoverage',
            "const all = L_.layers['dataCoverage']",
            'const record = ctx.layerRegistry.dataCoverage[name]',
        ]) {
            expect(READS_COVERAGE_REGISTRY.test(read)).toBe(true)
        }

        for (const read of [
            'if (L_.layers.coverageHidden[name]) return',
            'const hidden = ctx.layerRegistry?.coverageHidden',
            "const hidden = L_.layers['coverageHidden']",
        ]) {
            expect(READS_COVERAGE_HIDDEN.test(read)).toBe(true)
        }

        for (const destructuring of [
            'const { dataCoverage } = L_.layers',
            'const { on, coverageHidden: hidden } = window.L_?.layers',
            'const {\n    opacity,\n    dataCoverage,\n} = L_.layers\n',
            'const { dataCoverage } = ctx.layerRegistry',
            'const { dataCoverage } = L_.layers;',
            'use(({ coverageHidden } = L_.layers))',
        ]) {
            expect(DESTRUCTURES_REGISTRY.test(destructuring)).toBe(true)
        }

        for (const use of [
            'L_.assessLayerDataCoverage(layer)',
            'L_.setLayerDataCoverage(name, record)',
            'const assess = L_?.assessLayerDataCoverage',
            "L_['setLayerDataCoverage'](name, record)",
            "window.L_?.['assessLayerDataCoverage']",
            'L_.setLayerDataCoverage(props.layer, record)',
            'myprops.setLayerDataCoverage(record)',
            'this.props.L_.assessLayerDataCoverage(layer)',
        ]) {
            expect(USES_COVERAGE_RECORDER.test(use)).toBe(true)
        }

        // The bus surface and a row's own coverage field stay allowed.
        const allowed = [
            "mmgisRequestIfProvided('layers:getDataCoverage', layerUUID)",
            "mmgisOn('layers:dataCoverageChanged', handler)",
            'const coverage = await mmgisGetDataCoverage()',
            'dataCoverage: coverage?.[layerName] ?? null',
            'const { title, dataCoverage } = layer',
            'rows.map((row) => row.dataCoverage)',
            'const getDataCoverage = mmgisGetLayerDataCoverage',
            // A tool's own state, whatever it calls its setter.
            'const [layerDataCoverage, setLayerDataCoverage] = useState(null)',
            'setLayerDataCoverage(record)',
            'assessLayerDataCoverage(record)',
            // The same setter handed down as a prop.
            'props.setLayerDataCoverage(record)',
            'this.props.setLayerDataCoverage(record)',
            'props?.assessLayerDataCoverage?.(record)',
            "props['setLayerDataCoverage'](record)",
            "this.props?.['assessLayerDataCoverage'](record)",
            // A tool's own list of layers, or an item from it.
            'const { dataCoverage } = layers.find((l) => l.id === id)',
            'const { dataCoverage } = layers[0]',
            'const { dataCoverage, title } = props.layers',
            'const { coverageHidden } = this.props.layers',
        ]
        for (const line of allowed) {
            expect(LINE_MATCHERS.some((matcher) => matcher.test(line))).toBe(false)
            expect(DESTRUCTURES_REGISTRY.test(line)).toBe(false)
        }
        expect(namesCoverageModule('../lib/utils/dataCoverageWording')).toBe(false)
    })
})
