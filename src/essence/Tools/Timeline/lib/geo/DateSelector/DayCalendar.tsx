import React, { useEffect, useState } from 'react'
import moment from 'moment'
import { ChevronLeft, ChevronRight } from '../../icons/Chevron'
import { snapMonthToRange } from '../../utils/timeUtils'

export interface DayCalendarProps {
    value: Date
    startTime: Date
    endTime: Date
    onSelect: (date: Date) => void
}

export const DayCalendar: React.FC<DayCalendarProps> = ({
    value,
    startTime,
    endTime,
    onSelect,
}) => {
    const [viewMonth, setViewMonth] = useState(() => moment.utc(value).startOf('month'))

    // Walk real dates rather than counting from a table, so the month's length
    // follows the calendar itself — leap years and DST months included.
    const days: moment.Moment[] = []
    const lastDay = viewMonth.clone().endOf('month')
    for (
        const day = viewMonth.clone();
        day.isSameOrBefore(lastDay, 'day');
        day.add(1, 'day')
    ) {
        days.push(day.clone())
    }

    const isOutOfRange = (day: moment.Moment) =>
        day.clone().endOf('day').toDate() < startTime ||
        day.clone().startOf('day').toDate() > endTime

    const overlapsRange = (month: moment.Moment) =>
        month.clone().endOf('month').toDate() >= startTime &&
        month.toDate() <= endTime

    const yearTarget = (delta: number) => {
        const year = viewMonth.year() + delta
        if (year < moment.utc(startTime).year() || year > moment.utc(endTime).year()) return null
        const month = snapMonthToRange(year, viewMonth.month(), startTime, endTime)
        return moment.utc({ year, month, day: 1 })
    }

    // The month steps within its year, so neither control moves the other.
    const monthTarget = (delta: number) => {
        const month = viewMonth.month() + delta
        if (month < 0 || month > 11) return null
        const target = viewMonth.clone().month(month)
        return overlapsRange(target) ? target : null
    }

    const stepTo = (target: moment.Moment | null) => {
        if (target) setViewMonth(target)
    }

    // Both fields can be typed into as well as stepped. Text is held locally
    // while editing and re-synced from the view whenever an arrow moves it.
    const [yearText, setYearText] = useState(() => viewMonth.format('YYYY'))
    const [monthText, setMonthText] = useState(() => viewMonth.format('MMM'))

    useEffect(() => {
        setYearText(viewMonth.format('YYYY'))
        setMonthText(viewMonth.format('MMM'))
    }, [viewMonth])

    const handleYearInput = (text: string) => {
        const digits = text.replace(/\D/g, '').slice(0, 4)
        setYearText(digits)
        if (!/^\d{4}$/.test(digits)) return
        const year = parseInt(digits, 10)
        if (year < moment.utc(startTime).year() || year > moment.utc(endTime).year()) return
        const month = snapMonthToRange(year, viewMonth.month(), startTime, endTime)
        const target = moment.utc({ year, month, day: 1 })
        setViewMonth(target)
        // The year can push the month inside the covered range.
        setMonthText(target.format('MMM'))
    }

    // Accepts a month name, an abbreviation, or its number.
    const handleMonthInput = (text: string) => {
        setMonthText(text)
        const parsed = moment.utc(text.trim(), ['MMMM', 'MMM', 'MM', 'M'], true)
        if (!parsed.isValid()) return
        const target = viewMonth.clone().month(parsed.month())
        if (overlapsRange(target)) setViewMonth(target)
    }

    // An unparseable or out-of-range entry falls back to what's on screen.
    const resyncText = () => {
        setYearText(viewMonth.format('YYYY'))
        setMonthText(viewMonth.format('MMM'))
    }

    return (
        <div className="day-calendar">
            <div className="day-calendar-nav">
                <div className="date-field">
                    <button
                        type="button"
                        className="date-step-button"
                        onClick={() => stepTo(monthTarget(-1))}
                        disabled={!monthTarget(-1)}
                        aria-label="Previous month"
                    >
                        <ChevronLeft />
                    </button>
                    <input
                        className="date-field-input"
                        type="text"
                        // Without this the input asks for its default 20
                        // characters of width and stretches the popover.
                        size={4}
                        value={monthText}
                        onChange={(e) => handleMonthInput(e.target.value)}
                        onBlur={resyncText}
                        aria-label="Month"
                    />
                    <button
                        type="button"
                        className="date-step-button"
                        onClick={() => stepTo(monthTarget(1))}
                        disabled={!monthTarget(1)}
                        aria-label="Next month"
                    >
                        <ChevronRight />
                    </button>
                </div>

                <div className="date-field">
                    <button
                        type="button"
                        className="date-step-button"
                        onClick={() => stepTo(yearTarget(-1))}
                        disabled={!yearTarget(-1)}
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
                        value={yearText}
                        onChange={(e) => handleYearInput(e.target.value)}
                        onBlur={resyncText}
                        aria-label="Year"
                    />
                    <button
                        type="button"
                        className="date-step-button"
                        onClick={() => stepTo(yearTarget(1))}
                        disabled={!yearTarget(1)}
                        aria-label="Next year"
                    >
                        <ChevronRight />
                    </button>
                </div>
            </div>

            {/* Labels come from the same locale-aware week start the day columns
                are measured against, so both agree on which day begins a week. */}
            <div className="day-calendar-weekdays">
                {moment.weekdaysMin(true).map((label) => (
                    <span key={label} className="day-calendar-weekday">
                        {label}
                    </span>
                ))}
            </div>

            <div className="day-calendar-grid" role="group" aria-label="Day">
                {days.map((day) => {
                    const selected = day.isSame(value, 'day')
                    return (
                        <button
                            key={day.date()}
                            type="button"
                            className={`day-calendar-cell${
                                selected ? ' day-calendar-cell--selected' : ''
                            }`}
                            // Each date claims the column of its own weekday, so a
                            // cell sits under "We" because it is a Wednesday — no
                            // shared offset that could drift.
                            style={{
                                gridColumnStart:
                                    day.diff(day.clone().startOf('week'), 'days') + 1,
                            }}
                            disabled={isOutOfRange(day)}
                            aria-pressed={selected}
                            onClick={() => onSelect(day.toDate())}
                        >
                            {day.date()}
                        </button>
                    )
                })}
            </div>
        </div>
    )
}
