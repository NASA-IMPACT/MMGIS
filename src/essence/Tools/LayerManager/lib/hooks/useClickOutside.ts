import { useEffect, type RefObject } from 'react'

type AnyRef = RefObject<HTMLElement | null>

export const useClickOutside = (
    refs: AnyRef[],
    callback: (event: MouseEvent) => void,
    enabled = true,
): void => {
    useEffect(() => {
        if (!enabled) return
        const handleClickOutside = (event: MouseEvent) => {
            const isOutside = refs.every(
                (ref) => !ref.current || !ref.current.contains(event.target as Node),
            )
            if (isOutside) callback(event)
        }
        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [refs, callback, enabled])
}
