/**
 * A layer's model runs: the list a service publishes of when a model ran,
 * one of which the layer is pinned to. Fetched once while the mission's
 * layers load, beside the time extent source, and held on `layer.time.runs`.
 *
 * Pinning a run derives the layer's `dataStartTime` and `dataEndTime` from
 * the run and the lead range, so every existing reader of those fields, the
 * coverage gate, the Timeline, the temporal extent, follows without knowing
 * about runs. The tile URL's `{reftime}` and `{lead}` are filled from the
 * pin by TimeControl at the same point every other placeholder is.
 *
 * Pure except for the injected `fetch`.
 */
import F_ from '../Formulae_/Formulae_'
import { readPath } from './layerExtentSource'
import { parseISODuration, addDuration, stepsBetween } from './layerTimePolicy'

export const DEFAULT_RUN_STEP = 'PT1H'
export const DEFAULT_RUNS_OFFERED = 10
const DEFAULT_TIMEOUT_MS = 10000

export interface RunSource {
    /** Where the run times are listed, as ISO datetimes. The opt-in. */
    url?: string | null
    /** Dotted path to the list inside the response. Default `data`. */
    path?: string | null
    /** Where the lead indices are listed; first and last bound the window. */
    leadUrl?: string | null
    leadPath?: string | null
    /** One lead unit as an ISO 8601 duration. Default PT1H. */
    step?: string | null
    /** How many newest runs pickers list. Default 10. */
    offer?: number | null
    // Written at runtime, in memory only.
    list?: string[]
    selected?: string | null
    leadRange?: [number, number] | null
}

export interface RunLayerTime {
    enabled?: boolean
    dataStartTime?: string | null
    dataEndTime?: string | null
    runs?: RunSource | null
    end?: string | null
}

export interface RunLayer {
    name?: string
    display_name?: string
    time?: RunLayerTime | null
}

/** A naive ISO datetime, as these services list runs, is UTC. */
export const parseUtc = (value: unknown): Date | null => {
    if (typeof value !== 'string' || value === '') return null
    const iso = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
}

export const toIso = (d: Date): string => d.toISOString().split('.')[0] + 'Z'

/** The newest `n` runs, newest first, out of whatever order the service uses. */
export const newestRuns = (list: unknown, n: number): string[] => {
    if (!Array.isArray(list)) return []
    const runs = list
        .filter((v): v is string => typeof v === 'string' && parseUtc(v) !== null)
        .sort((a, b) => parseUtc(a)!.getTime() - parseUtc(b)!.getTime())
    return runs.slice(Math.max(0, runs.length - n)).reverse()
}

export const leadRangeOf = (list: unknown): [number, number] | null => {
    if (!Array.isArray(list)) return null
    const leads = list.filter((v): v is number => Number.isFinite(v))
    if (leads.length === 0) return null
    return [Math.min(...leads), Math.max(...leads)]
}

// A zero duration ("PT0H", "P0D") parses but cannot count leads, so it falls
// back to the default like an unparseable one.
const stepOf = (runs: RunSource) => {
    const step = parseISODuration(String(runs.step ?? DEFAULT_RUN_STEP).trim())
    const nonZero =
        step != null &&
        (step.years || step.months || step.weeks || step.days ||
            step.hours || step.minutes || step.seconds) > 0
    return nonZero ? step! : parseISODuration(DEFAULT_RUN_STEP)!
}

/**
 * The window a run covers: run + first lead through run + last lead, in
 * whole steps. A run with no lead range covers its own instant. Null when
 * either end falls outside what a Date can hold, as leads listed in a unit
 * far finer than the step (nanoseconds against PT1H) would put it.
 */
export const runWindow = (
    run: string,
    runs: RunSource
): { start: string; end: string } | null => {
    const from = parseUtc(run)
    if (!from) return null
    const step = stepOf(runs)
    const [first, last] = runs.leadRange ?? [0, 0]
    const start = addDuration(from, step, first)
    const end = addDuration(from, step, last)
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null
    return { start: toIso(start), end: toIso(end) }
}

/** Whole steps from the pinned run to `at`, rounded down; null without a pin. */
export const leadAt = (runs: RunSource | null | undefined, at: unknown): number | null => {
    const from = parseUtc(runs?.selected)
    const to = parseUtc(at)
    if (!runs || !from || !to) return null
    return stepsBetween(from, to, stepOf(runs))
}

/**
 * The value a URL placeholder becomes when nothing can fill it. Leaflet's URL
 * template throws on an unfilled key, so a placeholder is never left in place;
 * this marker makes that layer's tile requests fail instead.
 */
export const UNRESOLVED_URL_REPLACEMENT = 'MMGIS_UNRESOLVED'

/**
 * Fills a tile URL's `{reftime}` and `{lead}` from the pinned run: the run
 * itself, and the whole lead steps from it to `at`, the instant being drawn.
 * A value that is missing becomes the unresolved marker. The URL is returned
 * unchanged for a layer with no runs.
 */
export function fillRunPlaceholders(
    url: string,
    runs: RunSource | null | undefined,
    at: unknown
): string {
    if (!runs) return url
    const lead = leadAt(runs, at)
    return url
        .replace(
            /{reftime}/g,
            encodeURIComponent(runs.selected || UNRESOLVED_URL_REPLACEMENT)
        )
        .replace(
            /{lead}/g,
            lead != null ? String(lead) : UNRESOLVED_URL_REPLACEMENT
        )
}

/**
 * Pins `time` to `run`: records the selection and derives the data window
 * from it. False for a run the list does not hold, so a picker cannot pin
 * an instant the service never listed.
 */
export function applyRunSelection(time: RunLayerTime, run: string): boolean {
    const runs = time.runs
    if (!runs || !Array.isArray(runs.list) || !runs.list.includes(run)) return false
    const window = runWindow(run, runs)
    if (!window) return false
    runs.selected = run
    time.dataStartTime = window.start
    time.dataEndTime = window.end
    return true
}

function resolveSourceUrl(url: string, missionPath?: string | null): string {
    if (!missionPath || url.startsWith('/') || F_.isUrlAbsolute(url)) return url
    return missionPath + url
}

const labelOf = (layer: RunLayer): string =>
    layer.display_name || layer.name || '(unnamed layer)'

async function readList(
    url: string,
    path: string,
    label: string,
    what: string,
    options: { timeoutMs: number; fetchImpl: typeof fetch }
): Promise<unknown | null> {
    let controller: AbortController | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
        controller = new AbortController()
        timer = setTimeout(() => controller!.abort(), options.timeoutMs)
        const response = await options.fetchImpl(url, { signal: controller.signal })
        if (!response.ok) {
            console.warn(`[Layers] ${label}: ${what} ${url} responded ${response.status}.`)
            return null
        }
        return readPath(await response.json(), path) ?? null
    } catch (err) {
        const reason = controller?.signal.aborted
            ? `timed out after ${options.timeoutMs} ms`
            : `could not be fetched or parsed as JSON (${(err as Error)?.message ?? err})`
        console.warn(`[Layers] ${label}: ${what} ${url} ${reason}.`)
        return null
    } finally {
        if (timer !== undefined) clearTimeout(timer)
    }
}

/**
 * Reads a layer's runs and leads and pins the newest run. Never rejects: a
 * source that cannot be read leaves the layer as configured, with no runs,
 * and says so once in the console. Nothing for a layer with no `runs.url`.
 * A layer with a lead source whose leads cannot be read is left as it was,
 * rather than pinned to a window of one instant.
 */
export async function fetchLayerRunSource(
    layer: RunLayer,
    options: {
        timeoutMs?: number
        fetchImpl?: typeof fetch
        missionPath?: string | null
    } = {}
): Promise<boolean> {
    const time = layer?.time
    const runs = time?.runs
    if (time == null || time.enabled !== true || runs == null) return false
    const configuredUrl = String(runs.url ?? '').trim()
    if (configuredUrl === '') return false

    const label = labelOf(layer)
    // Wrapped rather than stored: a browser's fetch refuses to run with a
    // `this` other than the window, and a method call on this object would
    // hand it exactly that.
    const fetchImpl: typeof fetch = options.fetchImpl ?? ((input, init) => fetch(input, init))
    const io = {
        timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        fetchImpl,
    }
    const leadUrl = String(runs.leadUrl ?? '').trim()
    const [runList, leadList] = await Promise.all([
        readList(
            resolveSourceUrl(configuredUrl, options.missionPath),
            String(runs.path ?? 'data'),
            label,
            'run source',
            io
        ),
        leadUrl === ''
            ? Promise.resolve(null)
            : readList(
                  resolveSourceUrl(leadUrl, options.missionPath),
                  String(runs.leadPath ?? 'data'),
                  label,
                  'lead source',
                  io
              ),
    ])

    const offer =
        Number.isInteger(runs.offer) && (runs.offer as number) > 0
            ? (runs.offer as number)
            : DEFAULT_RUNS_OFFERED
    const list = newestRuns(runList, offer)
    if (list.length === 0) {
        console.warn(`[Layers] ${label}: run source listed no runs; the layer is not pinned.`)
        return false
    }
    const leadRange = leadRangeOf(leadList)
    if (leadUrl !== '' && leadRange == null) {
        console.warn(`[Layers] ${label}: lead source listed no leads; the layer is not pinned.`)
        return false
    }
    if (runWindow(list[0], { ...runs, leadRange }) == null) {
        console.warn(
            `[Layers] ${label}: leads ${leadRange?.join(' to ')} in steps of ${runs.step ?? DEFAULT_RUN_STEP} give no valid window; the layer is not pinned.`
        )
        return false
    }
    runs.list = list
    runs.leadRange = leadRange
    return applyRunSelection(time, list[0])
}
