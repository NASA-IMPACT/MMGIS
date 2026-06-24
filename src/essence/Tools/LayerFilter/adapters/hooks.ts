// Small bus hooks, local to this tool (kept self-contained per the monorepo
// tool pattern — no cross-tool imports).
import { useEffect, useState } from 'react'
import { mmgisOn, mmgisRequest } from '../../_shared/adapters/mmgisAPI'

/** Read this tool's configured variables (themes, themeProperty, …). */
export function useMMGISToolVars<T extends Record<string, unknown>>(
    toolName: string,
): T {
    const [vars, setVars] = useState<T>({} as T)
    useEffect(() => {
        let cancelled = false
        mmgisRequest<T>('tool:getVars', toolName)
            .then((result) => {
                if (!cancelled && result) setVars(result)
            })
            .catch(() => {
                // Handler registered during mission load; if we mount first the
                // request rejects — fall back to {} and the UI uses defaults.
            })
        return () => {
            cancelled = true
        }
    }, [toolName])
    return vars
}

/** Subscribe to a bus event for the lifetime of the component. */
export function useMMGISEvent(
    event: string,
    handler: (payload?: unknown) => void,
): void {
    useEffect(() => mmgisOn(event, handler), [event, handler])
}
