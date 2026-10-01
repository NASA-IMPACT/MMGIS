/**
 * A layer's naming property, as configured under Interface, split into the
 * property to read off the feature and the label to show beside its value.
 */
export interface NamingProperty {
    /** Property path on the feature. Dot notation reaches nested values. */
    prop: string
    /** What to display. The property path itself when no label is given. */
    label: string
}

/**
 * Parses one configured naming property.
 *
 * An entry is a property path on its own, or a path and a display label
 * separated by a pipe: `density_rank|Density Rank`. Only the first pipe
 * separates, so a label may contain further ones. A label left empty falls
 * back to the property path, which is what an entry with no pipe shows.
 */
export const parseNamingProperty = (entry: string): NamingProperty => {
    if (typeof entry !== 'string') return { prop: '', label: '' }

    const separator = entry.indexOf('|')
    if (separator === -1) {
        const prop = entry.trim()
        return { prop, label: prop }
    }

    const prop = entry.slice(0, separator).trim()
    const label = entry.slice(separator + 1).trim()
    return { prop, label: label || prop }
}

/**
 * Parses a layer's whole naming configuration, `variables.useKeyAsName`.
 *
 * It may be a single entry or a list. Entries that name no property are
 * dropped: the Configure page saves a partly filled Property list with null
 * holes, and a blank or label-only entry has nothing to read off a feature.
 */
export const parseNamingProperties = (
    configured: string | Array<string | null | undefined> | null | undefined,
): NamingProperty[] => {
    const entries = Array.isArray(configured) ? configured : [configured]
    return entries
        .map((entry) => parseNamingProperty(entry as string))
        .filter((p) => p.prop !== '')
}
