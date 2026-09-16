import { test, expect } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
    renderMarkdown,
    hasMarkdownContent,
    MARKDOWN_CLASS,
} from '../../src/essence/Basics/Markdown_/Markdown_.ts'
import { Markdown } from '../../src/essence/Basics/Markdown_/Markdown.tsx'
import * as markdownSdk from '../../src/essence/Tools/_shared/content/markdown.ts'

test.describe('renderMarkdown', () => {
    test('returns empty string for missing or blank descriptions', () => {
        expect(renderMarkdown(null)).toBe('')
        expect(renderMarkdown(undefined)).toBe('')
        expect(renderMarkdown('   \n  ')).toBe('')
    })

    test('renders plain text as a paragraph', () => {
        expect(renderMarkdown('Just a description.')).toContain(
            '<p>Just a description.</p>',
        )
    })

    test('renders emphasis, strong, and strikethrough', () => {
        const html = renderMarkdown('**bold** *italic* ~~struck~~')
        expect(html).toContain('<strong>bold</strong>')
        expect(html).toContain('<em>italic</em>')
        expect(html).toContain('<del>struck</del>')
    })

    test('renders a GFM table with a header row', () => {
        const html = renderMarkdown(
            ['| S.NO | Header |', '|------|--------|', '| 1 | Cell |'].join('\n'),
        )
        expect(html).toContain('<table>')
        expect(html).toContain('<th>S.NO</th>')
        expect(html).toContain('<td>1</td>')
    })

    test('renders headings, lists, and inline code', () => {
        const html = renderMarkdown('# Title\n\n- one\n- two\n\n`code`')
        expect(html).toContain('<h1>Title</h1>')
        expect(html).toContain('<li>one</li>')
        expect(html).toContain('<code>code</code>')
    })

    test('keeps single newlines as line breaks', () => {
        expect(renderMarkdown('line one\nline two')).toContain('<br>')
    })

    test('sends links to a new tab with a safe rel', () => {
        const html = renderMarkdown('[NASA](https://nasa.gov)')
        expect(html).toContain('href="https://nasa.gov"')
        expect(html).toContain('target="_blank"')
        expect(html).toContain('rel="noopener noreferrer"')
    })

    test('renders GFM task lists as checkboxes', () => {
        const html = renderMarkdown('- [x] done\n- [ ] todo')
        expect(html).toContain('<input')
        expect(html).toContain('type="checkbox"')
        expect(html).toContain('disabled')
    })

    test('keeps images', () => {
        expect(renderMarkdown('![alt](pic.png)')).toContain('src="pic.png"')
    })

    test('strips scripts, event handlers, and javascript: urls', () => {
        const html = renderMarkdown(
            [
                '<script>alert(1)</script>',
                '<img src=x onerror="alert(1)">',
                '<p onclick="alert(1)">click</p>',
                '[bad](javascript:alert(1))',
            ].join('\n\n'),
        )
        expect(html).not.toContain('<script')
        expect(html).not.toContain('onerror')
        expect(html).not.toContain('onclick')
        expect(html).not.toContain('javascript:')
    })
})

test.describe('hasMarkdownContent', () => {
    test('reports absent for missing or blank sources', () => {
        expect(hasMarkdownContent(null)).toBe(false)
        expect(hasMarkdownContent(undefined)).toBe(false)
        expect(hasMarkdownContent('')).toBe(false)
        expect(hasMarkdownContent('   \n  ')).toBe(false)
    })

    test('reports present for text', () => {
        expect(hasMarkdownContent('A description.')).toBe(true)
        expect(hasMarkdownContent('# Heading')).toBe(true)
    })

    // The one input the predicate and the renderer disagree on, pinned so the
    // divergence stays deliberate.
    test('reports present for a source that renders to nothing', () => {
        expect(hasMarkdownContent('<!-- note -->')).toBe(true)
        expect(renderMarkdown('<!-- note -->')).toBe('')
    })
})

test.describe('Markdown', () => {
    const render = (props) =>
        renderToStaticMarkup(createElement(Markdown, props))

    test('renders nothing without a source', () => {
        expect(render({ source: null })).toBe('')
        expect(render({ source: undefined })).toBe('')
        expect(render({ source: '   \n ' })).toBe('')
    })

    test('carries the shared class alone by default', () => {
        expect(render({ source: 'Text.' })).toContain(
            `class="${MARKDOWN_CLASS}"`,
        )
    })

    test('appends a caller class to the shared one', () => {
        expect(render({ source: 'Text.', className: 'custom' })).toContain(
            `class="${MARKDOWN_CLASS} custom"`,
        )
    })

    test('renders markdown as sanitized html', () => {
        const html = render({ source: '**bold**\n\n<script>alert(1)</script>' })
        expect(html).toContain('<strong>bold</strong>')
        expect(html).not.toContain('<script')
    })
})

test.describe('plugin SDK', () => {
    test('reaches plugins only as a component, never as a raw renderer', () => {
        expect(markdownSdk.Markdown).toBe(Markdown)
        expect(markdownSdk.hasMarkdownContent).toBe(hasMarkdownContent)
        // Withheld on purpose: a plugin holding the html string owns injecting
        // it, and can drop the shared class or mix it with markup that never
        // passed the sanitizer.
        expect(Object.keys(markdownSdk).sort()).toEqual([
            'Markdown',
            'hasMarkdownContent',
        ])
    })
})
