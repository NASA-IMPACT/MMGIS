import { useCallback, useState } from 'react'
import { mmgisRequest } from './mmgisAPI'
import { useMMGISHandlerReady } from './useMMGISHandlerReady'

/**
 * Read a tool's configured variables over the bus.
 *
 * 'tool:getVars' is registered by Layers_.fina() only after every mission
 * layer finishes loading, while tools mount almost immediately — a single
 * mount-time request always loses that race and the tool silently renders
 * with defaults. So this polls for the handler (useMMGISHandlerReady) and
 * fetches once it exists; failures warn instead of vanishing.
 */
export function useMMGISToolVars<T extends Record<string, unknown>>(
    toolName: string,
): T {
    const [vars, setVars] = useState<T>({} as T)
    const refresh = useCallback(async () => {
        try {
            const result = await mmgisRequest<T>('tool:getVars', toolName)
            if (result) setVars(result)
        } catch (err) {
            console.warn(
                `[useMMGISToolVars] tool:getVars('${toolName}') failed:`,
                err instanceof Error ? err.message : err,
            )
        }
    }, [toolName])
    useMMGISHandlerReady('tool:getVars', refresh)
    return vars
}
