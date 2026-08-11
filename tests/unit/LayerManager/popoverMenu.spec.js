import { describe, test, expect, beforeEach, afterEach } from 'vitest'
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { PopoverMenu } from '../../../src/essence/Tools/LayerManager/lib/geo/PopoverMenu/PopoverMenu.tsx'

/**
 * PopoverMenu is the list of actions a popover surface shows. Placement,
 * dismissal and focus restoration belong to FloatingPopover, so what is tested
 * here is only the list: what it renders, and how keys move through it.
 */

// React needs to be told this is a test environment before act() will run.
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('PopoverMenu', () => {
    let container
    let root

    beforeEach(() => {
        container = document.createElement('div')
        document.body.appendChild(container)
        root = createRoot(container)
    })

    afterEach(() => {
        act(() => root.unmount())
        container.remove()
    })

    const render = (items, onSelect) => {
        act(() => {
            root.render(React.createElement(PopoverMenu, { items, onSelect }))
        })
    }

    const itemsOf = () =>
        Array.from(container.querySelectorAll('[role="menuitem"]'))

    const press = (element, key) => {
        act(() => {
            element.dispatchEvent(
                new window.KeyboardEvent('keydown', { key, bubbles: true }),
            )
        })
    }

    const focus = (element) => {
        act(() => element.focus())
    }

    const click = (element) => {
        act(() => {
            element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
        })
    }

    const item = (id, overrides = {}) => ({
        id,
        label: id,
        onSelect: () => {},
        ...overrides,
    })

    test('renders one menuitem per item, inside a menu', () => {
        render([item('first'), item('second')])

        expect(container.querySelector('[role="menu"]')).not.toBeNull()
        expect(itemsOf().map((el) => el.textContent)).toEqual([
            'first',
            'second',
        ])
    })

    test('draws a separator above an item that asks for one', () => {
        render([item('first'), item('second', { dividerBefore: true })])

        const separators = container.querySelectorAll('[role="separator"]')
        expect(separators).toHaveLength(1)
        expect(separators[0].nextElementSibling.textContent).toBe('second')
    })

    test('selecting an item runs its action, then dismisses the menu', () => {
        const order = []
        render(
            [item('first', { onSelect: () => order.push('action') })],
            () => order.push('dismiss'),
        )

        click(itemsOf()[0])

        expect(order).toEqual(['action', 'dismiss'])
    })

    test('a disabled item neither acts nor dismisses', () => {
        const order = []
        render(
            [
                item('first', {
                    disabled: true,
                    onSelect: () => order.push('action'),
                }),
            ],
            () => order.push('dismiss'),
        )

        click(itemsOf()[0])
        press(itemsOf()[0], 'Enter')

        expect(order).toEqual([])
    })

    // Marked disabled through aria rather than the attribute, so the item stays
    // reachable and its title can explain why it leads nowhere.
    test('a disabled item stays focusable and carries its explanation', () => {
        render([item('first', { disabled: true, title: 'nothing to do' })])

        const [first] = itemsOf()
        expect(first.getAttribute('aria-disabled')).toBe('true')
        expect(first.getAttribute('title')).toBe('nothing to do')
        expect(first.hasAttribute('disabled')).toBe(false)

        first.focus()
        expect(document.activeElement).toBe(first)
    })

    test('arrow keys move focus through the list', () => {
        render([item('first'), item('second'), item('third')])
        const [first, second, third] = itemsOf()

        first.focus()
        press(first, 'ArrowDown')
        expect(document.activeElement).toBe(second)

        press(second, 'ArrowDown')
        expect(document.activeElement).toBe(third)

        press(third, 'ArrowUp')
        expect(document.activeElement).toBe(second)
    })

    test('arrowing past either end wraps', () => {
        render([item('first'), item('second'), item('third')])
        const [first, , third] = itemsOf()

        first.focus()
        press(first, 'ArrowUp')
        expect(document.activeElement).toBe(third)

        press(third, 'ArrowDown')
        expect(document.activeElement).toBe(first)
    })

    test('Home and End jump to the ends', () => {
        render([item('first'), item('second'), item('third')])
        const [first, second, third] = itemsOf()

        second.focus()
        press(second, 'End')
        expect(document.activeElement).toBe(third)

        press(third, 'Home')
        expect(document.activeElement).toBe(first)
    })

    // A menu holds a single tab stop, so Tab leaves it rather than walking its
    // items; arrowing is what moves between them.
    test('holds one tab stop, which follows focus', () => {
        render([item('first'), item('second'), item('third')])
        const [first, second, third] = itemsOf()

        const tabIndices = () =>
            itemsOf().map((el) => el.getAttribute('tabindex'))
        expect(tabIndices()).toEqual(['0', '-1', '-1'])

        first.focus()
        press(first, 'ArrowDown')
        expect(document.activeElement).toBe(second)
        expect(tabIndices()).toEqual(['-1', '0', '-1'])

        press(second, 'End')
        expect(document.activeElement).toBe(third)
        expect(tabIndices()).toEqual(['-1', '-1', '0'])
    })

    // The tab stop is held by index, and the list it indexes into can get
    // shorter while the menu is open.
    test('keeps a tab stop when the list shrinks under it', () => {
        render([item('first'), item('second')])
        focus(itemsOf()[1])
        expect(itemsOf()[1].getAttribute('tabindex')).toBe('0')

        render([item('first')])

        expect(itemsOf().map((el) => el.getAttribute('tabindex'))).toEqual(['0'])
    })

    // Arrowing steps onto a disabled item rather than over it, so the one entry
    // whose absence needs explaining is the one a keyboard user can still reach.
    test('arrow keys land on a disabled item', () => {
        render([item('first'), item('second', { disabled: true })])
        const [first, second] = itemsOf()

        first.focus()
        press(first, 'ArrowDown')
        expect(document.activeElement).toBe(second)
    })
})
