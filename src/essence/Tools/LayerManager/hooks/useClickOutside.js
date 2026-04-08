import { useEffect } from 'react'

/**
 * Custom hook that detects clicks outside of specified elements
 *
 * @param {React.RefObject[]} refs - Array of refs to elements that should not trigger the callback
 * @param {function} callback - Function to call when clicking outside
 * @param {boolean} enabled - Whether the listener is active (default: true)
 */
const useClickOutside = (refs, callback, enabled = true) => {
    useEffect(() => {
        if (!enabled) return

        const handleClickOutside = (event) => {
            // Check if click is outside all provided refs
            const isOutside = refs.every(ref => {
                return !ref.current || !ref.current.contains(event.target)
            })

            if (isOutside) {
                callback(event)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)

        return () => {
            document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [refs, callback, enabled])
}

export default useClickOutside
