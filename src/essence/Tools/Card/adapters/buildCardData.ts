import type { CardItem } from '../lib/types'

// Raw card shape as stored in the tool's config variables.
export type RawCard = {
    image?: string
    title?: string
    subtitle?: string
    linkUrl?: string
}

// Is this stored value one of our lean-mode uploads? Those are written by
// API/Backend/Upload/uploadRouter.js and always look exactly like
//
//   assets/<mission>/<subdir>/uploads/<file>
//
// so this matches "assets/", then exactly two path segments, then
// "/uploads/". The exactness matters: a plugin whose subdir happens to be
// named "assets" would store ordinary mission-relative values like
// "assets/uploads/x.png", and a looser test ("starts with assets/") would
// grab those too and resolve them against the wrong root. Requiring both
// middle segments keeps the two shapes apart.
//
// The Configure app needs the same test for its upload previews, but it is
// a separate bundle that can't import from this one, so the regex is
// written twice: here and ASSETS_UPLOAD_KEY in configure/src/core/upload.js.
// tests/unit/uploadPreviewSrc.spec.js fails if the two copies ever differ.
const ASSETS_UPLOAD_KEY = /^assets\/[^/]+\/[^/]+\/uploads\//

// Turns a stored card image value into the URL the <img> tag should use.
// The stored value can be one of four things, checked in this order:
//
//   - a full URL ("https://..." or "data:...") — used as-is.
//
//   - a lean-mode upload key ("assets/MSL/CardPlugin/uploads/a.png" — the
//     shape ASSETS_UPLOAD_KEY matches) — returned still slash-less, so the
//     browser resolves it against the page's own folder. That folder is
//     always the dashboard's root: the page is only ever served as
//     <root>/ or <root>/index.html (the slash-less entry URL gets
//     redirected), and the admin serves from the origin root. A legacy
//     value from before the slash-less contract ("/assets/...") is the
//     same thing with a leading slash; the slash is stripped before the
//     test so it takes this branch too.
//
//   - any other rooted path ("/somewhere/else.png") — used as-is.
//
//   - anything else ("CardPlugin/uploads/a.png") — a mission-relative path,
//     prefixed with the mission path ("Missions/MSL/"). This includes an
//     "assets/..." value that doesn't match the writer's exact shape, on
//     purpose — see the regex comment above.
export function resolveImageUrl(
    image: string | undefined | null,
    missionPath: string | null,
): string {
    if (!image) return ''
    if (typeof image !== 'string') return ''
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
