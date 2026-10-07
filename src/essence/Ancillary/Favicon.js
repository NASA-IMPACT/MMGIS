import { resolveMissionAssetUrl } from '../Tools/_shared/content/uploadKey'

// The tab icon: look.faviconurl, else look.logourl, resolved like the title
// bar's logo. '' when neither is set.
export function faviconHref(look, missionPath) {
    const value = [look?.faviconurl, look?.logourl].find(
        (v) => typeof v === 'string' && v !== ''
    )
    return resolveMissionAssetUrl(value, missionPath)
}
