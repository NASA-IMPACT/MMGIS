import type { CardItem } from '../lib/types'
import { resolveMissionAssetUrl } from '../../../../pre/uploadKey'

// Raw card shape as stored in the tool's config variables.
export type RawCard = {
    image?: string
    title?: string
    subtitle?: string
    linkUrl?: string
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
        imageUrl: resolveMissionAssetUrl(card.image, missionPath),
        title: card.title,
        subtitle: card.subtitle,
        linkUrl: resolveLinkUrl(card.linkUrl),
    }))
}
