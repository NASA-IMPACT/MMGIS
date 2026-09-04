/**
 * landingFlags.js
 * The URL flags that ask MMGIS for its landing page, and the address-bar URL
 * it writes once a mission has loaded. The landing page, the classic
 * interface and the modern interface all read the same flags and write the
 * same URL shape, so they share one module.
 */

import QueryURL from './QueryURL'

// Names left out of a rebuilt mission URL: the flags that asked for the
// landing page, plus `mission` itself, which is re-appended with the mission
// that actually loaded.
const REBUILT_PARAMS = ['forcelanding', 'forceLanding', '_preview', 'mission']

// Both casings count, and the flag counts wherever it sits in the query
// string.
export const hasForceLanding = () =>
    QueryURL.getSingleQueryVariable('forcelanding') !== false ||
    QueryURL.getSingleQueryVariable('forceLanding') !== false

export const hasPreview = () =>
    QueryURL.getSingleQueryVariable('_preview') !== false

/**
 * The href to put in the address bar for a loaded mission.
 *
 * Kept pairs are carried across byte-for-byte rather than re-serialized:
 * URLSearchParams writes a space as '+', while QueryURL's readers decode with
 * decodeURIComponent, which leaves that '+' alone — a layer named 'Base Map'
 * would come back as 'Base+Map' and match nothing.
 *
 * @param {string} search - the query string to rebuild from, with or without
 *     a leading '?'
 * @param {string} pathnameHref - the URL up to the query string
 * @param {string} [mission] - the mission that loaded; leave it out for a URL
 *     that names no mission
 * @param {boolean} keepParams - true carries every non-flag pair across, for
 *     a deeplink that still describes what is on screen; false keeps only the
 *     mission, for a swap into a different mission whose layers and views the
 *     old pairs do not name
 * @returns {string} the href
 */
export const buildMissionUrl = ({
    search,
    pathnameHref,
    mission,
    keepParams,
}) => {
    const pairs = keepParams
        ? String(search || '')
              .replace(/^\?/, '')
              .split('&')
              .filter(
                  (pair) =>
                      pair.length > 0 &&
                      REBUILT_PARAMS.indexOf(pair.split('=')[0]) === -1
              )
        : []

    if (mission) pairs.push('mission=' + encodeURIComponent(mission))

    return pairs.length > 0 ? pathnameHref + '?' + pairs.join('&') : pathnameHref
}

/**
 * Puts the mission URL in the address bar, in place of the current entry, so
 * a reload or a copied link comes back to what is on screen.
 *
 * A static build is the one caller that names no mission: it serves the one
 * mission baked into it, so its URL names none and the landing flags are
 * simply stripped. The classic and modern interfaces skip this call there —
 * that stripped URL is the last word.
 *
 * @param {string} [mission] - the mission that loaded; leave it out for a URL
 *     that names no mission
 * @param {boolean} keepParams - see buildMissionUrl
 */
export const replaceMissionUrl = ({ mission, keepParams }) => {
    window.history.replaceState(
        '',
        '',
        buildMissionUrl({
            search: window.location.search,
            pathnameHref: window.location.origin + window.location.pathname,
            mission,
            keepParams,
        })
    )
}
