// Reads the rail's selection broadcast.
//
// The rail announces its boot-time default as well as user clicks, because
// the panel no longer derives a default from its own config (the rail owns
// which theme is selected). `initial: true` marks the boot announcement so
// the panel can select the theme without treating it as user interaction —
// which is what keeps boot from narrowing the layers list.

export interface ThemeSelection {
    themeId: string
    /** False only for the rail's boot-time announcement. */
    isInteraction: boolean
}

/** Null for any payload that names no theme — the panel then keeps its
 *  current selection rather than blanking. */
export function interpretThemeSelection(payload: unknown): ThemeSelection | null {
    if (payload == null || typeof payload !== 'object') return null
    const { themeId, initial } = payload as {
        themeId?: unknown
        initial?: unknown
    }
    if (typeof themeId !== 'string' || themeId === '') return null
    return { themeId, isInteraction: initial !== true }
}
