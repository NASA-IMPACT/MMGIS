import type { CardItem } from '../lib/types'

// Raw card shape as stored in the tool's config variables.
export type RawCard = {
    image?: string
    title?: string
    subtitle?: string
    linkUrl?: string
}

// Resolves a stored card image value to a renderable URL.
// Mission-relative paths (e.g. "CardPlugin/uploads/a.png") are prefixed with
// the mission path (e.g. "Missions/MSL/"); absolute/data/root-relative URLs
// pass through unchanged.
export function resolveImageUrl(
    image: string | undefined | null,
    missionPath: string | null,
): string {
    if (!image) return ''
    if (/^(https?:|data:|\/)/i.test(image)) return image
    return (missionPath || '') + image
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
        linkUrl: card.linkUrl,
    }))
}
