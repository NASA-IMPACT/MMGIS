import React from 'react'
import './TitleTool.css'

const PLUGIN_ID = 'title'

// Resolve this plugin's scoped mmgisAPI once. forPlugin() has a side effect
// (it registers a getVars provider), so we avoid calling it on every click.
let _api = null
const getApi = () => {
    if (!_api && window.mmgisAPI?.forPlugin) {
        _api = window.mmgisAPI.forPlugin(PLUGIN_ID)
    }
    return _api
}

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
 * @param {string} props.actionButtonLink - http(s) URL (opened in a new tab), or a
 *   bus event name emitted under this plugin's namespace as 'plugin:title:<value>' (optional)
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
            // Otherwise treat the link as a bus event name and emit it under
            // this plugin's namespace, i.e. 'plugin:title:<actionButtonLink>'.
            // A consumer plugin subscribes to that to react (e.g. open AOI).
            const api = getApi()
            if (api) api.emit(actionButtonLink)
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
