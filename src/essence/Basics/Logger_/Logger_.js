/**
 * Centralized Logging Utility for MMGIS
 * Creates a standardized logger for a specific module with a consistent prefix.
 * Respects the global window.mmgisglobal.debug flag for debug logs.
 */

export const createLogger = (prefix) => ({
    debug: (...args) => {
        if (window.mmgisglobal?.debug) {
            console.log(`[${prefix}]`, ...args)
        }
    },
    log: (...args) => {
        console.log(`[${prefix}]`, ...args)
    },
    warn: (...args) => {
        console.warn(`[${prefix}]`, ...args)
    },
    error: (...args) => {
        console.error(`[${prefix}]`, ...args)
    }
})

export default createLogger
