import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
// The Configure app is a separate bundle on React 17 with its own MUI, so the
// field renders with that React rather than the root one.
import React from '../../configure/node_modules/react'
import ReactDOM from '../../configure/node_modules/react-dom'
import { act } from '../../configure/node_modules/react-dom/test-utils'
import UploadField from '../../configure/src/core/components/UploadField'

// UploadField is upload-only with a square-cropped preview unless a field
// opts in: `allowUrl` adds a text box for pasting an image URL, and
// `previewFit: 'contain'` shows the preview at the image's own aspect ratio.
describe('UploadField', () => {
    let host

    beforeEach(() => {
        host = document.createElement('div')
        document.body.appendChild(host)
    })

    afterEach(() => {
        ReactDOM.unmountComponentAtNode(host)
        host.remove()
    })

    const render = (props) =>
        act(() => {
            ReactDOM.render(
                React.createElement(UploadField, {
                    label: 'Logo Image',
                    mission: 'Demo',
                    subdir: 'Branding',
                    base: '/',
                    ...props,
                }),
                host,
            )
        })

    const setInput = (input, text) => {
        const setter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value',
        ).set
        setter.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
    }

    const urlBox = () => host.querySelector('input:not([type="file"])')
    const buttonNamed = (name) =>
        [...host.querySelectorAll('button')].find(
            (b) => b.textContent === name,
        )

    describe('defaults', () => {
        test('has no URL box and a square-cropped preview', () => {
            render({ value: 'CardPlugin/uploads/a.png', onChange: vi.fn() })
            expect(urlBox()).toBeNull()
            const img = host.querySelector('img')
            expect(img.getAttribute('src')).toBe(
                '/Missions/Demo/CardPlugin/uploads/a.png',
            )
            expect(img.style.width).toBe('48px')
            expect(img.style.height).toBe('48px')
            expect(img.style.objectFit).toBe('cover')
        })
    })

    describe('previewFit: contain', () => {
        test('keeps the height and lets the width follow the image', () => {
            render({
                value: 'https://example.com/wide.png',
                previewFit: 'contain',
                onChange: vi.fn(),
            })
            const img = host.querySelector('img')
            expect(img.style.width).toBe('auto')
            expect(img.style.height).toBe('48px')
            expect(img.style.objectFit).toBe('contain')
        })
    })

    describe('allowUrl', () => {
        test('shows the stored value, including one set before uploads existed', () => {
            render({
                value: 'https://example.com/old-logo.png',
                allowUrl: true,
                onChange: vi.fn(),
            })
            expect(urlBox().value).toBe('https://example.com/old-logo.png')
        })

        test('commits the trimmed URL on blur, not on each keystroke', () => {
            const onChange = vi.fn()
            render({ value: '', allowUrl: true, onChange })
            act(() => setInput(urlBox(), '  https://example.com/l.svg  '))
            expect(onChange).not.toHaveBeenCalled()
            act(() => {
                urlBox().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
            })
            expect(onChange).toHaveBeenCalledTimes(1)
            expect(onChange).toHaveBeenCalledWith('https://example.com/l.svg')
        })

        test('does not fire onChange when the text is unchanged', () => {
            const onChange = vi.fn()
            render({ value: 'https://example.com/l.png', allowUrl: true, onChange })
            act(() => {
                urlBox().dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
            })
            expect(onChange).not.toHaveBeenCalled()
        })

        test('follows the value when an upload replaces it', () => {
            render({ value: 'https://example.com/l.png', allowUrl: true, onChange: vi.fn() })
            render({
                value: 'Branding/uploads/u.png',
                allowUrl: true,
                onChange: vi.fn(),
            })
            expect(urlBox().value).toBe('Branding/uploads/u.png')
        })

        test('Clear empties the stored value', () => {
            const onChange = vi.fn()
            render({ value: 'https://example.com/l.png', allowUrl: true, onChange })
            act(() => {
                buttonNamed('Clear').dispatchEvent(
                    new MouseEvent('click', { bubbles: true }),
                )
            })
            expect(onChange).toHaveBeenCalledWith('')
        })
    })
})
