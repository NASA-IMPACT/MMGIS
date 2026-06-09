import React from 'react'
import type { CardItem } from '../../types'

export type CardProps = CardItem

export function Card({ imageUrl, title, subtitle, linkUrl }: CardProps) {
    if (!title && !imageUrl) return null
    return (
        <a
            className="blocks-card"
            href={linkUrl || undefined}
            target="_blank"
            rel="noopener noreferrer"
        >
            {imageUrl ? (
                <img className="blocks-card__image" src={imageUrl} alt={title || ''} />
            ) : (
                <div className="blocks-card__image" />
            )}
            <div className="blocks-card__body">
                {title ? <div className="blocks-card__title">{title}</div> : null}
                {subtitle ? (
                    <div className="blocks-card__subtitle">{subtitle}</div>
                ) : null}
            </div>
        </a>
    )
}
