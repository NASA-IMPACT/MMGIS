import { useEffect, useState } from 'react'
import { mmgisRequest } from './mmgisAPI'

export const useMMGISToolVars = <
    T extends Record<string, unknown> = Record<string, unknown>,
>(
    toolName: string,
): T => {
    const [vars, setVars] = useState<T>({} as T)
    useEffect(() => {
        let cancelled = false
        let attempts = 0
        const MAX = 20 // retry while Layers_.fina() registers the handler (~6s)

        const tryFetch = () => {
            if (cancelled || attempts >= MAX) return
            attempts++
            mmgisRequest<T>('tool:getVars', toolName)
                .then((result) => {
                    if (cancelled) return
                    // __noVars (or null) → handler not ready / no saved vars; retry.
                    if (!result || (result as Record<string, unknown>).__noVars) {
                        setTimeout(tryFetch, 300)
                        return
                    }
                    setVars(result)
                })
                .catch((err) => {
                    if (!cancelled) {
                        console.warn(`[useMMGISToolVars] '${toolName}' vars unavailable:`, err)
                        setTimeout(tryFetch, 300)
                    }
                })
        }

        tryFetch()
        return () => {
            cancelled = true
        }
    }, [toolName])
    return vars
}
