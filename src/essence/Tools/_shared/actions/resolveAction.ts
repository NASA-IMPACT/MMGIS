import {
    mmgisEmit,
    mmgisHasHandler,
    mmgisHidePanel,
    mmgisHidePlugin,
    mmgisShowPanel,
    mmgisShowPlugin,
    PANEL_PLUGIN_BUS,
    type CommandResult,
} from '../adapters/mmgisAPI'

/**
 * Core actions expressible as a config string, mapped to the client wrapper
 * that runs them. Only single-target verbs qualify: a request taking two
 * arguments would need escaping rules a colon-delimited string cannot carry.
 */
export const CORE_ACTIONS: Record<string, (target: string) => Promise<CommandResult>> = {
    [PANEL_PLUGIN_BUS.showPanel]: mmgisShowPanel,
    [PANEL_PLUGIN_BUS.hidePanel]: mmgisHidePanel,
    [PANEL_PLUGIN_BUS.showPlugin]: mmgisShowPlugin,
    [PANEL_PLUGIN_BUS.hidePlugin]: mmgisHidePlugin,
}

/**
 * Namespaces core owns. A string opening with one of these is always meant as
 * a core action — an unrecognised verb or a missing target under one of these
 * is a mistake worth reporting, not a signal to fall back to a plain event.
 *
 * 'core' itself carries no verbs in CORE_ACTIONS, so anything under it always
 * falls into the warn path below. It's reserved anyway because it's the
 * namespace older mission configs use (e.g. `core:showPlugin:<id>`) — those
 * verbs have no expressible successor here (`core:togglePanel` was dropped
 * outright, `core:unloadPlugin` needs a state argument a config string can't
 * carry), so the goal is a loud warning pointing at the supported actions,
 * not a silent no-op event nothing listens for.
 */
const CORE_NAMESPACES = new Set(['core', 'panels', 'plugins'])

/**
 * Run an action written as a configuration string.
 *
 * Forms, in precedence order:
 *   'https://…'            → opens in a new tab
 *   'panels:hide:left'     → mmgisHidePanel('left')
 *   'panels:hide' (no target), or any unrecognised verb under a core
 *                             namespace → reported with console.warn, nothing
 *                             is requested or emitted
 *   'plugin:title:refresh' → emit('plugin:title:refresh')
 *   'refresh'              → emit('refresh'), with a warning — see below
 *
 * Targets may themselves contain colons; everything after the verb is the
 * target. The namespace match is exact — 'Panels:hide:left' is not a core
 * action, so it falls through and is emitted verbatim. A request core
 * refuses is warned with its reason; a core that never registered the handler,
 * or no bus at all, warns 'no handler' rather than surfacing a rejected
 * promise to the caller.
 */
export const resolveAction = async (action?: string): Promise<void> => {
    if (!action) return

    if (/^https?:\/\//.test(action)) {
        window.open(action, '_blank', 'noopener,noreferrer')
        return
    }

    const [namespace, verb, ...rest] = action.split(':')
    const name = `${namespace}:${verb}`
    const run = CORE_ACTIONS[name]

    if (run && rest.length > 0) {
        // Asked rather than inferred from the result: a wrapper reports a
        // core that lacks the handler as `layout-inactive`, which reads to a
        // config author as a layout problem rather than a core too old.
        if (!mmgisHasHandler(name)) {
            console.warn(`[resolveAction] "${action}" refused: no handler`)
            return
        }
        try {
            const result = await run(rest.join(':'))
            // Compared against the discriminant so the branch narrows to the
            // arm carrying a reason.
            if (result.ok === false) {
                console.warn(`[resolveAction] "${action}" refused: ${result.reason}`)
            }
        } catch (err) {
            console.warn(`[resolveAction] "${action}" failed:`, err)
        }
        return
    }

    // A recognised namespace with no usable match here means either a target
    // is missing (the verb is in CORE_ACTIONS but rest is empty) or the verb
    // itself is a typo. Both are config mistakes, not custom events.
    if (CORE_NAMESPACES.has(namespace)) {
        console.warn(
            `[resolveAction] "${action}" is not a usable core action. Supported actions: ${Object.keys(CORE_ACTIONS).join(', ')}.`,
        )
        return
    }

    // A name carrying no namespace is emitted exactly as written, which is
    // what the string asks for but rarely what the author meant: every tool
    // publishes under `plugin:<pluginId>:` — the same declared id the
    // `plugins:` actions above take as their target — so a bare name reaches
    // none of them and lands on a channel nothing subscribes to. Emit it
    // anyway — a bare event name is legal — but say so, because the
    // alternative is a button that looks wired up and does nothing.
    if (!action.includes(':')) {
        console.warn(
            `[resolveAction] "${action}" has no namespace and is emitted verbatim. ` +
                `A tool's own event needs its full name, e.g. "plugin:<pluginId>:${action}".`,
        )
    }

    mmgisEmit(action)
}
