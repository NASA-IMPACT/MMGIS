import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Calls onOutside when a mousedown lands outside the ref'd element. */
export function useOutsideClick(
    ref: RefObject<HTMLElement | null>,
    onOutside: () => void,
): void {
    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
        }
        document.addEventListener('mousedown', onDown)
        return () => document.removeEventListener('mousedown', onDown)
    }, [ref, onOutside])
}
