import React, { useState, useRef } from 'react'
import moment from 'moment'
import { FloatingPopover } from '../../FloatingPopover'
import { TimeMode } from '../../types'

export interface DateSelectorProps {
    selectedDate: Date
    startTime: Date
    endTime: Date
    timeMode?: TimeMode
    onDateChange: (date: Date) => void
}

export const DateSelector: React.FC<DateSelectorProps> = ({
    selectedDate,
    startTime,
    endTime,
    timeMode = 'DAY',
    onDateChange,
}) => {
    const [isOpen, setIsOpen] = useState(false)
    const [inputValue, setInputValue] = useState('')
    const buttonRef = useRef<HTMLButtonElement>(null)

    // Format the selected date for display
    let formattedDate = moment(selectedDate).format('MMM D, YYYY')
    if (timeMode === 'YEAR') {
        formattedDate = moment(selectedDate).format('YYYY')
    } else if (timeMode === 'MONTH') {
        formattedDate = moment(selectedDate).format('MMMM YYYY')
    } else if (timeMode === 'HOUR') {
        formattedDate = moment(selectedDate).format('MMM D, YYYY, HH:mm')
    }

    const getFormatPattern = () => {
        if (timeMode === 'YEAR') return 'YYYY'
        if (timeMode === 'MONTH') return 'YYYY-MM'
        if (timeMode === 'HOUR') return 'YYYY-MM-DDTHH:mm'
        return 'YYYY-MM-DD'
    }

    const getInputType = () => {
        if (timeMode === 'MONTH') return 'month'
        if (timeMode === 'HOUR') return 'datetime-local'
        return 'date'
    }

    const handleDateClick = () => {
        setIsOpen(!isOpen)
        setInputValue(moment(selectedDate).format(getFormatPattern()))
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value)
    }

    const handleInputSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const newDate = timeMode === 'YEAR' ? moment(inputValue, 'YYYY') : moment(inputValue)

        if (newDate.isValid()) {
            let date = newDate.toDate()

            // For YEAR granularity the value is Jan 1 of the year; if that year
            // overlaps the timeline range, clamp it to the range boundary so an
            // in-range year is accepted rather than rejected as out of range.
            if (timeMode === 'YEAR') {
                const year = newDate.year()
                if (year >= moment(startTime).year() && year <= moment(endTime).year()) {
                    if (date < startTime) date = new Date(startTime)
                    if (date > endTime) date = new Date(endTime)
                }
            }

            // Clamp to valid range
            if (date >= startTime && date <= endTime) {
                onDateChange(date)
                setIsOpen(false)
            } else {
                alert('Date must be within the timeline range')
            }
        }
    }

    return (
        <div className="date-selector">
            <div className="date-selector-display">
                <button
                    ref={buttonRef}
                    className="date-selector-main-button"
                    data-time-mode={timeMode}
                    onClick={handleDateClick}
                    type="button"
                >
                    <svg
                        className="calendar-icon"
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M6 2H14V0H16V2H19V20H1V2H4V0H6V2ZM3 18H17V8H3V18ZM3 6H17V4H3V6Z" />
                    </svg>
                    <span className="date-text">{formattedDate}</span>
                </button>
                
                <div className="date-selector-divider"></div>
                
                <button className="compare-date-button" type="button">
                    Compare date
                </button>
            </div>

            <FloatingPopover
                anchorRef={buttonRef}
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                placement="bottom"
                offset={10}
            >
                <div className="date-selector-dropdown" style={{ position: 'relative', top: 0, left: 0 }}>
                    <form onSubmit={handleInputSubmit} className="date-input-form">
                        <label htmlFor="date-input">
                            {timeMode === 'YEAR' ? 'Select Year' : timeMode === 'MONTH' ? 'Select Month' : timeMode === 'HOUR' ? 'Select Date & Time' : 'Select Date'}
                        </label>

                        {timeMode === 'YEAR' && (
                            <input
                                id="date-input"
                                type="number"
                                value={inputValue}
                                onChange={handleInputChange}
                                min={moment(startTime).year()}
                                max={moment(endTime).year()}
                                step={1}
                                placeholder="YYYY"
                                className="time-input-field"
                            />
                        )}

                        {timeMode === 'MONTH' && (() => {
                            const currentMonth = moment(inputValue || selectedDate).month() + 1
                            const currentYear = moment(inputValue || selectedDate).year()
                            const startY = moment(startTime).year()
                            const endY = moment(endTime).year()
                            const years = []
                            for(let y=startY; y<=endY; y++) years.push(y)

                            return (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <select 
                                        className="date-select" 
                                        value={currentMonth.toString().padStart(2, '0')} 
                                        onChange={(e) => setInputValue(`${currentYear}-${e.target.value}`)}
                                    >
                                        {moment.months().map((m, i) => <option key={m} value={(i+1).toString().padStart(2, '0')}>{m}</option>)}
                                    </select>
                                    <select 
                                        className="date-select" 
                                        value={currentYear} 
                                        onChange={(e) => setInputValue(`${e.target.value}-${currentMonth.toString().padStart(2, '0')}`)}
                                    >
                                        {years.map(y => <option key={y} value={y}>{y}</option>)}
                                    </select>
                                </div>
                            )
                        })()}

                        {timeMode === 'HOUR' && (() => {
                            const datePart = moment(inputValue || selectedDate).format('YYYY-MM-DD')
                            const timePart = moment(inputValue || selectedDate).format('HH:mm')
                            return (
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input 
                                        className="time-input-field" 
                                        type="date" 
                                        value={datePart} 
                                        onChange={e => setInputValue(`${e.target.value}T${timePart}`)} 
                                        min={moment(startTime).format('YYYY-MM-DD')}
                                        max={moment(endTime).format('YYYY-MM-DD')}
                                    />
                                    <input 
                                        className="time-input-field" 
                                        type="time" 
                                        value={timePart} 
                                        onChange={e => setInputValue(`${datePart}T${e.target.value}`)} 
                                    />
                                </div>
                            )
                        })()}

                        {timeMode === 'DAY' && (
                            <input
                                id="date-input"
                                type="date"
                                value={inputValue}
                                onChange={handleInputChange}
                                min={moment(startTime).format('YYYY-MM-DD')}
                                max={moment(endTime).format('YYYY-MM-DD')}
                                className="time-input-field"
                            />
                        )}

                        <button type="submit" className="date-submit-button">
                            Apply
                        </button>
                    </form>
                    <div className="date-range-info">
                        <small>Range</small>
                        <div className="date-range-dates">
                            {moment(startTime).format('MMM D, YYYY')} - {moment(endTime).format('MMM D, YYYY')}
                        </div>
                    </div>
                </div>
            </FloatingPopover>
        </div>
    )
}
