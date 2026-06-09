import React from 'react'

export type TitleProps = {
    /** Main title text. */
    titleText: string
    /** Logo image URL. When set (and showLogo), renders the logo instead of the icon. */
    logoUrl?: string | null
    /** mdi icon class used when no logoUrl is provided. */
    iconClass?: string
    /** Show the logo/icon. Default true. */
    showLogo?: boolean
    /** Show the title text. Default true. */
    showTitleText?: boolean
    /** Render the action button. Default false. */
    showAction?: boolean
    /** Action button label. When empty, a default arrow icon is shown. */
    actionLabel?: string
    /** Optional title/tooltip for the action button. */
    actionTitle?: string
    /** Invoked when the action button is clicked. */
    onActionClick?: () => void
}

/**
 * Presentational mission title bar: optional logo/icon, title text, and an
 * optional action button. Pure and framework-agnostic — all behaviour comes in
 * via props (the action's effect is owned by the caller through onActionClick).
 */
export function Title({
    titleText,
    logoUrl,
    iconClass = 'mdi mdi-earth mdi-24px',
    showLogo = true,
    showTitleText = true,
    showAction = false,
    actionLabel = '',
    actionTitle,
    onActionClick,
}: TitleProps) {
    return (
        <div className="blocks-title">
            <div className="blocks-title__container">
                <div className="blocks-title__header">
                    {showLogo &&
                        (logoUrl ? (
                            <div className="blocks-title__logo">
                                <img
                                    src={logoUrl}
                                    alt="Logo"
                                    className="blocks-title__logo-img"
                                />
                            </div>
                        ) : (
                            <div className="blocks-title__icon">
                                <i className={iconClass} />
                            </div>
                        ))}
                    {showTitleText && (
                        <div className="blocks-title__text">
                            <span className="blocks-title__title">
                                {titleText}
                            </span>
                        </div>
                    )}
                </div>
                {showAction && (
                    <div className="blocks-title__action-container">
                        <button
                            type="button"
                            className="blocks-title__action-button"
                            onClick={() => onActionClick?.()}
                            title={actionTitle}
                        >
                            {actionLabel || (
                                <i className="mdi mdi-arrow-right-circle mdi-18px" />
                            )}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}
