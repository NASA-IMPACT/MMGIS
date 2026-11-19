// The share link's slots for plugins. Each plugin has one `p.<pluginId>`
// parameter holding one string of its own. The opening link's values are read
// once at boot and handed out once each; what a plugin pushes afterwards is
// what the next link carries. Core keys (view, time, layers) stay in QueryURL.
//
// Imports nothing, so QueryURL, Layers_ and mmgisAPI can all reach it.

const PARAM_PREFIX = 'p.'
const TOOLS_PARAM = 'tools'
// Per plugin, after encoding. A link is pasted into chats and address bars.
const MAX_ENCODED_LENGTH = 1024

let initial = new Map()
let taken = new Set()
let current = new Map()

const decode = (raw) => {
    try {
        return decodeURIComponent(raw)
    } catch (e) {
        return null
    }
}

// `key=value` pairs as the address bar holds them, split like
// QueryURL.getSingleQueryVariable: '+' is not a space here.
function parsePairs(search) {
    const query = search.startsWith('?') ? search.slice(1) : search
    const pairs = []
    for (const part of query.split('&')) {
        if (!part) continue
        const eq = part.indexOf('=')
        pairs.push(eq === -1 ? [part, ''] : [part.slice(0, eq), part.slice(eq + 1)])
    }
    return pairs
}

const UrlState = {
    /**
     * Reads the opening link. `p.<id>` parameters win; an entry of the older
     * `tools=Id$text,...` form fills a slot the link has no `p.` parameter for,
     * so links copied before plugins had their own parameter still open.
     */
    readInitial(search = window.location.search) {
        initial = new Map()
        taken = new Set()
        const fromTools = new Map()
        for (const [key, raw] of parsePairs(search)) {
            if (key === TOOLS_PARAM) {
                const list = decode(raw)
                if (list == null) continue
                for (const entry of list.split(',')) {
                    const dollar = entry.indexOf('$')
                    if (dollar <= 0) continue
                    const text = entry.slice(dollar + 1)
                    fromTools.set(entry.slice(0, dollar), decode(text) ?? text)
                }
            } else if (key.startsWith(PARAM_PREFIX) && key.length > PARAM_PREFIX.length) {
                const id = decode(key.slice(PARAM_PREFIX.length))
                const value = decode(raw)
                if (id != null && value != null) initial.set(id, value)
            }
        }
        for (const [id, value] of fromTools) if (!initial.has(id)) initial.set(id, value)
    },

    /** The opening link's value for a plugin, the first time it is asked. */
    take(pluginId) {
        if (typeof pluginId !== 'string' || taken.has(pluginId)) return null
        taken.add(pluginId)
        return initial.get(pluginId) ?? null
    },

    /** The opening link's value for a plugin, without using it up. */
    peek(pluginId) {
        return typeof pluginId === 'string' ? (initial.get(pluginId) ?? null) : null
    },

    /** What the next link carries for a plugin; null or '' clears the slot. */
    set(pluginId, value) {
        if (typeof pluginId !== 'string' || pluginId === '') return false
        if (typeof value !== 'string' || value === '') {
            current.delete(pluginId)
            return true
        }
        if (encodeURIComponent(value).length > MAX_ENCODED_LENGTH) {
            console.warn(
                `[UrlState] ${pluginId}: state is over ${MAX_ENCODED_LENGTH} characters encoded; the link leaves it out`
            )
            current.delete(pluginId)
            return false
        }
        current.set(pluginId, value)
        return true
    },

    /** The plugin parameters for a share link, each value encoded, '&'-led. */
    toQuery() {
        let query = ''
        for (const [id, value] of current)
            query += `&${PARAM_PREFIX}${encodeURIComponent(id)}=${encodeURIComponent(value)}`
        return query
    },

    _reset() {
        initial = new Map()
        taken = new Set()
        current = new Map()
    },
}

export default UrlState
