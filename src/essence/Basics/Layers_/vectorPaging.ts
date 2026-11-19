/**
 * Offset pagination for vector sources that cap features per request. The
 * layer's URL carries `{offset}` and `{limit}`; pages are read until one
 * comes back short or `maxPages` is reached.
 */

type Json = Record<string, any>
export type FetchJson = (url: string) => Promise<unknown>
export type Paging = { pageSize: number; maxPages: number }

/** Pages requested at once. */
const PAGE_BATCH = 4
const DEFAULT_MAX_PAGES = 50

function positiveInt(value: unknown): number | null {
    const n = Number(value)
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : null
}

/** The layer's `variables.pagination`, or null when paging is off. */
export function getPaging(layerData: unknown): Paging | null {
    const p = (layerData as Json | null)?.variables?.pagination
    const pageSize = positiveInt(p?.pageSize)
    if (pageSize == null) return null
    return { pageSize, maxPages: positiveInt(p?.maxPages) ?? DEFAULT_MAX_PAGES }
}

/**
 * GETs and parses JSON. Rejects with the response's `status` on HTTP and
 * parse errors; network and CORS failures carry none.
 */
export const fetchJson: FetchJson = async (url) => {
    const resp = await fetch(url)
    const fail = (err: Error) => Object.assign(err, { status: resp.status })
    if (!resp.ok) throw fail(new Error(`HTTP ${resp.status}`))
    return resp.json().catch((err: Error) => {
        throw fail(err)
    })
}

function pageUrl(template: string, page: number, pageSize: number): string {
    return template
        .replace(/{offset}/g, String(page * pageSize))
        .replace(/{limit}/g, String(pageSize))
}

function featuresOf(body: unknown): Json[] {
    const list = (body as Json | null)?.features
    return Array.isArray(list) ? list : []
}

/**
 * The first page's response holding every page's features. `complete` is
 * false when features may remain unread; a failed first page rejects.
 */
export async function fetchAllPages(
    template: string,
    { pageSize, maxPages }: Paging,
    get: FetchJson = fetchJson
): Promise<{ data: Json; complete: boolean }> {
    const first = (await get(pageUrl(template, 0, pageSize))) as Json
    const features = [...featuresOf(first)]
    let complete = features.length < pageSize

    // Without {offset} every page would be the same request; without {limit}
    // the server picks its own page size and pages overlap.
    if (template.includes('{offset}') && template.includes('{limit}')) {
        let page = 1
        let failed = false
        while (!complete && !failed && page < maxPages) {
            const batch: Promise<unknown>[] = []
            for (let i = 0; i < PAGE_BATCH && page + i < maxPages; i++)
                batch.push(get(pageUrl(template, page + i, pageSize)))
            for (const r of await Promise.allSettled(batch)) {
                if (r.status === 'rejected') {
                    failed = true
                    break
                }
                const list = featuresOf(r.value)
                features.push(...list)
                page++
                if (list.length < pageSize) {
                    complete = true
                    break
                }
            }
        }
    }

    return { data: { ...first, features }, complete }
}
