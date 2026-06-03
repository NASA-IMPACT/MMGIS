import React, { useState, useRef, useEffect } from 'react'
import moment from 'moment'

export interface DateSelectorProps {
    selectedDate: Date
    startTime: Date
    endTime: Date
    onDateChange: (date: Date) => void
}

export const DateSelector: React.FC<DateSelectorProps> = ({
    selectedDate,
    startTime,
    endTime,
    onDateChange,
}) => {
    const [isOpen, setIsOpen] = useState(false)
    const [inputValue, setInputValue] = useState('')
    const dropdownRef = useRef<HTMLDivElement>(null)

    // Format the selected date for display
    const formattedDate = moment(selectedDate).format('MMM, D YYYY')

    // Handle click outside to close dropdown
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false)
            }
        }

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside)
            return () => document.removeEventListener('mousedown', handleClickOutside)
        }
    }, [isOpen])

    const handleDateClick = () => {
        setIsOpen(!isOpen)
        setInputValue(moment(selectedDate).format('YYYY-MM-DD'))
    }

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value)
    }

    const handleInputSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        const newDate = moment(inputValue)

        if (newDate.isValid()) {
            const date = newDate.toDate()
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
        <div className="date-selector" ref={dropdownRef}>
            <div className="date-selector-display">
                <button
                    className="date-selector-main-button"
                    onClick={handleDateClick}
                    type="button"
                >
                    <i className="mdi mdi-calendar calendar-icon"></i>
                    <span className="date-text">{formattedDate}</span>
                </button>
                
                <div className="date-selector-divider"></div>
                
                <button className="compare-date-button" type="button">
                    Compare date
                </button>
            </div>

            {isOpen && (
                <div className="date-selector-dropdown">
                    <form onSubmit={handleInputSubmit} className="date-input-form">
                        <label htmlFor="date-input">Select Date:</label>
                        <input
                            id="date-input"
                            type="date"
                            value={inputValue}
                            onChange={handleInputChange}
                            min={moment(startTime).format('YYYY-MM-DD')}
                            max={moment(endTime).format('YYYY-MM-DD')}
                        />
                        <button type="submit" className="date-submit-button">
                            Go
                        </button>
                    </form>
                    <div className="date-range-info">
                        <small>
                            Range: {moment(startTime).format('MMM D, YYYY')} -{' '}
                            {moment(endTime).format('MMM D, YYYY')}
                        </small>
                    </div>
                </div>
            )}
        </div>
    )
}
