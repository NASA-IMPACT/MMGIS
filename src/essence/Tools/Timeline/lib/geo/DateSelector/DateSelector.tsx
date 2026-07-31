import React from 'react'
import moment from 'moment'
import { TimeMode } from '../../types'

export interface DateSelectorProps {
    selectedDate: Date
    startTime: Date
    endTime: Date
    timeMode?: TimeMode
    onDateChange: (date: Date) => void
}

/**
 * Placeholder for the date selector. Shows the selected date as static text;
 * the picker dropdown, month grid and day calendar arrive with the date
 * selector PR of this stack.
 */
export const DateSelector: React.FC<DateSelectorProps> = ({ selectedDate }) => {
    return (
        <div className="date-selector">
            <span className="date-text">
                {moment.utc(selectedDate).format('MMM D, YYYY')}
            </span>
        </div>
    )
}
