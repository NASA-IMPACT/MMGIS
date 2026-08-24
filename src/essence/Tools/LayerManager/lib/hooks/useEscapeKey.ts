import { useEffect } from 'react'

/**
 * Dismiss-on-Escape for popovers. Listens on keydown rather than keyup so the
 * popover closes before a native control inside it (a number input's spinner,
 * for instance) can act on the same press.
 */
export const useEscapeKey = (callback: () => void, enabled = true): void => {
    useEffect(() => {
        if (!enabled) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') callback()
        }
        document.addEventListener('keydown', handleKeyDown)
        return () => document.removeEventListener('keydown', handleKeyDown)
    }, [callback, enabled])
}
