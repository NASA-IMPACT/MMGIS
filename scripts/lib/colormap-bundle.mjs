// Building and checking the bundled standard colormaps against a tiling
// service. The command-line entry point is scripts/colormaps.mjs; this module
// holds the logic so it can be unit tested without a network.
//
// The bundle is a JavaScript module holding one hex string per ramp, in the
// shared 256-colour RGBA format (see colormapTable). It carries only the
// standard ramps the app should be able to paint without a tiling service.
// Which ramps those are is decided by the bundle itself: regenerating keeps
// the names already bundled, and adding or replacing them is an explicit
// choice on the command line. A deployment's own custom ramps are never
// pulled in by accident.

import {
    colormapResponseToTable,
    compareColormapTables,
    decodeColormapTable,
    encodeColormapTable,
} from '../../src/essence/Basics/Colormaps/colormapTable.ts'
import { parseColormapList } from '../../src/essence/Tools/LayerManager/lib/utils/colormaps.ts'

/**
 * Per-channel difference (0-255) a bundled ramp may have from the service's
 * before the drift check reports it. Ramps computed from the same matplotlib
 * definitions by different library versions can round a channel either way.
 */
export const DEFAULT_TOLERANCE = 1

const RAMP_NAME = /^[a-z0-9][a-z0-9_-]*$/

/** Base URL with any trailing slash removed. */
export const normalizeServiceUrl = (url) => {
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
        throw new Error(
            `Expected the tiling service base URL (http:// or https://), got ${JSON.stringify(url)}`
        )
    }
    return url.replace(/\/+$/, '')
}

const fetchJson = async (fetchImpl, url) => {
    const response = await fetchImpl(url)
    if (!response.ok) {
        throw new Error(`GET ${url} answered ${response.status}`)
    }
    return response.json()
}

/** Every ramp name the service lists at `/colorMaps`, reversed ones included. */
export const fetchRampNames = async (serviceUrl, fetchImpl = fetch) => {
    const url = `${serviceUrl}/colorMaps`
    const names = parseColormapList(await fetchJson(fetchImpl, url))
    if (!names) throw new Error(`GET ${url} did not list any colormaps`)
    return names
}

/** One ramp from the service, converted to a table. */
export const fetchRampTable = async (serviceUrl, name, fetchImpl = fetch) =>
    colormapResponseToTable(
        name,
        await fetchJson(
            fetchImpl,
            `${serviceUrl}/colorMaps/${encodeURIComponent(name)}`
        )
    )

/**
 * Runs `task` over `items` with at most `limit` running at once and returns
 * `{ item, value }` or `{ item, error }` for each, in input order.
 */
export const mapSettled = async (items, task, limit = 8) => {
    const results = new Array(items.length)
    let next = 0
    const worker = async () => {
        while (next < items.length) {
            const index = next++
            try {
                results[index] = { item: items[index], value: await task(items[index]) }
            } catch (error) {
                results[index] = { item: items[index], error }
            }
        }
    }
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
    return results
}

/**
 * The bundle module's source: a header naming how it was made, then one
 * `name: 'hex',` line per ramp, sorted by name.
 */
export const renderBundleModule = (ramps, { serviceUrl }) => {
    const names = Object.keys(ramps).sort()
    const lines = names.map((name) => {
        if (!RAMP_NAME.test(name)) {
            throw new Error(`Colormap "${name}": not a lowercase ramp name`)
        }
        return `    '${name}': '${encodeColormapTable(ramps[name])}',`
    })
    return [
        '// Standard colour ramps bundled with the app, so they paint without a',
        '// tiling service. Each value is one ramp in the shared 256-colour RGBA',
        '// format: 256 colours, low end first, `rrggbbaa` hex per colour. Decode',
        '// with decodeColormapTable (src/essence/Basics/Colormaps/colormapTable.ts).',
        '//',
        '// Generated file: do not edit by hand. Regenerate, or check it for drift',
        '// against a service, with scripts/colormaps.mjs.',
        `// Generated from ${serviceUrl}/colorMaps (${names.length} ramps).`,
        '',
        'export const STANDARD_COLORMAPS = {',
        ...lines,
        '}',
        '',
    ].join('\n')
}

const BUNDLE_LINE = /^ {4}'([^']+)': '([^']*)',$/

/**
 * Reads the ramps back out of a module written by renderBundleModule, as
 * `{ name: table }`. Throws, naming the ramp, on a value that does not decode.
 */
export const parseBundleModule = (source) => {
    const ramps = {}
    for (const line of source.split('\n')) {
        const match = BUNDLE_LINE.exec(line)
        if (match) ramps[match[1]] = decodeColormapTable(match[1], match[2])
    }
    if (Object.keys(ramps).length === 0) {
        throw new Error('No ramps found in the colormap bundle')
    }
    return ramps
}

/**
 * The ramp names to bundle: those given with `names`, else the ones already
 * bundled, plus any in `add`. Names are lowercase, as the service spells them,
 * and never reversed variants, which are the forward ramp mirrored.
 */
export const chooseRampNames = ({ current = [], names, add = [] }) => {
    const chosen = new Set(names && names.length > 0 ? names : current)
    add.forEach((name) => chosen.add(name))
    if (chosen.size === 0) {
        throw new Error(
            'No ramps to bundle: pass --names, or regenerate an existing bundle'
        )
    }
    for (const name of chosen) {
        if (!RAMP_NAME.test(name)) {
            throw new Error(`Colormap "${name}": not a lowercase ramp name`)
        }
        if (/_r$/.test(name)) {
            throw new Error(
                `Colormap "${name}": bundle the forward ramp; reversed ramps are its mirror`
            )
        }
    }
    return [...chosen].sort()
}

/**
 * Fetches every chosen ramp from the service. Fails, listing each problem,
 * when a ramp is not on the service or does not convert: a bundle is either
 * complete or not written.
 */
export const buildBundle = async (serviceUrl, names, fetchImpl = fetch) => {
    const listed = new Set(await fetchRampNames(serviceUrl, fetchImpl))
    const missing = names.filter((name) => !listed.has(name))
    if (missing.length > 0) {
        throw new Error(
            `Not listed by ${serviceUrl}/colorMaps: ${missing.join(', ')}`
        )
    }
    const results = await mapSettled(names, (name) =>
        fetchRampTable(serviceUrl, name, fetchImpl)
    )
    const failures = results.filter((result) => result.error)
    if (failures.length > 0) {
        throw new Error(
            failures.map((failure) => failure.error.message).join('\n')
        )
    }
    return Object.fromEntries(results.map((result) => [result.item, result.value]))
}

/**
 * Compares bundled ramps with the service's. Returns one entry per ramp that
 * is missing from the service, fails to convert, or differs by more than
 * `tolerance` in any channel of any colour; an empty list means no drift.
 */
export const checkDrift = async (
    serviceUrl,
    bundled,
    { tolerance = DEFAULT_TOLERANCE, fetchImpl = fetch } = {}
) => {
    const listed = new Set(await fetchRampNames(serviceUrl, fetchImpl))
    const names = Object.keys(bundled).sort()
    const drift = names
        .filter((name) => !listed.has(name))
        .map((name) => ({ name, problem: 'not listed by the service' }))
    const results = await mapSettled(
        names.filter((name) => listed.has(name)),
        (name) => fetchRampTable(serviceUrl, name, fetchImpl)
    )
    for (const { item: name, value, error } of results) {
        if (error) {
            drift.push({ name, problem: error.message })
            continue
        }
        const { maxDifference, colorsBeyondTolerance } = compareColormapTables(
            bundled[name],
            value,
            tolerance
        )
        if (colorsBeyondTolerance > 0) {
            drift.push({
                name,
                problem: `${colorsBeyondTolerance} of 256 colours differ by more than ${tolerance} (largest difference ${maxDifference})`,
            })
        }
    }
    return drift.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Converts every ramp the service lists, reversed ones included, and returns
 * the ones that fail as `{ name, problem }`.
 */
export const checkAllConvert = async (serviceUrl, fetchImpl = fetch) => {
    const names = await fetchRampNames(serviceUrl, fetchImpl)
    const results = await mapSettled(names, (name) =>
        fetchRampTable(serviceUrl, name, fetchImpl)
    )
    return {
        count: names.length,
        failures: results
            .filter((result) => result.error)
            .map((result) => ({ name: result.item, problem: result.error.message })),
    }
}
