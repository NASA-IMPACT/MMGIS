// JSX in the bundle compiles to React.createElement, so React has to be in
// scope: the webpack build runs babel-preset-react-app's classic runtime.
// tsconfig's "jsx": "react-jsx" governs only tsc --noEmit and vitest transforms
// with the automatic runtime, so neither reflects how the app is built.
import React, { useMemo } from 'react'

import { MARKDOWN_CLASS, renderMarkdown } from './Markdown_'

export type MarkdownProps = {
    /** Authored markdown. Missing, empty, or blank renders nothing. */
    source?: string | null
    /** Extra classes for the wrapper, applied alongside the shared one. */
    className?: string
}

/**
 * Renders authored markdown as styled, sanitized HTML.
 *
 * The surface React callers and plugins use. Parsing, the sanitize policy, and
 * the shared typography class travel together here, so a caller supplies a
 * string and nothing else — there is no arrangement of props that yields
 * unsanitized or unstyled output.
 */
export function Markdown({ source, className }: MarkdownProps) {
    // Parsing is held per instance and keyed on the source, so re-rendering the
    // layer list doesn't re-parse rows whose description is unchanged.
    const html = useMemo(() => renderMarkdown(source), [source])

    if (!html) return null

    const classes = className
        ? `${MARKDOWN_CLASS} ${className}`
        : MARKDOWN_CLASS

    return (
        <div className={classes} dangerouslySetInnerHTML={{ __html: html }} />
    )
}
