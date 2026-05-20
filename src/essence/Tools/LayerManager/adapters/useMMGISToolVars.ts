import { useEffect, useState } from 'react'
import { mmgisRequest } from './mmgisAPI'

export const useMMGISToolVars = <T extends Record<string, unknown> = Record<string, unknown>>(
    toolName: string,
): T => {
    const [vars, setVars] = useState<T>({} as T)
    useEffect(() => {
        let cancelled = false
        mmgisRequest<T>('tool:getVars', toolName)
            .then((result) => {
                if (!cancelled && result) setVars(result)
            })
            .catch((err) => {
                // The 'tool:getVars' handler is registered by Layers_.fina() during
                // mission load. If the adapter mounts before that runs (e.g. tool
                // appears in a modern-layout panel that renders before the mission
                // finishes loading), the request rejects. Treat as 'no vars yet';
                // the component will use its prop defaults.
                if (!cancelled) {
                    console.warn(
                        `[useMMGISToolVars] '${toolName}' vars unavailable:`,
                        err instanceof Error ? err.message : err,
                    )
                }
            })
        return () => {
            cancelled = true
        }
    }, [toolName])
    return vars
}
