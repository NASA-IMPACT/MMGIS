import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TimelineAdapter } from './TimelineAdapter'
import { mmgisRequest } from '../_shared/adapters/mmgisAPI'

type ToolVars = {
    width?: number
    height?: number
}

let _root: Root | null = null

const TimelineTool = {
    height: 200,
    width: 'full' as number | 'full',
    vars: {} as ToolVars,
    targetId: null as string | null,
    made: false,

    initialize: async function () {
        try {
            this.vars =
                (await mmgisRequest<ToolVars>(
                    'tool:getVars',
                    'timeline',
                )) || {}
            if (this.vars.width) this.width = this.vars.width
            if (this.vars.height) this.height = this.vars.height
        } catch (err) {
            console.warn(
                '[TimelineTool] tool:getVars unavailable:',
                err instanceof Error ? err.message : err,
            )
        }

        try {
            const isMobile = await mmgisRequest<boolean>('app:isMobile')
            if (isMobile) {
                this.width = 'full'
                this.height = 300
            }
        } catch (err) {
            console.warn(
                '[TimelineTool] app:isMobile unavailable:',
                err instanceof Error ? err.message : err,
            )
        }
    },

    make: function (targetId?: string) {
        this.targetId = typeof targetId === 'string' ? targetId : 'toolPanel'
        const container = document.getElementById(this.targetId)
        if (!container) {
            console.error(
                `TimelineTool: container ${this.targetId} not found`,
            )
            return
        }
        // A prior root left mounted on this container would collide with the
        // new one, so it is torn down first.
        if (_root) {
            _root.unmount()
            _root = null
        }
        _root = createRoot(container)
        _root.render(<TimelineAdapter />)
        this.made = true
    },

    destroy: function () {
        if (_root) {
            _root.unmount()
            _root = null
        }
        this.targetId = null
        this.made = false
    },

    getUrlString: function () {
        return ''
    },
}

export default TimelineTool
