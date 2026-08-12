import React from 'react'

// Inline Material/USWDS glyphs — portable, no icon-font/sprite dependency.

function Icon({ children }: { children: React.ReactNode }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width={20}
            height={20}
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
        >
            {children}
        </svg>
    )
}

export function BasemapIcon() {
    return (
        <Icon>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
        </Icon>
    )
}
export function SearchIcon() {
    return (
        <Icon>
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
        </Icon>
    )
}
export function RulerIcon() {
    return (
        <Icon>
            <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z" />
        </Icon>
    )
}
export function PlusIcon() {
    return (
        <Icon>
            <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
        </Icon>
    )
}
export function MinusIcon() {
    return (
        <Icon>
            <path d="M19 13H5v-2h14v2z" />
        </Icon>
    )
}
