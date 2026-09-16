import DOMPurify from 'dompurify'
import { marked } from 'marked'

import './Markdown_.css'

/**
 * The one markdown renderer in the app.
 *
 * Authored text reaches the UI from several places — layer descriptions in a
 * mission config, help documents under public/helps — and every surface that
 * shows it renders through here, so a table looks the same in a modal as it
 * does in a panel and no caller can skip sanitizing.
 *
 * GFM covers what configuration authors reach for: tables, strikethrough,
 * autolinks, task lists. `breaks` treats a single newline as a line break,
 * which is how hand-wrapped descriptions are written.
 */
marked.use({ async: false, gfm: true, breaks: true })

/** Tags markdown can produce; anything else is dropped as markup. */
const ALLOWED_TAGS = [
    'p',
    'br',
    'strong',
    'em',
    'del',
    'code',
    'pre',
    'blockquote',
    'a',
    'img',
    'ul',
    'ol',
    'li',
    // GFM task lists render a disabled checkbox ahead of the item text.
    'input',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
]

const ALLOWED_ATTR = [
    'href',
    'src',
    'alt',
    'title',
    'align',
    'colspan',
    'rowspan',
    'type',
    'checked',
    'disabled',
]

/**
 * The class that styles rendered markdown. Put it on the element receiving the
 * html so the content picks up the shared typography.
 */
export const MARKDOWN_CLASS = 'mmgis-markdown'

/**
 * Whether a source string holds anything worth rendering.
 *
 * Callers gating a control on the presence of authored text — a disabled info
 * button, an omitted section — ask this instead of rendering and comparing
 * against an empty string. Whitespace counts as absent, which is how layers
 * without a description are constructed.
 *
 * A trim check rather than a parse: a source of only an HTML comment reports
 * as present and renders empty. Accepted rather than parsing twice to be exact
 * about input nobody writes.
 */
export const hasMarkdownContent = (
    markdown: string | null | undefined
): boolean => Boolean(markdown?.trim())

/**
 * Renders markdown to sanitized HTML.
 *
 * The output is safe to inject: DOMPurify strips scripts, event handlers, and
 * javascript: URLs, so authored text cannot execute. Returns an empty string
 * for empty input, which callers use to decide whether there is anything to
 * show.
 */
export const renderMarkdown = (markdown: string | null | undefined): string => {
    if (!markdown?.trim()) return ''

    const html = marked.parse(markdown) as string

    const safe = DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR })

    // Links leave for a new tab so following one doesn't navigate the map away,
    // and rel keeps the opener out of reach of wherever they point. Applied by
    // walking the sanitized markup rather than a DOMPurify hook, which would be
    // global and reach every other caller of the library.
    const container = document.createElement('div')
    container.innerHTML = safe
    container.querySelectorAll('a[href]').forEach((anchor) => {
        anchor.setAttribute('target', '_blank')
        anchor.setAttribute('rel', 'noopener noreferrer')
    })

    return container.innerHTML
}
