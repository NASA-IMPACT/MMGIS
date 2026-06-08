import React from 'react'
import { AddTempLayerInput } from './addTempLayerHelpers'
import './AddTempLayerComponent.scss'

export interface AddTempLayerComponentProps {
    /** Submit a layer to add. Wired to mmgisAPI.addLayer by the wrapper. */
    onAddLayer?: (input: AddTempLayerInput) => void
}

// Scaffold only — renders a placeholder. Button + modal UI come in a later step.
export function AddTempLayerComponent(_props: AddTempLayerComponentProps) {
    return (
        <div className="add-temp-layer">
            {/* TODO: trigger button + "Add layer from URL" modal */}
        </div>
    )
}

export default AddTempLayerComponent
