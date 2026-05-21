import React from 'react'
import './TitleTool.css'

/**
 * TitleToolComponent - React component for displaying mission title and logo
 *
 * Renders a header with logo/icon and title text based on mission configuration
 *
 * @param {object} props
 * @param {string} props.titleText - The title text to display
 * @param {string} props.logoUrl - URL to the logo image (optional)
 * @param {string} props.iconClass - CSS class for the icon (used when no logo)
 * @param {boolean} props.showLogo - Whether to show the logo/icon (default: true)
 * @param {boolean} props.showTitleText - Whether to show the title text (default: true)
 * @param {string} props.actionButtonText - Text to display on the action button (optional)
 * @param {string} props.actionButtonLink - URL or event name for action button (optional)
 */
const TitleToolComponent = ({
    titleText,
    logoUrl,
    iconClass,
    showLogo = true,
    showTitleText = true,
    actionButtonText = '',
    actionButtonLink = '',
}) => {
    const handleActionClick = () => {
        if (!actionButtonLink) return

        // Check if it's a URL (starts with http:// or https://)
        if (actionButtonLink.startsWith('http://') || actionButtonLink.startsWith('https://')) {
            // Open external URL in new tab
            window.open(actionButtonLink, '_blank', 'noopener,noreferrer')
        } else {
            // Emit MMGIS event
            window.dispatchEvent(
                new CustomEvent('mmgis-event', {
                    detail: {
                        event: actionButtonLink,
                        source: 'TitleTool',
                    },
                })
            )
        }
    }

    return (
        <div id="titleTool">
            <div className="titleTool-container">
                <div className="titleTool-header">
                    {showLogo && (
                        <>
                            {logoUrl ? (
                                <div className="titleTool-logo">
                                    <img
                                        src={logoUrl}
                                        alt="Logo"
                                        className="titleTool-logo-img"
                                    />
                                </div>
                            ) : (
                                <div className="titleTool-icon">
                                    <i className={iconClass} />
                                </div>
                            )}
                        </>
                    )}
                    {showTitleText && (
                        <div className="titleTool-text">
                            <span className="titleTool-title">{titleText}</span>
                        </div>
                    )}
                </div>
                {actionButtonLink && (
                    <div className="titleTool-action-container">
                        <button
                            className="titleTool-action-button"
                            onClick={handleActionClick}
                            title={actionButtonLink}
                        >
                            {actionButtonText || <i className="mdi mdi-arrow-right-circle mdi-18px" />}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default TitleToolComponent
