import React from 'react'
import { Card } from '../Card/Card'
import type { CardItem } from '../../types'

export type CardListProps = {
    /** Cards to render (image already resolved to a URL). */
    cards: CardItem[]
    /** Suppresses rendering until the first data load resolves. */
    loading?: boolean
}

export function CardList({ cards, loading }: CardListProps) {
    if (loading) return null
    return (
        <div className="blocks-card-list">
            {cards.map((card, i) => (
                <Card
                    key={i}
                    imageUrl={card.imageUrl}
                    title={card.title}
                    subtitle={card.subtitle}
                    linkUrl={card.linkUrl}
                />
            ))}
        </div>
    )
}
