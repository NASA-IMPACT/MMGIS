// Basemap layer groups, from the mission config (`msv.basemap.groups`, set
// in Configure). A group has a name and either the style layer ids it
// toggles, or children that each have them; children go one level deep.
// Only the groups in the config show as checkboxes, and only those with a
// layer in the current basemap style.
//
//   [
//     { "name": "Borders", "children": [
//         { "name": "Countries", "layers": ["admin-0-boundary"] },
//         { "name": "States", "layers": ["admin-1-boundary"] }
//     ] },
//     { "name": "Water", "layers": ["water"] }
//   ]

const isLayerList = (layers) =>
    Array.isArray(layers) && layers.every((id) => typeof id === 'string')

function warn(message) {
    console.warn(`[msv.basemap.groups] ${message}`)
}

const hasName = (entry) => typeof entry?.name === 'string' && entry.name !== ''

/** A child: a name and its layer ids, nothing nested. */
function parseChild(entry, parent) {
    if (!hasName(entry)) {
        warn(`A child of "${parent}" has no name; skipped.`)
        return null
    }
    if (entry.children !== undefined) {
        warn(`"${parent}" > "${entry.name}" has children; groups nest one level only, so it is skipped.`)
        return null
    }
    if (!isLayerList(entry.layers) || entry.layers.length === 0) {
        warn(`"${parent}" > "${entry.name}" lists no layer ids; skipped.`)
        return null
    }
    return {
        id: `${parent}/${entry.name}`,
        name: entry.name,
        layers: [...entry.layers],
    }
}

function parseGroup(entry) {
    if (!hasName(entry)) {
        warn('A group has no name; skipped.')
        return null
    }
    if (entry.children === undefined) {
        if (!isLayerList(entry.layers) || entry.layers.length === 0) {
            warn(`"${entry.name}" lists no layer ids or children; skipped.`)
            return null
        }
        return { id: entry.name, name: entry.name, layers: [...entry.layers] }
    }
    if (entry.layers !== undefined) {
        warn(`"${entry.name}" has both layers and children; its own layers are ignored.`)
    }
    if (!Array.isArray(entry.children)) {
        warn(`"${entry.name}" has children that are not a list; skipped.`)
        return null
    }
    const seen = new Set()
    const children = entry.children
        .map((child) => parseChild(child, entry.name))
        .filter((child) => {
            if (!child) return false
            if (seen.has(child.name)) {
                warn(`"${entry.name}" > "${child.name}" is named twice; the second is skipped.`)
                return false
            }
            seen.add(child.name)
            return true
        })
    if (children.length === 0) {
        warn(`"${entry.name}" has no usable children; skipped.`)
        return null
    }
    return {
        id: entry.name,
        name: entry.name,
        // The parent toggles all of its children's layers.
        layers: [...new Set(children.flatMap((child) => child.layers))],
        children,
    }
}

/**
 * The config value as a list of groups. A group's `id` is its name; a
 * child's is `<parent>/<child>`. Every id is unique: a group whose id an
 * earlier one already uses is skipped, as is a repeated child name.
 * Anything but an array (Configure stores `{}` when unset) gives no groups.
 */
export function parseBasemapGroups(config) {
    if (!Array.isArray(config)) return []
    const seen = new Set()
    return config.map(parseGroup).filter((group) => {
        if (!group) return false
        const ids = [group.id, ...(group.children ?? []).map((c) => c.id)]
        const taken = ids.find((id) => seen.has(id))
        if (taken !== undefined) {
            warn(`"${taken}" is named twice; the second is skipped.`)
            return false
        }
        ids.forEach((id) => seen.add(id))
        return true
    })
}

/** A group or a child, by id; null when none has it. */
export function findBasemapGroup(groups, id) {
    for (const group of groups) {
        if (group.id === id) return group
        const child = group.children?.find((c) => c.id === id)
        if (child) return child
    }
    return null
}

function stateOf(layers, isVisible, hasLayer) {
    const visible = layers.filter(hasLayer).map(isVisible)
    if (visible.length === 0) return null
    if (visible.every(Boolean)) return 'on'
    return visible.some(Boolean) ? 'mixed' : 'off'
}

/**
 * The groups with each one's state ('on' | 'off' | 'mixed'), read from
 * `isVisible(layerId)`, keeping only what the current basemap style has:
 * `hasLayer(layerId)` says whether it does. A mission can list several
 * styles while a group's ids come from one, so a group or child with none
 * of its ids in the style is dropped, and a parent with no child left goes
 * with them. A state counts only the ids the style has; a parent's counts
 * every id of its remaining children, so it is mixed when they differ.
 */
export function basemapGroupStates(groups, isVisible, hasLayer = () => true) {
    return groups
        .map((group) => {
            if (!group.children) {
                const state = stateOf(group.layers, isVisible, hasLayer)
                return state && { id: group.id, name: group.name, state }
            }
            const children = group.children
                .map((child) => {
                    const state = stateOf(child.layers, isVisible, hasLayer)
                    return state && { id: child.id, name: child.name, state }
                })
                .filter(Boolean)
            if (children.length === 0) return null
            const layers = group.children
                .filter((child) => children.some((c) => c.id === child.id))
                .flatMap((child) => child.layers)
            const state = stateOf(layers, isVisible, hasLayer)
            return { id: group.id, name: group.name, state, children }
        })
        .filter(Boolean)
}
