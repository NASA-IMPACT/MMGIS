import { useEffect } from 'react'
import { mmgisOn } from './mmgisAPI'

/** Subscribe to a bus event for the lifetime of the component. Pass a stable
 *  handler (useCallback) or the subscription churns every render. */
export function useMMGISEvent(
    event: string,
    handler: (payload?: unknown) => void,
): void {
    useEffect(() => mmgisOn(event, handler), [event, handler])
}
