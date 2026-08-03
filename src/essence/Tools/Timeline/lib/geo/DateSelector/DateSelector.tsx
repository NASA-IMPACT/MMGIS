import React, { useState, useRef } from 'react'
import moment from 'moment'
import { FloatingPopover } from '../../FloatingPopover'
import { TimeMode } from '../../types'
import { ChevronLeft, ChevronRight } from '../../icons/Chevron'
import { snapMonthToRange } from '../../utils/timeUtils'
import { DayCalendar } from './DayCalendar'

export interface DateSelectorProps {
    selectedDate: Date
    startTime: Date
    endTime: Date
    timeMode?: TimeMode
    onDateChange: (date: Date) => void
}

// The granularity each time mode selects; a picked value covers this whole
// interval, which is what range checking and clamping operate on.
const UNIT_BY_MODE: Record<TimeMode, moment.unitOfTime.StartOf> = {
    YEAR: 'year',
    MONTH: 'month',
    DAY: 'day',
    HOUR: 'minute',
}

export const DateSelector: React.FC<DateSelectorProps> = ({
    selectedDate,
    startTime,
    endTime,
    timeMode = 'DAY',
    onDateChange,
}) => {
    const [isOpen, setIsOpen] = useState(false)
    // YEAR and MONTH drive their own fields; DAY and HOUR use the native inputs.
    const [yearInput, setYearInput] = useState('')
    const [monthIndex, setMonthIndex] = useState(0)
    const [inputValue, setInputValue] = useState('')
    const [error, setError] = useState<string | null>(null)
    const buttonRef = useRef<HTMLButtonElement>(null)

    const minYear = moment(startTime).year()
    const maxYear = moment(endTime).year()

    // Format the selected date for display. Deliberately not formatDateByMode:
    // the axis labels a tick within a visible range and can stay terse, while
    // this reads on its own and always carries the year.
    let formattedDate = moment.utc(selectedDate).format('MMM D, YYYY')
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

    const handleDateClick = () => {
        const nextOpen = !isOpen
        setIsOpen(nextOpen)
        if (nextOpen) {
            const selected = moment(selectedDate)
            setYearInput(selected.format('YYYY'))
            setMonthIndex(selected.month())
            setInputValue(selected.format(getFormatPattern()))
            setError(null)
        }
    }

    // The year is only usable once all four digits are typed.
    const yearNumber = /^\d{4}$/.test(yearInput) ? parseInt(yearInput, 10) : NaN
    const hasYear = !Number.isNaN(yearNumber)

    // Every control applies its value straight away; the popover only closes on
    // a discrete pick (a month cell) or Enter, so typing isn't cut short.
    const commit = (candidate: moment.Moment, closeAfter = false) => {
        if (!candidate.isValid()) {
            setError('Enter a valid date')
            return
        }

        // A picked value stands for its whole unit (a year, a month, a day), so
        // it counts as in range when that unit overlaps the timeline at all.
        // Clamping to the boundary then keeps partially covered units usable
        // instead of rejecting them for starting before or after the range.
        const unit = UNIT_BY_MODE[timeMode]
        const unitStart = candidate.clone().startOf(unit).toDate()
        const unitEnd = candidate.clone().endOf(unit).toDate()
        if (unitEnd < startTime || unitStart > endTime) {
            setError('Date must be within the timeline range')
            return
        }

        let date = candidate.toDate()
        if (date < startTime) date = new Date(startTime)
        if (date > endTime) date = new Date(endTime)

        setError(null)
        onDateChange(date)
        if (closeAfter) setIsOpen(false)
    }

    const commitYearMonth = (year: number, month: number, closeAfter = false) => {
        if (timeMode !== 'MONTH') {
            commit(moment({ year, month: 0, day: 1 }), closeAfter)
            return
        }
        const snapped = snapMonthToRange(year, month, startTime, endTime)
        if (snapped !== month) setMonthIndex(snapped)
        commit(moment({ year, month: snapped, day: 1 }), closeAfter)
    }

    const commitHour = (datePart: string, timePart: string) => {
        // Either half can be momentarily empty while being edited.
        if (!datePart || !timePart) return
        let candidate = moment(`${datePart}T${timePart}`)
        if (!candidate.isValid()) {
            setError('Enter a valid date')
            return
        }

        // The first and last day of the range are only partly covered, so a time
        // that falls off the edge of an otherwise valid day snaps to the
        // boundary rather than being refused.
        const day = candidate.clone()
        if (candidate.toDate() < startTime && day.endOf('day').toDate() >= startTime) {
            candidate = moment(startTime)
        } else if (
            candidate.toDate() > endTime &&
            day.startOf('day').toDate() <= endTime
        ) {
            candidate = moment(endTime)
        }

        setInputValue(candidate.format('YYYY-MM-DDTHH:mm'))
        setError(null)
        commit(candidate)
    }

    const handleYearChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const digits = e.target.value.replace(/\D/g, '').slice(0, 4)
        setYearInput(digits)
        setError(null)
        if (/^\d{4}$/.test(digits)) {
            commitYearMonth(parseInt(digits, 10), monthIndex)
        }
    }

    const handleYearBlur = () => {
        if (!hasYear) return
        const clamped = Math.min(maxYear, Math.max(minYear, yearNumber))
        if (clamped === yearNumber) return
        setYearInput(String(clamped).padStart(4, '0'))
        commitYearMonth(clamped, monthIndex)
    }

    const stepYear = (delta: number) => {
        const base = hasYear ? yearNumber : moment(selectedDate).year()
        const next = Math.min(maxYear, Math.max(minYear, base + delta))
        setYearInput(String(next).padStart(4, '0'))
        commitYearMonth(next, monthIndex)
    }

    const handleMonthClick = (month: number) => {
        setMonthIndex(month)
        if (!hasYear) {
            setError('Enter a 4-digit year')
            return
        }
        commitYearMonth(yearNumber, month, true)
    }

    // A month is selectable when any part of it falls inside the timeline range.
    const isMonthInRange = (month: number) => {
        if (!hasYear) return true
        const start = moment({ year: yearNumber, month, day: 1 })
        return (
            start.clone().endOf('month').toDate() >= startTime &&
            start.toDate() <= endTime
        )
    }

    const handleInputSubmit = (e: React.FormEvent) => {
        e.preventDefault()

        if (timeMode === 'YEAR' || timeMode === 'MONTH') {
            if (!hasYear) {
                setError('Enter a 4-digit year')
                return
            }
            commitYearMonth(yearNumber, monthIndex, true)
        } else {
            commit(moment(inputValue), true)
        }
    }

    const yearField = (
        <div className="date-field">
            <button
                type="button"
                className="date-step-button"
                onClick={() => stepYear(-1)}
                disabled={hasYear && yearNumber <= minYear}
                aria-label="Previous year"
            >
                <ChevronLeft />
            </button>
            <input
                className="date-field-input"
                type="text"
                inputMode="numeric"
                pattern="\d{4}"
                maxLength={4}
                size={4}
                value={yearInput}
                onChange={handleYearChange}
                onBlur={handleYearBlur}
                placeholder="YYYY"
                aria-label="Year"
            />
            <button
                type="button"
                className="date-step-button"
                onClick={() => stepYear(1)}
                disabled={hasYear && yearNumber >= maxYear}
                aria-label="Next year"
            >
                <ChevronRight />
            </button>
        </div>
    )

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
                <div className="date-selector-dropdown">
                    <form
                        onSubmit={handleInputSubmit}
                        className="date-input-form"
                        aria-labelledby="date-picker-title"
                    >
                        <div className="date-picker-title" id="date-picker-title">
                            {popoverTitle}
                        </div>

                        {timeMode === 'YEAR' && yearField}

                        {timeMode === 'MONTH' && (
                            <>
                                {yearField}
                                <div className="month-grid" role="group" aria-label="Month">
                                    {moment.monthsShort().map((label, i) => {
                                        const inRange = isMonthInRange(i)
                                        return (
                                            <button
                                                key={label}
                                                type="button"
                                                className={`month-grid-cell${
                                                    i === monthIndex
                                                        ? ' month-grid-cell--selected'
                                                        : ''
                                                }`}
                                                disabled={!inRange}
                                                aria-pressed={i === monthIndex}
                                                onClick={() => handleMonthClick(i)}
                                            >
                                                {label}
                                            </button>
                                        )
                                    })}
                                </div>
                            </>
                        )}

                        {timeMode === 'HOUR' && (() => {
                            const current = moment(inputValue || selectedDate)
                            const datePart = current.format('YYYY-MM-DD')
                            const timePart = current.format('HH:mm')
                            return (
                                <>
                                    <DayCalendar
                                        value={current.toDate()}
                                        startTime={startTime}
                                        endTime={endTime}
                                        onSelect={(date) =>
                                            commitHour(
                                                moment(date).format('YYYY-MM-DD'),
                                                timePart
                                            )
                                        }
                                    />
                                    <input
                                        className="time-input-field"
                                        type="time"
                                        value={timePart}
                                        onChange={e => commitHour(datePart, e.target.value)}
                                        aria-label="Time"
                                    />
                                </>
                            )
                        })()}

                        {timeMode === 'DAY' && (
                            <DayCalendar
                                value={selectedDate}
                                startTime={startTime}
                                endTime={endTime}
                                onSelect={(date) => commit(moment(date), true)}
                            />
                        )}

                        {error && (
                            <div className="date-input-error" role="alert">
                                {error}
                            </div>
                        )}
                    </form>
                </div>
            </FloatingPopover>
        </div>
    )
}
