import { useEffect } from 'react'
import { mmgisOn } from '../../_shared/adapters/mmgisAPI'

/** Subscribe to a bus event for the lifetime of the component. */
export function useMMGISEvent(
    event: string,
    handler: (payload?: unknown) => void,
): void {
    useEffect(() => mmgisOn(event, handler), [event, handler])
}
