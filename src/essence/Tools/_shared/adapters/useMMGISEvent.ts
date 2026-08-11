import { useEffect } from 'react'
import { mmgisOn } from './mmgisAPI'

// LayerManager still carries a local copy of this hook; migrating it here is
// tracked in https://github.com/NASA-IMPACT/MMGIS/issues/202.
export const useMMGISEvent = (
    eventName: string,
    handler: (payload?: unknown) => void,
): void => {
    useEffect(() => {
        const cleanup = mmgisOn(eventName, handler)
        return cleanup
    }, [eventName, handler])
}
