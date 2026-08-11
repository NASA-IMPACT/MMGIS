import { MapPopupAction } from './types'

export interface PopupCardOptions {
    /** Popup body, already sanitized by the caller. */
    html: string
    primaryAction?: MapPopupAction
    secondaryAction?: MapPopupAction
    /** Called with the clicked action. The card itself knows nothing of the bus. */
    onAction: (action: MapPopupAction) => void
    /** Called when the close control is pressed. */
    onClose: () => void
}

function buildActionButton(
    action: MapPopupAction,
    variant: 'primary' | 'secondary',
    onAction: (action: MapPopupAction) => void
): HTMLButtonElement {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `mmgis-map-popup__button mmgis-map-popup__button--${variant}`
    button.textContent = action.label
    button.addEventListener('click', () => onAction(action))
    return button
}

/**
 * Build the popup card element. Pure view: it renders the given content and
 * reports clicks back through the callbacks, with no knowledge of the event
 * bus, the map, or where the card is positioned.
 */
export function buildPopupCard(options: PopupCardOptions): HTMLElement {
    const card = document.createElement('div')
    card.className = 'mmgis-map-popup'
    card.setAttribute('role', 'dialog')
    card.setAttribute('aria-label', 'Map popup')
    card.tabIndex = -1

    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'mmgis-map-popup__close'
    close.setAttribute('aria-label', 'Close')
    close.textContent = '×'
    close.addEventListener('click', options.onClose)
    card.appendChild(close)

    const content = document.createElement('div')
    content.className = 'mmgis-map-popup__content'
    content.innerHTML = options.html
    card.appendChild(content)

    const { primaryAction, secondaryAction, onAction } = options
    if (primaryAction || secondaryAction) {
        const actions = document.createElement('div')
        actions.className = 'mmgis-map-popup__actions'
        if (!primaryAction || !secondaryAction) {
            actions.classList.add('mmgis-map-popup__actions--single')
        }
        if (secondaryAction) {
            actions.appendChild(
                buildActionButton(secondaryAction, 'secondary', onAction)
            )
        }
        if (primaryAction) {
            actions.appendChild(
                buildActionButton(primaryAction, 'primary', onAction)
            )
        }
        card.appendChild(actions)
    }

    return card
}
