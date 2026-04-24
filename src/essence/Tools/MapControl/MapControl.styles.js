import React from 'react'

const FONT_FAMILY =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif"

export const defaultTheme = {
    surface: '#fff',
    primary: '#1a73e8',
    text: '#202124',
    textMuted: '#5f6368',
    textHint: '#9aa0a6',
    divider: 'rgba(0,0,0,0.12)',
    surfaceHighlight: '#e8f0fe',
    shadow: '0 1px 6px rgba(0,0,0,0.25)',
    shadowLg: '0 2px 12px rgba(0,0,0,0.2)',
    fontFamily: FONT_FAMILY,
    radius: 8,
    radiusSm: 4,
}

export function resolveTheme(overrides) {
    if (!overrides) return defaultTheme
    return { ...defaultTheme, ...overrides }
}

export const MEASURE_STYLE = {
    color: '#202124',
    weight: 2,
    opacity: 1,
    dashArray: '2 6',
    lineCap: 'round',
    radius: 4,
    fillColor: '#202124',
    fillOpacity: 1,
}

const Icon = ({ size = 18, children }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="currentColor"
    >
        {children}
    </svg>
)

export const BasemapIcon = (props) => (
    <Icon {...props}>
        <path d="m20.5 3-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z" />
    </Icon>
)

export const PlusIcon = (props) => (
    <Icon {...props}>
        <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </Icon>
)

export const MinusIcon = (props) => (
    <Icon {...props}>
        <path d="M19 13H5v-2h14v2z" />
    </Icon>
)

export const RulerIcon = (props) => (
    <Icon {...props}>
        <path d="M21 6H3c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 10H3V8h2v4h2V8h2v4h2V8h2v4h2V8h2v4h2V8h2v8z" />
    </Icon>
)

const GRADIENTS = {
    streets: 'linear-gradient(135deg,#f0ebe0,#ddd0b8,#bca888)',
    satellite: 'linear-gradient(135deg,#0c1f2e,#163b20,#0a2e0a)',
    outdoors: 'linear-gradient(135deg,#e0f5c8,#88c458,#4a8030)',
    light: 'linear-gradient(135deg,#fff,#ebebeb,#d4d4d4)',
    dark: 'linear-gradient(135deg,#2c2c3a,#1a1a28,#0c0c18)',
    terrain: 'linear-gradient(135deg,#d4edbc,#6ab040,#3d6e28)',
    liberty: 'linear-gradient(135deg,#f5e6ca,#d4a853,#8b7355)',
    bright: 'linear-gradient(135deg,#dff0fb,#93cce8,#4a9ec4)',
    positron: 'linear-gradient(135deg,#f8f8f8,#e0e0e0,#b8b8b8)',
}
const DEFAULT_BG = 'linear-gradient(135deg,#4a90d9,#2a6db8,#1450a0)'

export function bg(name) {
    const k = (name || '').toLowerCase()
    const m = Object.entries(GRADIENTS).find(([key]) => k.includes(key))
    return m ? m[1] : DEFAULT_BG
}

export function createStyles(theme) {
    return {
        root: (rightOffset) => ({
            position: 'absolute',
            top: 12,
            right: rightOffset,
            zIndex: 1002,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            pointerEvents: 'auto',
            fontFamily: theme.fontFamily,
        }),
        bar: {
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            background: theme.surface,
            borderRadius: theme.radius,
            overflow: 'hidden',
            boxShadow: theme.shadow,
        },
        barBtn: (active, hasBg) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 36,
            height: 36,
            padding: 0,
            border: 'none',
            cursor: 'pointer',
            background: hasBg || 'transparent',
            position: 'relative',
            color: hasBg ? theme.surface : theme.text,
            outline: active ? `2px solid ${theme.primary}` : 'none',
            outlineOffset: -2,
        }),
        divider: {
            width: 1,
            height: 24,
            background: theme.divider,
            alignSelf: 'center',
        },
        panel: {
            marginTop: 6,
            background: theme.surface,
            borderRadius: theme.radius,
            overflow: 'hidden',
            boxShadow: theme.shadowLg,
            minWidth: 220,
            display: 'flex',
            flexDirection: 'column',
        },
        panelHeader: {
            padding: '10px 12px 6px',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 0.8,
            textTransform: 'uppercase',
            color: theme.textHint,
        },
        row: (active) => ({
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            padding: '8px 12px',
            background: active ? theme.surfaceHighlight : 'transparent',
            border: 'none',
            cursor: 'pointer',
            width: '100%',
            textAlign: 'left',
        }),
        rowLabel: (active) => ({
            fontSize: 14,
            fontWeight: active ? 600 : 500,
            color: active ? theme.primary : theme.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
        }),
        rowThumb: (gradient, active) => ({
            width: 44,
            height: 28,
            borderRadius: theme.radiusSm,
            flexShrink: 0,
            background: gradient,
            border: active
                ? `2px solid ${theme.primary}`
                : '2px solid transparent',
            boxShadow: active
                ? `0 0 0 1px ${theme.primary}`
                : '0 1px 2px rgba(0,0,0,0.15)',
        }),
        readoutHint: {
            marginTop: 6,
            alignSelf: 'flex-end',
            background: theme.surface,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            padding: '8px 14px',
            fontSize: 12,
            fontWeight: 500,
            color: theme.textMuted,
        },
        measureLabel: (pixel) => ({
            position: 'absolute',
            left: pixel.x,
            top: pixel.y,
            transform: 'translate(-50%, -50%)',
            background: theme.surface,
            borderRadius: theme.radius,
            boxShadow: theme.shadow,
            padding: '6px 10px',
            fontSize: 12,
            fontWeight: 600,
            color: theme.primary,
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 1003,
            fontFamily: theme.fontFamily,
        }),
    }
}
