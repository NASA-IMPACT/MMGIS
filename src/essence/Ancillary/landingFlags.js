/**
 * landingFlags.js
 * The URL flags that ask MMGIS for its landing page, and the address-bar URL
 * it writes once a mission has loaded. The landing page, the classic
 * interface and the modern interface all read the same flags and write the
 * same URL shape, so they share one module.
 */

import QueryURL from './QueryURL'
import { isStaticBuild } from '../../pre/capabilities'

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

/**
 * Names the loaded mission in the address bar, for the entry URLs that ask
 * for it.
 *
 * Three URLs ask: one with no query string at all, which says nothing about
 * what is on screen; one carrying the flags that asked for the landing page,
 * which the loaded mission now answers; and a swap into a different mission.
 * Any other URL is a deeplink the visitor arrived with, and it stands.
 *
 * A static build serves the one mission baked into it, so its URL names no
 * mission: the landing page's stripped URL is the last word there and this
 * writes nothing.
 *
 * The mission name is checked only once a URL is going to be written, since
 * it is the one thing that URL is built out of. Callers that write nothing —
 * a static build, a deeplink the visitor arrived with — never see the throw,
 * whatever their config holds.
 *
 * @param {string} mission - the mission that loaded
 * @param {boolean} swapping - true when a different mission is being swapped
 *     in, whose layers and views the pairs in the URL do not name, so they go
 * @returns {boolean} true when the address bar was rewritten
 * @throws {Error} when a URL is due and `mission` does not name one
 */
export const nameMissionInUrl = ({ mission, swapping }) => {
    if (isStaticBuild()) return false

    if (
        window.location.search !== '' &&
        !swapping &&
        !hasForceLanding() &&
        !hasPreview()
    )
        return false

    if (!mission || typeof mission !== 'string') {
        console.error('Invalid mission name in config')
        throw new Error('Invalid mission name')
    }

    replaceMissionUrl({ mission: mission.trim(), keepParams: !swapping })
    return true
}
