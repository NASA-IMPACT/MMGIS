// Copy of ASSETS_UPLOAD_KEY in src/essence/Tools/_shared/content/uploadKey.ts,
// which this module sits outside of and can't import.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//

// The tab icon: look.faviconurl, else look.logourl, resolved like the title
// bar's logo. '' when neither is set.
export function faviconHref(look, missionPath) {
    const value = (look && (look.faviconurl || look.logourl)) || ''
    if (typeof value !== 'string' || value === '') return ''
    if (/^(https?:|data:)/i.test(value)) return value
    const rooted = value.startsWith('/')
    const rebased = rooted ? value.slice(1) : value
    if (ASSETS_UPLOAD_KEY.test(rebased)) return rebased
    if (rooted) return value
    return (missionPath || '') + value
}
