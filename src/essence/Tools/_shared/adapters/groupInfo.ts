import type { LayerConfig } from './mmgisAPI'

/** What a group's header shows. */
export type GroupInfo = {
    title: string
    /** Null when the header has no description. */
    description: string | null
    /** Whether the group starts open. */
    expanded: boolean
}

/**
 * What each group's header shows, read from the header layers' configs and
 * keyed by UUID. A header without a display name is titled by its UUID, and
 * a blank description counts as none.
 */
export const getGroupInfo = (
    configs: Record<string, LayerConfig> | null | undefined,
): Record<string, GroupInfo> => {
    const groups: Record<string, GroupInfo> = {}
    for (const [id, config] of Object.entries(configs ?? {})) {
        if (config.type !== 'header') continue
        groups[id] = {
            title: config.display_name || id,
            description: config.description?.trim() ? config.description : null,
            expanded: config.expanded === true,
        }
    }
    return groups
}
