import { describe, test, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

/**
 * Core computes a layer's data coverage; tools read it only over the bus
 * ('layers:getDataCoverage' and 'layers:dataCoverageChanged'). A tool that
 * imports the coverage module, or reads or writes core's coverage registry
 * directly, is tied to core's internals.
 */

const TOOLS_ROOT = resolve(process.cwd(), 'src/essence/Tools')

const sourceFilesUnder = (dir) =>
    readdirSync(dir).flatMap((entry) => {
        const path = join(dir, entry)
        if (statSync(path).isDirectory()) return sourceFilesUnder(path)
        return /\.[jt]sx?$/.test(entry) ? [path] : []
    })

const FORBIDDEN = [
    /['"][^'"]*\/layerDataCoverage(\.js)?['"]/,
    /\blayers\s*(\?\.|\.)\s*(dataCoverage|coverageHidden)\b/,
    /\bL_\s*(\?\.|\.)\s*(assess|set)LayerDataCoverage\b/,
]

describe('tools read data coverage only over the bus', () => {
    test('no tool imports the coverage module or touches core coverage state', () => {
        const files = sourceFilesUnder(TOOLS_ROOT)
        expect(files.length).toBeGreaterThan(100)

        const offenders = files.flatMap((file) =>
            readFileSync(file, 'utf8')
                .split('\n')
                .flatMap((line, i) =>
                    FORBIDDEN.some((pattern) => pattern.test(line))
                        ? [`${relative(TOOLS_ROOT, file)}:${i + 1}: ${line.trim()}`]
                        : [],
                ),
        )
        expect(offenders).toEqual([])
    })
})
