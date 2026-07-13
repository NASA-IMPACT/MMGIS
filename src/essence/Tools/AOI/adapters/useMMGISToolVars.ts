import { useEffect, useState } from 'react'
import { mmgisRequest } from '../../_shared/adapters/mmgisAPI'

export const useMMGISToolVars = <
    T extends Record<string, unknown> = Record<string, unknown>,
>(
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
                if (!cancelled) console.warn(`[useMMGISToolVars] '${toolName}' vars unavailable:`, err)
            })
        return () => {
            cancelled = true
        }
    }, [toolName])
    return vars
}
