import { useEffect } from 'react'
import { mmgisOn } from '../../_shared/adapters/mmgisAPI'

export const useMMGISEvent = (
    eventName: string,
    handler: (payload?: unknown) => void,
): void => {
    useEffect(() => {
        const cleanup = mmgisOn(eventName, handler)
        return cleanup
    }, [eventName, handler])
}
