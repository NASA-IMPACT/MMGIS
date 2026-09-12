# Runtime Layer Time Extent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A time-enabled layer can read its data time extent (start, end, interval, dates) from a JSON endpoint when the mission loads, with the static config fields as the fallback.

**Architecture:** One new pure core module holds a tiny path reader, value normalization, a merge onto the layer's `time` block, and a never-throwing fetch. The layer loader starts one fetch per configured layer while it walks the config and awaits them all before returning, so every existing reader of the four static fields sees the fetched values on first read and nothing downstream changes. Five new Configure fields carry the URL and paths.

**Tech Stack:** TypeScript (non-strict, `tsconfig.json` has `"strict": false`), vitest in a jsdom environment, browser `fetch` + `AbortController`, Configure metaconfig JSON.

**Spec:** `docs/superpowers/specs/2026-09-11-runtime-layer-time-extent-design.md` (committed on this branch). GitHub issue: NASA-IMPACT/MMGIS#430.

## Global Constraints

- Branch: `feature/runtime-layer-time-extent`. Never commit on `development`.
- No new npm dependency. The path reader is hand-written (spec, "Approaches considered").
- Nothing in this feature may throw out of the layer loader or keep a layer off the map. Every failure falls back to the static fields and warns once per layer.
- Fetch timeout default: `10000` ms. Fetch is a plain GET with default `fetch` options (same-origin credentials only).
- Path grammar, exactly: optional leading `$` or `$.`; dot-separated keys; `[n]` zero-based index; `[*]` flattening one level. Everything else is invalid.
- Normalization: start/end accept a string as written or a finite number as epoch milliseconds rendered as `YYYY-MM-DDTHH:mm:ssZ`; interval accepts a string; dates accept an array of strings/finite numbers (others dropped) or a lone string/number as a one-entry list. `null`, objects, booleans, arrays (for start/end/interval), and empty strings are never applied.
- Unit tests live in `tests/unit/*.spec.js` using `import { describe, test, expect, vi } from 'vitest'`, 4-space indent, single quotes, no semicolons (match `tests/unit/layerTimePolicy.spec.js`).
- Run unit tests with `npx vitest run <file>`; the full unit suite is `npm run test:unit`.
- Comments describe the code as it is, never the change. No AI attribution anywhere, and no `Co-Authored-By` trailer on commits.
- Commit messages: imperative mood, no feature-number prefix (this branch has no spec-kit number).

---

## File map

| File | Responsibility |
| --- | --- |
| `src/essence/Basics/TimeControl_/layerExtentSource.ts` (new) | `readPath`, per-field normalization, `applyExtentSource`, `fetchLayerExtentSource`. Pure except for the injected `fetch`. |
| `tests/unit/layerExtentSource.spec.js` (new) | Every behavior of the module above. |
| `src/essence/Basics/Layers_/Layers_.js` | In `parseConfig`'s `expandLayers` walk: start a fetch per configured layer, await them all after the walk. |
| `configure/src/metaconfigs/layer-tile-config.json`, `layer-vector-config.json`, `layer-vectortile-config.json`, `layer-query-config.json`, `layer-velocity-config.json` | Five `text` fields in the "Data Time Extent" subsection; fallback sentence on the existing fields. |

The module's public surface, used by every later task:

```ts
export function readPath(json: unknown, path: string): unknown
// undefined when the path is invalid or matches nothing

export interface ExtentSource {
    url?: string | null
    startPath?: string | null
    endPath?: string | null
    intervalPath?: string | null
    datesPath?: string | null
}

export interface LayerTime {
    enabled?: boolean
    dataStartTime?: string | null
    dataEndTime?: string | null
    interval?: string | null
    dataDates?: string[] | string | null
    extentSource?: ExtentSource | null
    [key: string]: unknown
}

export interface ApplyReport {
    applied: string[] // field names overwritten: 'dataStartTime' | 'dataEndTime' | 'interval' | 'dataDates'
    skipped: string[] // one human-readable reason per field left alone (blank paths are not reported)
}

export function applyExtentSource(time: LayerTime, json: unknown): ApplyReport

export function fetchLayerExtentSource(
    layer: { name?: string; display_name?: string; time?: LayerTime | null },
    options?: { timeoutMs?: number; fetchImpl?: typeof fetch }
): Promise<ApplyReport | null>
// null when there was nothing to fetch or the fetch failed; never rejects
```

---

### Task 1: Path reader

**Files:**
- Create: `src/essence/Basics/TimeControl_/layerExtentSource.ts`
- Test: `tests/unit/layerExtentSource.spec.js`

**Interfaces:**
- Produces: `readPath(json, path)` as declared in the file map. Later tasks call it with each configured path.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/layerExtentSource.spec.js`:

```js
import { describe, test, expect } from 'vitest'
import { readPath } from '../../src/essence/Basics/TimeControl_/layerExtentSource'

const STAC = {
    extent: { temporal: { interval: [['2020-01-01T00:00:00Z', null]] } },
    summaries: { datetime: ['2020-01', '2020-02'], cadence: 'P1M' },
    features: [
        { properties: { datetime: '2021-01-01T00:00:00Z' } },
        { properties: { datetime: '2021-02-01T00:00:00Z' } },
    ],
}

describe('layer extent source', () => {
    describe('readPath', () => {
        test.each([
            ['extent.temporal.interval[0][0]', '2020-01-01T00:00:00Z'],
            ['extent.temporal.interval[0][1]', null],
            ['summaries.cadence', 'P1M'],
            ['summaries.datetime', ['2020-01', '2020-02']],
            ['summaries.datetime[*]', ['2020-01', '2020-02']],
            ['$.summaries.cadence', 'P1M'],
            ['$summaries.cadence', 'P1M'],
            [
                'features[*].properties.datetime',
                ['2021-01-01T00:00:00Z', '2021-02-01T00:00:00Z'],
            ],
            ['extent.temporal.interval[*]', [['2020-01-01T00:00:00Z', null]]],
        ])('reads %s', (path, expected) => {
            expect(readPath(STAC, path)).toEqual(expected)
        })

        test.each([
            ['missing.key'],
            ['summaries.datetime[5]'],
            ['summaries.cadence.deeper'],
            ['features[*].nothing'],
        ])('%s matches nothing', (path) => {
            expect(readPath(STAC, path)).toBeUndefined()
        })

        test('[*] on a non-array matches nothing', () => {
            expect(readPath(STAC, 'summaries[*]')).toBeUndefined()
        })

        test('[*] yielding no elements matches nothing', () => {
            expect(readPath({ items: [] }, 'items[*].id')).toBeUndefined()
        })

        test.each([
            ['$..datetime'],
            ["features[?(@.id=='a')]"],
            ["['summaries']"],
            ['summaries..cadence'],
            ['summaries.'],
            ['[0]'],
            [''],
            ['summaries[a]'],
        ])('rejects %s as invalid', (path) => {
            expect(readPath(STAC, path)).toBeUndefined()
        })

        test('non-object roots match nothing', () => {
            expect(readPath(null, 'a')).toBeUndefined()
            expect(readPath('str', 'a')).toBeUndefined()
        })
    })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layerExtentSource.spec.js`
Expected: FAIL, the module cannot be resolved.

- [ ] **Step 3: Write the path reader**

Create `src/essence/Basics/TimeControl_/layerExtentSource.ts`:

```ts
/**
 * A layer's runtime time-extent source: a URL returning JSON plus a path
 * into that JSON for each of the four static data-time fields. Fetched once
 * while the mission's layers load, before any reader sees the layer, and
 * merged onto `layer.time` so every existing reader of `dataStartTime`,
 * `dataEndTime`, `interval` and `dataDates` sees the fetched values without
 * knowing where they came from. The static fields are the fallback for
 * anything the source cannot supply.
 *
 * Pure except for the injected `fetch`; nothing here touches the DOM, an
 * engine or the layer registry.
 */

/**
 * Path grammar, deliberately small: an optional leading `$` or `$.`,
 * dot-separated object keys, `[n]` array indexes and `[*]` for every element
 * of an array, flattened one level. Filters, recursive descent and quoted
 * keys are invalid and match nothing.
 */
const SEGMENT_RE = /^([^.[\]]+)|^\[(\d+|\*)\]/

type Segment = { key: string } | { index: number } | { all: true }

function parsePath(path: string): Segment[] | null {
    let rest = path.trim()
    if (rest.startsWith('$.')) rest = rest.slice(2)
    else if (rest.startsWith('$')) rest = rest.slice(1)
    // A path begins with a key: a bare index or a leading dot has no object
    // to apply to, so `$..a`, `$[0]` and `[0]` are all invalid.
    if (rest === '' || rest.startsWith('[') || rest.startsWith('.')) return null

    const segments: Segment[] = []
    while (rest.length > 0) {
        // A dot separates a key from what precedes it; a dot followed by
        // nothing, another dot or an index is malformed.
        if (rest.startsWith('.')) {
            rest = rest.slice(1)
            if (rest === '' || rest.startsWith('.') || rest.startsWith('['))
                return null
        }
        const m = SEGMENT_RE.exec(rest)
        if (!m) return null
        if (m[1] != null) segments.push({ key: m[1] })
        else if (m[2] === '*') segments.push({ all: true })
        else segments.push({ index: Number(m[2]) })
        rest = rest.slice(m[0].length)
    }
    return segments
}

function step(value: unknown, segment: Segment): unknown {
    if (value == null) return undefined
    if ('all' in segment) {
        return Array.isArray(value) && value.length > 0 ? value : undefined
    }
    if ('index' in segment) {
        return Array.isArray(value) ? value[segment.index] : undefined
    }
    if (typeof value !== 'object' || Array.isArray(value)) return undefined
    return (value as Record<string, unknown>)[segment.key]
}

/**
 * The value a path names inside `json`, or undefined when the path is
 * invalid or matches nothing. A `[*]` fans out: every later segment is
 * applied to each element, and elements that match nothing are dropped.
 * A fan-out that leaves no elements matches nothing.
 */
export function readPath(json: unknown, path: string): unknown {
    const segments = parsePath(path)
    if (segments == null) return undefined

    let fannedOut = false
    let current: unknown = json
    for (const segment of segments) {
        if (fannedOut) {
            const next = (current as unknown[])
                .map((el) => step(el, segment))
                .filter((v) => v !== undefined)
            if (next.length === 0) return undefined
            current = next
        } else {
            current = step(current, segment)
            if (current === undefined) return undefined
            if ('all' in segment) fannedOut = true
        }
    }
    return current
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layerExtentSource.spec.js`
Expected: PASS, all `readPath` cases green.

- [ ] **Step 5: Commit**

```bash
git add src/essence/Basics/TimeControl_/layerExtentSource.ts tests/unit/layerExtentSource.spec.js
git commit -m "Add a path reader for layer time-extent sources"
```

---

### Task 2: Normalization and merge onto the layer's time block

**Files:**
- Modify: `src/essence/Basics/TimeControl_/layerExtentSource.ts`
- Test: `tests/unit/layerExtentSource.spec.js`

**Interfaces:**
- Consumes: `readPath` from Task 1.
- Produces: `applyExtentSource(time, json): ApplyReport`, and the exported `ExtentSource`, `LayerTime`, `ApplyReport` types from the file map. Task 3 calls `applyExtentSource` and logs the report.

- [ ] **Step 1: Write the failing tests**

Append to the `describe('layer extent source')` block in `tests/unit/layerExtentSource.spec.js`, and extend the import:

```js
import {
    readPath,
    applyExtentSource,
} from '../../src/essence/Basics/TimeControl_/layerExtentSource'
```

```js
    describe('applyExtentSource', () => {
        const staticTime = () => ({
            enabled: true,
            dataStartTime: '2000-01-01T00:00:00Z',
            dataEndTime: 'now',
            interval: 'P1D',
            dataDates: ['2000-01-01'],
        })

        test('a mapped string overrides each field as written', () => {
            const time = {
                ...staticTime(),
                extentSource: {
                    url: 'x',
                    startPath: 'extent.temporal.interval[0][0]',
                    endPath: 'end',
                    intervalPath: 'summaries.cadence',
                    datesPath: 'summaries.datetime[*]',
                },
            }
            const report = applyExtentSource(time, {
                ...STAC,
                end: 'now - P1D',
            })
            expect(time.dataStartTime).toBe('2020-01-01T00:00:00Z')
            expect(time.dataEndTime).toBe('now - P1D')
            expect(time.interval).toBe('P1M')
            expect(time.dataDates).toEqual(['2020-01', '2020-02'])
            expect(report.applied.sort()).toEqual([
                'dataDates',
                'dataEndTime',
                'dataStartTime',
                'interval',
            ])
            expect(report.skipped).toEqual([])
        })

        test('a finite number is epoch milliseconds, written as ISO', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: 'start', datesPath: 'ds' },
            }
            applyExtentSource(time, { start: 0, ds: [86400000, '2020-03'] })
            expect(time.dataStartTime).toBe('1970-01-01T00:00:00Z')
            expect(time.dataDates).toEqual(['1970-01-02T00:00:00Z', '2020-03'])
        })

        test('a lone scalar for dates becomes a one-entry list', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            applyExtentSource(time, { d: '2020-03' })
            expect(time.dataDates).toEqual(['2020-03'])
        })

        test('unaccepted date entries are dropped, not applied', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            applyExtentSource(time, {
                d: ['2020-01', null, {}, true, '', ['2020-02'], 5],
            })
            expect(time.dataDates).toEqual(['2020-01', '1970-01-01T00:00:00Z'])
        })

        test('a dates path whose entries are all unaccepted falls back', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: 'd' },
            }
            const report = applyExtentSource(time, { d: [null, {}] })
            expect(time.dataDates).toEqual(['2000-01-01'])
            expect(report.applied).toEqual([])
            expect(report.skipped).toHaveLength(1)
        })

        test('a blank path leaves its field alone and is not reported', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: 'start', endPath: '  ' },
            }
            const report = applyExtentSource(time, { start: '2020-01-01' })
            expect(time.dataStartTime).toBe('2020-01-01')
            expect(time.dataEndTime).toBe('now')
            expect(time.interval).toBe('P1D')
            expect(report.applied).toEqual(['dataStartTime'])
            expect(report.skipped).toEqual([])
        })

        test.each([
            ['matches nothing', { nope: 1 }, 'start'],
            ['is invalid', { start: '2020' }, '$..start'],
            ['yields null', { start: null }, 'start'],
            ['yields an object', { start: {} }, 'start'],
            ['yields a boolean', { start: true }, 'start'],
            ['yields an empty string', { start: '' }, 'start'],
            ['yields an array', { start: ['2020'] }, 'start'],
            ['yields a non-finite number', { start: Infinity }, 'start'],
        ])('start path that %s falls back and is reported', (_, json, path) => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: path },
            }
            const report = applyExtentSource(time, json)
            expect(time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(report.applied).toEqual([])
            expect(report.skipped).toHaveLength(1)
            expect(report.skipped[0]).toContain(path)
        })

        test('an interval must be a string', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', intervalPath: 'i' },
            }
            const report = applyExtentSource(time, { i: 7 })
            expect(time.interval).toBe('P1D')
            expect(report.skipped).toHaveLength(1)
        })

        test('a [*] over nested arrays is not accepted for start', () => {
            const time = {
                ...staticTime(),
                extentSource: {
                    url: 'x',
                    startPath: 'extent.temporal.interval[*]',
                },
            }
            applyExtentSource(time, STAC)
            expect(time.dataStartTime).toBe('2000-01-01T00:00:00Z')
        })

        test.each([[null], ['text'], [42], [undefined]])(
            'a non-object response %s applies nothing',
            (json) => {
                const time = {
                    ...staticTime(),
                    extentSource: { url: 'x', startPath: 'start' },
                }
                const report = applyExtentSource(time, json)
                expect(time).toMatchObject(staticTime())
                expect(report.applied).toEqual([])
                expect(report.skipped).toHaveLength(1)
            }
        )

        test('an array root cannot be addressed: the grammar needs a key first', () => {
            const time = {
                ...staticTime(),
                extentSource: { url: 'x', datesPath: '[*].d' },
            }
            const report = applyExtentSource(time, [{ d: '2020-01' }])
            expect(report.applied).toEqual([])
            const time2 = {
                ...staticTime(),
                extentSource: { url: 'x', startPath: '$[0].d' },
            }
            applyExtentSource(time2, [{ d: '2020-01' }])
            expect(time2.dataStartTime).toBe('2000-01-01T00:00:00Z')
        })

        test('no extentSource applies nothing and reports nothing', () => {
            const time = staticTime()
            const report = applyExtentSource(time, STAC)
            expect(time).toEqual(staticTime())
            expect(report).toEqual({ applied: [], skipped: [] })
        })
    })
```

Note on the array-root test: the grammar rejects a leading `[`, both bare and after `$`, so an array response can never be read. That is the spec's grammar; the test pins it so a future loosening is deliberate. The spec's merge rule still names "a JSON object or array" as a valid root so that an array response is not reported as a non-JSON response; it simply yields nothing for every path.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layerExtentSource.spec.js`
Expected: FAIL, `applyExtentSource` is not exported.

- [ ] **Step 3: Write normalization and merge**

Append to `src/essence/Basics/TimeControl_/layerExtentSource.ts`:

```ts
export interface ExtentSource {
    url?: string | null
    startPath?: string | null
    endPath?: string | null
    intervalPath?: string | null
    datesPath?: string | null
}

export interface LayerTime {
    enabled?: boolean
    dataStartTime?: string | null
    dataEndTime?: string | null
    interval?: string | null
    dataDates?: string[] | string | null
    extentSource?: ExtentSource | null
    [key: string]: unknown
}

export interface ApplyReport {
    /** Fields overwritten from the source. */
    applied: string[]
    /** One reason per configured field left at its static value. */
    skipped: string[]
}

type Field = 'dataStartTime' | 'dataEndTime' | 'interval' | 'dataDates'

const PATH_FOR: Record<Field, keyof ExtentSource> = {
    dataStartTime: 'startPath',
    dataEndTime: 'endPath',
    interval: 'intervalPath',
    dataDates: 'datesPath',
}

const isNonEmptyString = (v: unknown): v is string =>
    typeof v === 'string' && v !== ''

// Seconds are the finest the static fields carry, so the fraction is dropped.
function epochToIso(ms: number): string | null {
    const date = new Date(ms)
    if (isNaN(date.getTime())) return null
    return date.toISOString().split('.')[0] + 'Z'
}

/**
 * A single time value in the form the static start/end fields hold: a
 * string exactly as written — the existing readers already accept ISO
 * datetimes, partial dates and `now` policies — or a finite number read as
 * epoch milliseconds. Anything else is null.
 */
function normalizeTimeValue(v: unknown): string | null {
    if (isNonEmptyString(v)) return v
    if (typeof v === 'number' && Number.isFinite(v)) return epochToIso(v)
    return null
}

function normalizeInterval(v: unknown): string | null {
    return isNonEmptyString(v) ? v : null
}

/**
 * The dates list: an array keeps its string and finite-number entries and
 * drops the rest; a lone scalar is a one-entry list. Null when nothing
 * usable remains.
 */
function normalizeDates(v: unknown): string[] | null {
    const raw = Array.isArray(v) ? v : [v]
    const dates = raw
        .map((entry) => normalizeTimeValue(entry))
        .filter((d): d is string => d != null)
    return dates.length > 0 ? dates : null
}

const NORMALIZE: Record<Field, (v: unknown) => string | string[] | null> = {
    dataStartTime: normalizeTimeValue,
    dataEndTime: normalizeTimeValue,
    interval: normalizeInterval,
    dataDates: normalizeDates,
}

/**
 * Overwrites each of the four static data-time fields on `time` whose
 * configured path yields an accepted value in `json`. A blank path is not
 * configured and is silently left alone. A configured path that is invalid,
 * matches nothing or yields an unaccepted value leaves its field at the
 * static value and is reported in `skipped` so the caller can warn once.
 */
export function applyExtentSource(time: LayerTime, json: unknown): ApplyReport {
    const report: ApplyReport = { applied: [], skipped: [] }
    const source = time?.extentSource
    if (source == null) return report

    const configured = (Object.keys(PATH_FOR) as Field[]).filter((field) =>
        isNonEmptyString(String(source[PATH_FOR[field]] ?? '').trim())
    )
    if (configured.length === 0) return report

    if (json == null || typeof json !== 'object') {
        report.skipped.push(
            `response is not a JSON object or array, so no field was applied`
        )
        return report
    }

    configured.forEach((field) => {
        const path = String(source[PATH_FOR[field]]).trim()
        const found = readPath(json, path)
        if (found === undefined) {
            report.skipped.push(
                `${field}: path "${path}" is invalid or matched nothing`
            )
            return
        }
        const value = NORMALIZE[field](found)
        if (value == null) {
            report.skipped.push(
                `${field}: path "${path}" yielded a value that is not usable as a ${field}`
            )
            return
        }
        // The four fields have different declared types, so a write through
        // the union key goes via the index signature.
        ;(time as Record<string, unknown>)[field] = value
        report.applied.push(field)
    })
    return report
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layerExtentSource.spec.js`
Expected: PASS.

If the `unaccepted date entries are dropped` case fails on `5` → `'1970-01-01T00:00:00Z'`: `5` ms is epoch + 5 ms, whose seconds render as `1970-01-01T00:00:00Z`. That is the intended result.

- [ ] **Step 5: Commit**

```bash
git add src/essence/Basics/TimeControl_/layerExtentSource.ts tests/unit/layerExtentSource.spec.js
git commit -m "Merge a fetched time extent onto a layer's static time fields"
```

---

### Task 3: The fetch

**Files:**
- Modify: `src/essence/Basics/TimeControl_/layerExtentSource.ts`
- Test: `tests/unit/layerExtentSource.spec.js`

**Interfaces:**
- Consumes: `applyExtentSource` from Task 2.
- Produces: `fetchLayerExtentSource(layer, { timeoutMs, fetchImpl })` resolving to `ApplyReport | null`, never rejecting. Task 4 calls it from the loader with no options.

- [ ] **Step 1: Write the failing tests**

Extend the import and append to the outer `describe`:

```js
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
    readPath,
    applyExtentSource,
    fetchLayerExtentSource,
} from '../../src/essence/Basics/TimeControl_/layerExtentSource'
```

```js
    describe('fetchLayerExtentSource', () => {
        const jsonResponse = (body, status = 200) => ({
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
        })
        const layerWith = (extentSource, rest = {}) => ({
            name: 'uuid-1',
            display_name: 'CO2 Monthly',
            time: {
                enabled: true,
                dataStartTime: '2000-01-01T00:00:00Z',
                dataEndTime: 'now',
                extentSource,
                ...rest,
            },
        })

        afterEach(() => {
            vi.restoreAllMocks()
        })

        test('a successful fetch applies the mapped values', async () => {
            const fetchImpl = vi.fn(async () =>
                jsonResponse({ start: '2020-01-01', end: '2021-01-01' })
            )
            const layer = layerWith({
                url: 'https://api.example/extent',
                startPath: 'start',
                endPath: 'end',
            })
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(fetchImpl).toHaveBeenCalledTimes(1)
            expect(fetchImpl.mock.calls[0][0]).toBe('https://api.example/extent')
            expect(layer.time.dataStartTime).toBe('2020-01-01')
            expect(layer.time.dataEndTime).toBe('2021-01-01')
            expect(report.applied.sort()).toEqual(['dataEndTime', 'dataStartTime'])
        })

        test('a partial result warns once and keeps the rest static', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(async () => jsonResponse({ start: '2020' }))
            const layer = layerWith({
                url: 'u',
                startPath: 'start',
                endPath: 'missing',
            })
            await fetchLayerExtentSource(layer, { fetchImpl })
            expect(layer.time.dataStartTime).toBe('2020')
            expect(layer.time.dataEndTime).toBe('now')
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('CO2 Monthly')
            expect(warn.mock.calls[0][0]).toContain('missing')
        })

        test('a fully applied result does not warn', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(async () => jsonResponse({ start: '2020' }))
            await fetchLayerExtentSource(
                layerWith({ url: 'u', startPath: 'start' }),
                { fetchImpl }
            )
            expect(warn).not.toHaveBeenCalled()
        })

        test.each([
            ['a network error', vi.fn(async () => { throw new TypeError('Failed to fetch') })],
            ['a non-2xx status', vi.fn(async () => jsonResponse({ start: '2020' }, 404))],
            [
                'a non-JSON body',
                vi.fn(async () => ({
                    ok: true,
                    status: 200,
                    json: async () => { throw new SyntaxError('Unexpected token') },
                })),
            ],
        ])('%s applies nothing, warns once and resolves null', async (_, fetchImpl) => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const layer = layerWith({ url: 'u', startPath: 'start' })
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(report).toBeNull()
            expect(layer.time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toContain('CO2 Monthly')
        })

        test('a timeout aborts the request, applies nothing and resolves null', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(
                (_url, init) =>
                    new Promise((_, reject) => {
                        init.signal.addEventListener('abort', () =>
                            reject(new DOMException('Aborted', 'AbortError'))
                        )
                    })
            )
            const layer = layerWith({ url: 'u', startPath: 'start' })
            const report = await fetchLayerExtentSource(layer, {
                fetchImpl,
                timeoutMs: 5,
            })
            expect(report).toBeNull()
            expect(layer.time.dataStartTime).toBe('2000-01-01T00:00:00Z')
            expect(warn).toHaveBeenCalledTimes(1)
            expect(warn.mock.calls[0][0]).toMatch(/timed out/)
        })

        test.each([
            ['no time block', { name: 'a', display_name: 'A' }],
            ['time disabled', layerWith({ url: 'u', startPath: 's' }, { enabled: false })],
            ['no extentSource', layerWith(undefined)],
            ['blank url', layerWith({ url: '   ', startPath: 's' })],
        ])('%s fetches nothing and resolves null', async (_, layer) => {
            const fetchImpl = vi.fn()
            const report = await fetchLayerExtentSource(layer, { fetchImpl })
            expect(report).toBeNull()
            expect(fetchImpl).not.toHaveBeenCalled()
        })

        test('falls back to the layer name when there is no display name', async () => {
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
            const fetchImpl = vi.fn(async () => jsonResponse({}, 500))
            const layer = layerWith({ url: 'u', startPath: 's' })
            delete layer.display_name
            await fetchLayerExtentSource(layer, { fetchImpl })
            expect(warn.mock.calls[0][0]).toContain('uuid-1')
        })
    })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layerExtentSource.spec.js`
Expected: FAIL, `fetchLayerExtentSource` is not exported.

- [ ] **Step 3: Write the fetch**

Append to `src/essence/Basics/TimeControl_/layerExtentSource.ts`:

```ts
export interface ExtentSourceLayer {
    name?: string
    display_name?: string
    time?: LayerTime | null
}

const DEFAULT_TIMEOUT_MS = 10000

function labelOf(layer: ExtentSourceLayer): string {
    return layer.display_name || layer.name || '(unnamed layer)'
}

/**
 * Fetches a layer's configured extent source and merges the result onto its
 * `time` block. Resolves to the merge report, or null when the layer has no
 * enabled time block, no source URL, or the fetch failed — a network error,
 * a non-2xx status, a non-JSON body or the timeout elapsing. Every failure,
 * and every configured field the response could not supply, is reported in
 * one console warning naming the layer. Never rejects: a broken source may
 * cost the layer its fetched extent, never its place on the map.
 *
 * `fetchImpl` and `timeoutMs` are injectable for tests.
 */
export async function fetchLayerExtentSource(
    layer: ExtentSourceLayer,
    options: { timeoutMs?: number; fetchImpl?: typeof fetch } = {}
): Promise<ApplyReport | null> {
    const time = layer?.time
    if (time == null || time.enabled !== true) return null
    const url = String(time.extentSource?.url ?? '').trim()
    if (url === '') return null

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const fetchImpl = options.fetchImpl ?? fetch
    const label = labelOf(layer)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let json: unknown
    try {
        const response = await fetchImpl(url, { signal: controller.signal })
        if (!response.ok) {
            console.warn(
                `[Layers] ${label}: time extent source ${url} responded ${response.status}; using the configured data times.`
            )
            return null
        }
        json = await response.json()
    } catch (err) {
        const reason =
            controller.signal.aborted
                ? `timed out after ${timeoutMs} ms`
                : `could not be fetched or parsed as JSON (${
                      (err as Error)?.message ?? err
                  })`
        console.warn(
            `[Layers] ${label}: time extent source ${url} ${reason}; using the configured data times.`
        )
        return null
    } finally {
        clearTimeout(timer)
    }

    const report = applyExtentSource(time, json)
    if (report.skipped.length > 0) {
        console.warn(
            `[Layers] ${label}: time extent source ${url} left these at their configured values:\n  ` +
                report.skipped.join('\n  ')
        )
    }
    return report
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layerExtentSource.spec.js`
Expected: PASS.

If the timeout test hangs: confirm `fetchImpl` receives `init.signal` as the second argument and the implementation passes `{ signal: controller.signal }`.

- [ ] **Step 5: Run the whole unit suite**

Run: `npm run test:unit`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/essence/Basics/TimeControl_/layerExtentSource.ts tests/unit/layerExtentSource.spec.js
git commit -m "Fetch a layer's time extent source with a timeout and fallback"
```

---

### Task 4: Loader hook in Layers_

**Files:**
- Modify: `src/essence/Basics/Layers_/Layers_.js` — the import block near line 12, and `parseConfig`'s `expandLayers` walk near lines 4510-4560.

**Interfaces:**
- Consumes: `fetchLayerExtentSource(layer)` from Task 3, called with no options.
- Produces: nothing new. After this task every reader of `layer.time.dataStartTime` / `dataEndTime` / `interval` / `dataDates` sees fetched values on first read.

This task has no unit test: `Layers_.js` imports browser-coupled modules and is not exercised under vitest. Verification is the manual smoke test in Steps 5 to 7.

- [ ] **Step 1: Import the fetch**

In `src/essence/Basics/Layers_/Layers_.js`, directly after the line

```js
import { resolveTemporalExtent } from '../TimeControl_/layerTimePolicy'
```

add:

```js
import { fetchLayerExtentSource } from '../TimeControl_/layerExtentSource'
```

- [ ] **Step 2: Start fetches during the walk and await them after it**

Find, inside `async function parseConfig(...)`:

```js
    //We only care about the layers now
    const layers = L_.configData.layers

    //Begin recursively going through those layers
    await expandLayers(layers, 0, null)

    async function expandLayers(d, level, prevName) {
```

Replace with:

```js
    //We only care about the layers now
    const layers = L_.configData.layers

    // A layer whose time extent comes from a URL is fetched while the walk
    // below continues, and every fetch is awaited before this returns: the
    // readers of a layer's data times — the coverage gate, the temporal
    // extent provider, the timeline — first run after parseConfig resolves,
    // so awaiting here is what lets them read the fetched values with no
    // knowledge of the source. Started here rather than awaited per layer so
    // a mission with many sources waits for the slowest, not their sum.
    const extentSourceFetches = []

    //Begin recursively going through those layers
    await expandLayers(layers, 0, null)
    await Promise.all(extentSourceFetches)

    async function expandLayers(d, level, prevName) {
```

Then find, inside the loop body of `expandLayers`:

```js
            // Create parsed layers named
            L_.layers.data[d[i].name] = d[i]
```

and directly after it add:

```js
            // The fetch writes into this same object, so the registered
            // layer carries the fetched data times once it resolves.
            // fetchLayerExtentSource resolves null, never rejects, for a
            // layer with no source or a failed fetch.
            extentSourceFetches.push(fetchLayerExtentSource(d[i]))
```

- [ ] **Step 3: Await the sublayer recursion**

Near the end of the `expandLayers` loop body, find:

```js
            //If they are sublayers, call this function again and move up a level
            if (dNext != 0) {
                expandLayers(dNext, level + 1, d[i].name)
            }
```

and change the call to:

```js
            //If they are sublayers, call this function again and move up a level
            if (dNext != 0) {
                await expandLayers(dNext, level + 1, d[i].name)
            }
```

> ⚠️ Gotcha: without this `await`, a sublayer tree containing a vector STAC layer (whose prefetch is awaited inside the recursive call) finishes registering, and pushing its fetches, after the outer `await expandLayers(...)` has already returned, so `Promise.all(extentSourceFetches)` would miss them. The same latent race already lets such sublayers register after `parseConfig` resolves; awaiting the recursion closes both. Sublayers with no STAC prefetch run synchronously and were never affected.

- [ ] **Step 4: Confirm the app still builds under the dev server**

Follow the `mmgis-deployment` skill to boot the local dev instance if it is not already running (hot reload picks up the change; do not run `npm run build`). Open the mission and confirm the console shows no new errors and layers load as before.

- [ ] **Step 5: Smoke test the happy path**

Create `public/extent-smoke.json` (a temporary file, not committed):

```json
{
    "extent": { "temporal": { "interval": [["2024-01-01T00:00:00Z", "2024-06-30T23:59:59Z"]] } },
    "summaries": { "datetime": ["2024-01", "2024-03", "2024-06"], "cadence": "P1M" }
}
```

In the Configure page, pick any tile layer in the local test mission that has Time enabled (or enable Time on one for the duration of the test) and set, in Data Time Extent, the static Data Start Time to `2000-01-01T00:00:00Z` and Data End Time to `2000-12-31T23:59:59Z` so the override is unmistakable. Then set the runtime fields (added in Task 5; if Task 5 is not yet done, edit the layer's raw JSON in the Configure page to add `"time": { ..., "extentSource": { "url": "/public/extent-smoke.json", "startPath": "extent.temporal.interval[0][0]", "endPath": "extent.temporal.interval[0][1]", "intervalPath": "summaries.cadence", "datesPath": "summaries.datetime[*]" } }`). Save.

Reload the mission with the layer on and check:

- The Timeline row for the layer shows stops at Jan, Mar and Jun 2024, not the year 2000.
- With the timeline window in 2000, the layer issues no tile requests (Network tab) and the Layers tool shows its out-of-coverage icon; moving the window to March 2024 restores requests.
- The console has no warning for the layer.

- [ ] **Step 6: Smoke test the fallback**

Change the URL to `/public/does-not-exist.json`, save, reload. Check:

- Exactly one console warning names the layer and says the source responded 404.
- The layer's static year-2000 extent is in effect on the Timeline and the gate.
- The layer still loads and renders when the window is in 2000.

Change the URL back to the smoke file and `startPath` to `nothing.here`. Reload. Check exactly one warning listing `dataStartTime` and that only the start stayed at 2000 while end, interval and dates came from the file.

- [ ] **Step 7: Clean up the smoke rig**

Delete `public/extent-smoke.json` and restore the test layer's config to what it was. Confirm `git status` shows only `Layers_.js` changed.

- [ ] **Step 8: Commit**

```bash
git add src/essence/Basics/Layers_/Layers_.js
git commit -m "Read a layer's time extent from its configured source while layers load"
```

---

### Task 5: Configure page fields

**Files:**
- Modify: `configure/src/metaconfigs/layer-tile-config.json` (Data Time Extent subsection, near lines 476-507)
- Modify: `configure/src/metaconfigs/layer-vector-config.json` (near lines 506-537)
- Modify: `configure/src/metaconfigs/layer-vectortile-config.json` (near lines 459-484)
- Modify: `configure/src/metaconfigs/layer-query-config.json` (near lines 541-566)
- Modify: `configure/src/metaconfigs/layer-velocity-config.json` (near lines 367-392)

**Interfaces:**
- Produces: config keys `time.extentSource.url`, `time.extentSource.startPath`, `time.extentSource.endPath`, `time.extentSource.intervalPath`, `time.extentSource.datesPath`, which Task 3's `fetchLayerExtentSource` reads. Dotted `field` values in these metaconfigs already map to nested config keys (`time.dataStartTime` does today), so no Configure code changes.

Tile and vector already carry all four static fields (start, end, interval, dates). Vector tile, query and velocity carry start, end and dates but no interval field. The Interval Path field is still added to all five: the core resolvers read `time.interval` for every layer type, so a fetched interval takes effect regardless of whether a static one can be typed. Adding a static interval field to those three types is out of scope here.

- [ ] **Step 1: Add the five fields to every file**

In each of the five files, inside the `"components"` array of the subsection whose `"subname"` is `"Data Time Extent"`, after the object whose `"field"` is `"time.dataDates"` (the last component), append these five objects:

```json
            {
              "field": "time.extentSource.url",
              "name": "Time Extent URL",
              "description": "Optional. A URL returning JSON that describes when this layer has data, such as a STAC collection. Fetched once when the mission loads, with a 10 second timeout. Each path below that finds a value replaces the matching field above; anything the response cannot supply keeps the value typed above. If the request fails the layer uses the values above and logs a warning. Leave empty to use only the values above.",
              "type": "text",
              "width": 12
            },
            {
              "field": "time.extentSource.startPath",
              "name": "Start Path",
              "description": "Where in the response the earliest data time is, as a dotted path with [n] for an array position and [*] for every element, e.g. extent.temporal.interval[0][0]. Accepts an ISO 8601 datetime or a number of milliseconds since 1970. Leave empty to keep Data Start Time.",
              "type": "text",
              "width": 3
            },
            {
              "field": "time.extentSource.endPath",
              "name": "End Path",
              "description": "Where in the response the latest data time is, e.g. extent.temporal.interval[0][1]. Accepts an ISO 8601 datetime or a number of milliseconds since 1970. Leave empty to keep Data End Time.",
              "type": "text",
              "width": 3
            },
            {
              "field": "time.extentSource.intervalPath",
              "name": "Interval Path",
              "description": "Where in the response the data cadence is, as an ISO 8601 duration such as P1D or P1M, e.g. summaries.cadence. Leave empty to keep Data Time Interval.",
              "type": "text",
              "width": 3
            },
            {
              "field": "time.extentSource.datesPath",
              "name": "Data Dates Path",
              "description": "Where in the response the list of times with data is, e.g. summaries.datetime[*] or features[*].properties.datetime. Each entry is an ISO 8601 date or datetime, or milliseconds since 1970. Leave empty to keep Data Dates.",
              "type": "text",
              "width": 3
            }
```

Mind the comma after the preceding `time.dataDates` object.

- [ ] **Step 2: Add the fallback sentence to the existing fields**

In each of the five files, append this sentence to the end of the `"description"` of `time.dataStartTime`, `time.dataEndTime`, `time.dataDates`, and (tile and vector only) `time.interval`:

```
 When a Time Extent URL is set below and its path finds a value, that value is used instead and this one is the fallback.
```

- [ ] **Step 3: Validate the JSON**

Run:

```bash
for f in tile vector vectortile query velocity; do node -e "JSON.parse(require('fs').readFileSync('configure/src/metaconfigs/layer-$f-config.json','utf8')); console.log('$f ok')"; done
```

Expected: five `ok` lines.

- [ ] **Step 4: Check the fields render**

With the dev server running, open the Configure page, edit a tile layer, expand Time, and confirm the Data Time Extent section shows the five new fields with their descriptions, and that saving with values set writes `time.extentSource` into the layer JSON (inspect the raw layer JSON in the Configure page).

- [ ] **Step 5: Commit**

```bash
git add configure/src/metaconfigs/layer-tile-config.json configure/src/metaconfigs/layer-vector-config.json configure/src/metaconfigs/layer-vectortile-config.json configure/src/metaconfigs/layer-query-config.json configure/src/metaconfigs/layer-velocity-config.json
git commit -m "Configure a runtime time extent source per time-enabled layer"
```

---

### Task 6: Final verification

**Files:** none new.

- [ ] **Step 1: Run the full unit suite**

Run: `npm run test:unit`
Expected: PASS.

- [ ] **Step 2: Lint the touched files**

Run: `npx eslint --no-eslintrc -c package.json src/essence/Basics/TimeControl_/layerExtentSource.ts src/essence/Basics/Layers_/Layers_.js tests/unit/layerExtentSource.spec.js`
Expected: no errors from the new module or the spec. The repo's eslint config lives under `eslintConfig` in `package.json` and is old (eslint 6); if it cannot parse the `.ts` file, skip the lint of that file and rely on Step 3. Warnings that predate this branch in `Layers_.js` are not this task's to fix.

- [ ] **Step 3: Type-check the new module**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep layerExtentSource || echo "no type errors in layerExtentSource"`
Expected: the `no type errors` line.

- [ ] **Step 4: Re-run the happy-path smoke test from Task 4 once, end to end, through the Configure fields from Task 5**

Set the five fields in the Configure page rather than raw JSON, save, reload, confirm the Timeline and gate use the fetched extent, then restore the layer and delete the smoke file.

- [ ] **Step 5: Review the branch**

Run: `git log --oneline development..HEAD` and `git diff development --stat`
Expected: the spec commit plus five implementation commits; only the files in the file map changed (plus the spec and this plan).

Then use the `superpowers:finishing-a-development-branch` skill to decide how to integrate. The PR description should reference issue #430 and the spec.
