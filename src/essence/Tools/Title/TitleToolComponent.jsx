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
 */
const TitleToolComponent = ({ titleText, logoUrl, iconClass }) => {
    return (
        <div id="titleTool">
            <div className="titleTool-container">
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
                <div className="titleTool-text">
                    <span className="titleTool-title">{titleText}</span>
                </div>
            </div>
        </div>
    )
}

export default TitleToolComponent
