/**
 * Fill a `{prop}` template from a bag of properties.
 *
 * MMGIS missions already write headings and links this way — text stands as
 * written, and every `{prop}` is replaced by that property's value, with dot
 * notation reaching a nested one (`{site.name}`). A placeholder naming a
 * property that is absent, null, or itself an object resolves to nothing,
 * which is what lets a caller tell "the template said nothing" from "the
 * template said something".
 *
 * Deliberately duplicates the core formula of the same name rather than
 * importing it: a plugin reaches core only through the event bus, and a bus
 * carries data, not functions. Keeping one copy on the plugin side of that
 * boundary is the cost of the boundary, so it lives here where every plugin
 * shares it rather than in any one of them.
 */
export function fillTemplate(
    template: string,
    properties: Record<string, unknown> | null | undefined
): string {
    if (typeof template !== 'string') return ''
    return template.replace(/\{([^{}]*)\}/g, (_match, path: string) => {
        const value = getIn(properties, path)
        return value == null || typeof value === 'object' ? '' : String(value)
    })
}

/** Read `a.b.c` out of a plain object, without reaching for a core utility. */
export function getIn(source: unknown, path: string): unknown {
    if (source == null || typeof source !== 'object') return undefined
    return path
        .split('.')
        .reduce<unknown>(
            (value, key) =>
                value == null || typeof value !== 'object'
                    ? undefined
                    : (value as Record<string, unknown>)[key],
            source
        )
}
