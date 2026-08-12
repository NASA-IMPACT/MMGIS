import React from 'react'

/**
 * Inline Lucide icons (lucide.dev, ISC license) matching the reference
 * prototype's share menu; inlined so the lib carries no icon dependency.
 */

type IconProps = { className?: string }

const svgProps = {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
} as const

function Link2({ className }: IconProps) {
    return (
        <svg {...svgProps} className={className}>
            <path d="M9 17H7A5 5 0 0 1 7 7h2" />
            <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
            <line x1="8" x2="16" y1="12" y2="12" />
        </svg>
    )
}

function FileImage({ className }: IconProps) {
    return (
        <svg {...svgProps} className={className}>
            <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
            <path d="M14 2v5a1 1 0 0 0 1 1h5" />
            <circle cx="10" cy="12" r="2" />
            <path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22" />
        </svg>
    )
}

function Download({ className }: IconProps) {
    return (
        <svg {...svgProps} className={className}>
            <path d="M12 15V3" />
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
        </svg>
    )
}

/** Lucide icon name → component, keyed by the names getShareMenuItems emits. */
export const SHARE_MENU_ICONS: Record<
    string,
    (props: IconProps) => React.JSX.Element
> = {
    'link-2': Link2,
    'file-image': FileImage,
    download: Download,
}
