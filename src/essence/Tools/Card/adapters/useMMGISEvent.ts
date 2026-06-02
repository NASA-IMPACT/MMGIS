import { useEffect } from 'react'
import { mmgisOn } from './mmgisAPI'

export const useMMGISEvent = (
    eventName: string,
    handler: (payload?: unknown) => void,
): void => {
    useEffect(() => {
        const cleanup = mmgisOn(eventName, handler)
        return cleanup
    }, [eventName, handler])
}
