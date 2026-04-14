import $ from 'jquery'
import TimeControl from '../../Basics/TimeControl_/TimeControl'
import L_ from '../../Basics/Layers_/Layers_'

import './TimelineTool.css'

const TimelineTool = {
    height: 0,
    width: 300,
    MMGISInterface: null,
    targetId: null,
    made: false,
    currentTime: null,
    startTime: null,
    endTime: null,
    isPlaying: false,
    playInterval: null,
    playSpeed: 1000, // milliseconds per step
    quantization: 'hourly', // 'hourly' or 'daily'

    initialize: function () {
        // Tool initialization
    },

    make: function (targetId) {
        this.targetId = typeof targetId === 'string'
            ? targetId
            : '__TimelineTool_missing_targetId'

        this.MMGISInterface = new interfaceWithMMGIS()
        this.made = true

        // Subscribe to TimeControl changes
        if (TimeControl.enabled) {
            TimeControl.subscribe('TimelineTool', (timeData) => {
                this.startTime = timeData.startTime
                this.endTime = timeData.endTime
                this.currentTime = timeData.currentTime
                this.updateDisplay()
            })

            // Initialize global time from config if not already set
            this.initializeTimeFromConfig()

            // Get initial times
            this.startTime = TimeControl.getStartTime()
            this.endTime = TimeControl.getEndTime()
            this.currentTime = TimeControl.getTime()

            this.updateDisplay()
        }
    },

    initializeTimeFromConfig: function () {
        // If times are already set, don't reinitialize
        if (TimeControl.getStartTime() && TimeControl.getEndTime()) {
            return
        }

        const timeConfig = L_.configData?.time
        if (!timeConfig || !timeConfig.enabled) {
            return
        }

        // Check for FUTURES times first (from URL parameters)
        if (L_.FUTURES.endTime != null) {
            timeConfig.initialend = L_.FUTURES.endTime
        }
        if (L_.FUTURES.startTime != null) {
            timeConfig.initialstart = L_.FUTURES.startTime
        }

        // Get end time
        let endTime = timeConfig.initialend || 'now'
        if (endTime === 'now') {
            endTime = new Date().toISOString().split('.')[0] + 'Z'
        }

        // Get start time
        let startTime = timeConfig.initialstart
        if (!startTime) {
            // Default to 1 hour before end time
            const endDate = new Date(endTime)
            const startDate = new Date(endDate.getTime() - 3600000) // 1 hour before
            startTime = startDate.toISOString().split('.')[0] + 'Z'
        }

        // Get current time (defaults to end time)
        let currentTime = endTime

        // Determine if time is relative or absolute
        // Only use relative mode if explicitly set in config
        const isRelative = timeConfig.type === 'relative'

        console.log('[Timeline] Initializing time from config:', {
            startTime,
            endTime,
            currentTime,
            isRelative,
            timeConfig
        })

        // Set the time
        TimeControl.setTime(
            startTime,
            endTime,
            isRelative,
            timeConfig.offset || '00:00:00',
            currentTime
        )
    },

    destroy: function () {
        this.stopPlaying()
        if (this.MMGISInterface) {
            this.MMGISInterface.separateFromMMGIS()
        }
        TimeControl.unsubscribe('TimelineTool')
        this.targetId = null
        this.made = false
    },

    updateDisplay: function () {
        if (!this.made) return

        const currentTimeDisplay = $(`#${this.targetId} .timeline-current-time`)
        const slider = $(`#${this.targetId} .timeline-slider`)
        const startTimeLabel = $(`#${this.targetId} .timeline-start-time`)
        const endTimeLabel = $(`#${this.targetId} .timeline-end-time`)
        const container = $(`#${this.targetId} .timeline-container`)
        const noTimeMsg = $(`#${this.targetId} .timeline-no-time-msg`)

        if (this.currentTime && this.startTime && this.endTime) {
            // Show controls, hide message
            container.show()
            noTimeMsg.hide()

            // Update time display
            const formattedTime = this.formatTime(this.currentTime)
            currentTimeDisplay.text(formattedTime)

            // Update time range labels
            startTimeLabel.text(this.formatTime(this.startTime))
            endTimeLabel.text(this.formatTime(this.endTime))

            // Update slider position
            const totalDuration = new Date(this.endTime) - new Date(this.startTime)
            const currentPosition = new Date(this.currentTime) - new Date(this.startTime)
            const percentage = totalDuration === 0 ? 0 : (currentPosition / totalDuration) * 100

            console.log('[Timeline] updateDisplay:', {
                startTime: this.startTime,
                endTime: this.endTime,
                currentTime: this.currentTime,
                totalDuration,
                currentPosition,
                percentage
            })

            slider.val(percentage)
        } else {
            // Hide controls, show message
            container.hide()
            noTimeMsg.show()
        }
    },

    formatTime: function (isoString) {
        if (!isoString) return '--:--:--'
        const date = new Date(isoString)
        return date.toISOString().replace('T', ' ').split('.')[0] + 'Z'
    },

    onSliderChange: function (percentage) {
        if (!this.startTime || !this.endTime) return

        const totalDuration = new Date(this.endTime) - new Date(this.startTime)

        console.log('[Timeline] Slider changed:', {
            percentage,
            startTime: this.startTime,
            endTime: this.endTime,
            totalDuration
        })

        // If start and end are the same, can't scrub
        if (totalDuration === 0) {
            console.warn('[Timeline] Start and end times are the same, cannot scrub')
            return
        }

        const newPosition = (percentage / 100) * totalDuration
        const newTime = new Date(new Date(this.startTime).getTime() + newPosition)

        console.log('[Timeline] New time:', newTime.toISOString())

        // Quantize the new time
        const quantizedTime = this.quantizeTime(newTime.toISOString().split('.')[0] + 'Z')

        console.log('[Timeline] Quantized time:', quantizedTime)

        // Update TimeControl
        TimeControl.handleTimeChange(
            this.startTime,
            this.endTime,
            quantizedTime
        )
    },

    togglePlayPause: function () {
        if (this.isPlaying) {
            this.stopPlaying()
        } else {
            this.startPlaying()
        }
    },

    startPlaying: function () {
        if (!this.startTime || !this.endTime) return

        this.isPlaying = true
        const playBtn = $(`#${this.targetId} .timeline-play-btn`)
        playBtn.html('<i class="mdi mdi-pause mdi-18px"></i>')

        this.playInterval = setInterval(() => {
            if (!this.currentTime || !this.endTime) {
                this.stopPlaying()
                return
            }

            const current = new Date(this.currentTime)
            const end = new Date(this.endTime)

            // Use quantized step (hourly or daily)
            const step = this.getQuantizedStep()

            const newTime = new Date(current.getTime() + step)

            // Stop if we've reached the end
            if (newTime >= end) {
                this.stopPlaying()
                return
            }

            // Quantize and update TimeControl
            const quantizedTime = this.quantizeTime(newTime.toISOString().split('.')[0] + 'Z')

            TimeControl.handleTimeChange(
                this.startTime,
                this.endTime,
                quantizedTime
            )
        }, this.playSpeed)
    },

    stopPlaying: function () {
        this.isPlaying = false
        const playBtn = $(`#${this.targetId} .timeline-play-btn`)
        playBtn.html('<i class="mdi mdi-play mdi-18px"></i>')

        if (this.playInterval) {
            clearInterval(this.playInterval)
            this.playInterval = null
        }
    },

    skipToStart: function () {
        if (!this.startTime || !this.endTime) return

        this.stopPlaying()
        TimeControl.handleTimeChange(
            this.startTime,
            this.endTime,
            this.startTime
        )
    },

    skipToEnd: function () {
        if (!this.startTime || !this.endTime) return

        this.stopPlaying()
        TimeControl.handleTimeChange(
            this.startTime,
            this.endTime,
            this.endTime
        )
    },

    stepBackward: function () {
        if (!this.startTime || !this.endTime || !this.currentTime) return

        const current = new Date(this.currentTime)
        const start = new Date(this.startTime)
        const step = this.getQuantizedStep()

        // Calculate new time
        const newTime = new Date(current.getTime() - step)

        // Don't go before start time
        if (newTime < start) {
            TimeControl.handleTimeChange(
                this.startTime,
                this.endTime,
                this.startTime
            )
            return
        }

        // Quantize and update
        const quantizedTime = this.quantizeTime(newTime.toISOString().split('.')[0] + 'Z')
        TimeControl.handleTimeChange(
            this.startTime,
            this.endTime,
            quantizedTime
        )
    },

    stepForward: function () {
        if (!this.startTime || !this.endTime || !this.currentTime) return

        const current = new Date(this.currentTime)
        const end = new Date(this.endTime)
        const step = this.getQuantizedStep()

        // Calculate new time
        const newTime = new Date(current.getTime() + step)

        // Don't go past end time
        if (newTime > end) {
            TimeControl.handleTimeChange(
                this.startTime,
                this.endTime,
                this.endTime
            )
            return
        }

        // Quantize and update
        const quantizedTime = this.quantizeTime(newTime.toISOString().split('.')[0] + 'Z')
        TimeControl.handleTimeChange(
            this.startTime,
            this.endTime,
            quantizedTime
        )
    },

    quantizeTime: function (isoString) {
        if (!isoString) return isoString

        const date = new Date(isoString)

        if (this.quantization === 'hourly') {
            // Round to nearest hour, set minutes and seconds to 00:00
            date.setMinutes(0, 0, 0)
        } else if (this.quantization === 'daily') {
            // Round to start of day, set time to 00:00:00
            date.setHours(0, 0, 0, 0)
        }

        return date.toISOString().split('.')[0] + 'Z'
    },

    getQuantizedStep: function () {
        if (this.quantization === 'hourly') {
            return 3600000 // 1 hour in milliseconds
        } else if (this.quantization === 'daily') {
            return 86400000 // 1 day in milliseconds
        }
        return 3600000 // default to hourly
    },

    setQuantization: function (value) {
        this.quantization = value

        // Update the current time to be quantized
        if (this.currentTime) {
            const quantizedTime = this.quantizeTime(this.currentTime)
            TimeControl.handleTimeChange(
                this.startTime,
                this.endTime,
                quantizedTime
            )
        }
    }
}

function interfaceWithMMGIS() {
    this.separateFromMMGIS = function () {
        separateFromMMGIS()
    }

    const tools = $(TimelineTool.targetId ? `#${TimelineTool.targetId}` : '#toolPanel')
    tools.css({
        'background': 'var(--uswds-white, #ffffff)',
        'width': '100%',
        'box-sizing': 'border-box'
    })
    tools.empty()

    // No time message (shown when times aren't set)
    const noTimeMsg = $('<div>')
        .attr('class', 'timeline-no-time-msg')
        .css({
            'padding': '20px',
            'text-align': 'center',
            'color': 'var(--uswds-base-dark, #3d4551)',
            'display': 'none'
        })
        .html(`
            <i class="mdi mdi-clock-outline mdi-24px"></i>
            <p style="margin-top: 10px;">Waiting for time configuration...</p>
            <p style="font-size: 11px; opacity: 0.7;">Time will be available once time-enabled layers are configured.</p>
        `)
    tools.append(noTimeMsg)

    // Create the timeline UI
    const container = $('<div>')
        .attr('class', 'timeline-container')
        .css({
            'padding': '10px',
            'display': 'none',
            'flex-direction': 'column',
            'gap': '10px',
            'height': '100%',
            'width': '100%',
            'box-sizing': 'border-box'
        })

    // Time display
    const timeDisplay = $('<div>')
        .attr('class', 'timeline-current-time')
        .css({
            'text-align': 'center',
            'font-size': '14px',
            'color': 'var(--uswds-base-darker, #171c1e)',
            'font-family': 'monospace',
            'font-weight': '600'
        })
        .text('--:--:--')

    // Quantization selector
    const quantizationContainer = $('<div>')
        .css({
            'display': 'flex',
            'flex-direction': 'column',
            'gap': '4px',
            'margin-top': '8px',
            'font-size': '12px',
            'color': 'var(--uswds-base-dark, #3d4551)',
            'width': '100%'
        })

    const quantizationLabel = $('<label>')
        .text('Step:')
        .css({
            'color': 'var(--uswds-base-dark, #3d4551)',
            'font-weight': '500',
            'font-size': '11px'
        })

    const quantizationSelect = $('<select>')
        .attr('class', 'timeline-quantization-select')
        .css({
            'background': 'transparent',
            'border': '1px solid rgba(0, 0, 0, 0.2)',
            'color': 'var(--uswds-base-darker, #171c1e)',
            'padding': '6px 8px',
            'border-radius': '4px',
            'cursor': 'pointer',
            'font-size': '12px',
            'width': '100%'
        })
        .append(
            $('<option>').val('hourly').text('Hourly'),
            $('<option>').val('daily').text('Daily')
        )
        .val(TimelineTool.quantization)
        .on('change', function() {
            TimelineTool.setQuantization($(this).val())
        })

    quantizationContainer.append(quantizationLabel, quantizationSelect)

    // Slider
    const slider = $('<input>')
        .attr({
            'type': 'range',
            'class': 'timeline-slider',
            'min': '0',
            'max': '100',
            'value': '0'
        })
        .css({
            'width': '100%',
            'cursor': 'pointer'
        })
        .on('input', function() {
            TimelineTool.onSliderChange(parseFloat($(this).val()))
        })

    // Control buttons
    const controls = $('<div>')
        .attr('class', 'timeline-controls')
        .css({
            'display': 'flex',
            'justify-content': 'center',
            'gap': '6px',
            'flex-wrap': 'wrap'
        })

    const skipStartBtn = $('<button>')
        .attr('class', 'timeline-btn timeline-skip-start-btn')
        .html('<i class="mdi mdi-skip-previous mdi-18px"></i>')
        .attr('title', 'Skip to start')
        .on('click', () => TimelineTool.skipToStart())

    const stepBackwardBtn = $('<button>')
        .attr('class', 'timeline-btn timeline-step-backward-btn')
        .html('<i class="mdi mdi-chevron-left mdi-18px"></i>')
        .attr('title', 'Step backward')
        .on('click', () => TimelineTool.stepBackward())

    const playBtn = $('<button>')
        .attr('class', 'timeline-btn timeline-play-btn')
        .html('<i class="mdi mdi-play mdi-18px"></i>')
        .attr('title', 'Play/Pause')
        .on('click', () => TimelineTool.togglePlayPause())

    const stepForwardBtn = $('<button>')
        .attr('class', 'timeline-btn timeline-step-forward-btn')
        .html('<i class="mdi mdi-chevron-right mdi-18px"></i>')
        .attr('title', 'Step forward')
        .on('click', () => TimelineTool.stepForward())

    const skipEndBtn = $('<button>')
        .attr('class', 'timeline-btn timeline-skip-end-btn')
        .html('<i class="mdi mdi-skip-next mdi-18px"></i>')
        .attr('title', 'Skip to end')
        .on('click', () => TimelineTool.skipToEnd())

    controls.append(skipStartBtn, stepBackwardBtn, playBtn, stepForwardBtn, skipEndBtn)

    // Time range labels
    const timeRangeContainer = $('<div>')
        .css({
            'display': 'flex',
            'justify-content': 'space-between',
            'font-size': '11px',
            'color': 'var(--uswds-base-dark, #3d4551)',
            'font-family': 'monospace',
            'margin-top': '5px',
            'opacity': '0.8'
        })

    const startTimeLabel = $('<span>')
        .attr('class', 'timeline-start-time')
        .text(TimelineTool.formatTime(TimelineTool.startTime))

    const endTimeLabel = $('<span>')
        .attr('class', 'timeline-end-time')
        .text(TimelineTool.formatTime(TimelineTool.endTime))

    timeRangeContainer.append(startTimeLabel, endTimeLabel)

    // Assemble UI
    container.append(timeDisplay, quantizationContainer, slider, controls, timeRangeContainer)
    tools.append(container)

    // Check if TimeControl is enabled
    if (!TimeControl.enabled) {
        noTimeMsg.html(`
            <i class="mdi mdi-clock-outline mdi-24px"></i>
            <p style="margin-top: 10px;">Time Control is not enabled for this mission.</p>
        `).show()
    }

    function separateFromMMGIS() {
        tools.empty()
    }
}

export default TimelineTool
