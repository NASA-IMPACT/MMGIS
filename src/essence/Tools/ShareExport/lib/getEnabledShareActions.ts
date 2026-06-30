import type { ShareActionKind, ShareFormatFlags } from './types'

/**
 * Returns the ordered list of share actions to render for a given set of
 * enabled formats. The link is always present; PNG and PDF appear only when
 * their toggle is enabled. This is the single source of truth for which
 * buttons the panel shows.
 */
export function getEnabledShareActions(
    formats: ShareFormatFlags,
): ShareActionKind[] {
    const actions: ShareActionKind[] = ['link']
    if (formats.png) actions.push('png')
    if (formats.pdf) actions.push('pdf')
    return actions
}
