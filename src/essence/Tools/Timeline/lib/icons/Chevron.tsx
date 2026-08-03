import React from 'react'

/** Step arrows shared by the date fields and the calendar's month/year nav. */

export const ChevronLeft: React.FC = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
    >
        <path d="M14.7 17.3L9.4 12L14.7 6.7L16.1 8.1L12.2 12L16.1 15.9L14.7 17.3Z" />
    </svg>
)

export const ChevronRight: React.FC = () => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden="true"
    >
        <path d="M9.3 6.7L14.6 12L9.3 17.3L7.9 15.9L11.8 12L7.9 8.1L9.3 6.7Z" />
    </svg>
)
