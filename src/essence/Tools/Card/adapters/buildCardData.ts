import type { CardItem } from '../lib/types'

// Raw card shape as stored in the tool's config variables.
export type RawCard = {
    image?: string
    title?: string
    subtitle?: string
    linkUrl?: string
}

// Matches the lean-mode upload writer's own key shape exactly:
// "assets/<mission>/<subdir>/uploads/<file>" (see
// API/Backend/Upload/uploadRouter.js) — two path segments between "assets/"
// and "/uploads/", not just "contains /uploads/ somewhere". This declassifies
// lookalikes such as "assets/uploads/x.png" (a plugin whose own subdir is
// literally "assets"), which falls through to the mission-relative branch
// instead of being misread as the writer's shape.
//
// Mirrored by ASSETS_UPLOAD_KEY in configure/src/core/upload.js, which
// classifies the same stored values for the CMS's preview. The two live in
// separate bundles (app and Configure SPA) so they cannot share a module;
// tests/unit/uploadPreviewSrc.spec.js fails if they diverge.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//

// Resolves a stored card image value to a renderable URL.
// Mission-relative paths (e.g. "CardPlugin/uploads/a.png") are prefixed with
// the mission path (e.g. "Missions/MSL/"); absolute/data URLs pass through
// unchanged. Values matching ASSETS_UPLOAD_KEY above — e.g.
// "assets/MSL/CardPlugin/uploads/a.png" — are relative to the dashboard's
// own root rather than the mission, so they are returned relative to the
// document base instead of being mission-prefixed — correct both in a
// published dashboard (whose entry URL always ends in "/") and in admin mode
// (which serves from the origin root). A legacy rooted "/assets/..." value
// is rebased to that same slash-less shape before the test. Anything else —
// including an "assets/" value that doesn't match the writer's shape — falls
// through: an already-rooted path passes through unchanged, and everything
// else is treated as mission-relative.
export function resolveImageUrl(
    image: string | undefined | null,
    missionPath: string | null,
): string {
    if (!image) return ''
    if (/^(https?:|data:)/i.test(image)) return image
    const rooted = image.startsWith('/')
    const rebased = rooted ? image.slice(1) : image
    if (ASSETS_UPLOAD_KEY.test(rebased)) return rebased
    if (rooted) return image
    return (missionPath || '') + image
}

// Resolves a stored card link to an href that points where the author meant.
// A link is either internal to the app or an absolute external http(s) link:
//   - root-relative internal links ("/view", "//cdn/x") pass through untouched;
//   - a scheme-less domain like "www.google.com" is coerced to "https://..."
//     (otherwise the browser treats it as relative to the current page); it
//     must have a dotted host, so a bare word like "arst" is rejected;
//   - anything else is validated with the built-in URL parser and accepted only
//     if it resolves to http(s) — rejecting unsafe/non-navigable schemes
//     (javascript:, data:, mailto:, tel:, ftp:, ...) by returning undefined.
// A bare "host:port" with no scheme reads as a scheme and is rejected; authors
// should write the full http(s):// URL in that case. Empty -> undefined.
export function resolveLinkUrl(
    linkUrl: string | undefined | null,
): string | undefined {
    if (!linkUrl) return undefined
    const raw = linkUrl.trim()
    if (!raw) return undefined
    if (raw.startsWith('/')) return raw

    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
    const candidate = hasScheme ? raw : `https://${raw}`
    try {
        const url = new URL(candidate)
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
        // A scheme-less value we coerced to https must have a dotted host, so a
        // bare word like "arst" isn't accepted as a single-label hostname.
        // Explicitly-schemed URLs are trusted as written (e.g. http://localhost).
        if (!hasScheme && !url.hostname.includes('.')) return undefined
        return candidate
    } catch {
        // not a parseable URL
    }
    return undefined
}

// Pure transform: raw config cards + mission path -> renderable lib props.
export function buildCardData(
    cards: RawCard[] | undefined,
    missionPath: string | null,
): CardItem[] {
    if (!Array.isArray(cards)) return []
    return cards.map((card) => ({
        imageUrl: resolveImageUrl(card.image, missionPath),
        title: card.title,
        subtitle: card.subtitle,
        linkUrl: resolveLinkUrl(card.linkUrl),
    }))
}
