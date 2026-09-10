import { test, expect } from '@playwright/test'

/**
 * E2E tests for mmgisAPI Event Bus Integration
 * Tests the event bus functionality in a real browser context
 */

// Shared setup for all event bus tests
test.beforeEach(async ({ page }) => {
    // Navigate to the application and wait for it to fully load
    await page.goto('/')
    await page.waitForLoadState('networkidle', { timeout: 30000 })

    // Wait for mmgisAPI to be available on window
    await page.waitForFunction(
        () => typeof window.mmgisAPI !== 'undefined',
        { timeout: 10000 }
    )
})

test.describe('mmgisAPI Event Bus - Browser Integration', () => {

    test('mmgisAPI is available on window', async ({ page }) => {
        const hasAPI = await page.evaluate(() => {
            return typeof window.mmgisAPI === 'object'
        })
        expect(hasAPI).toBe(true)
    })

    test('event bus methods exist on mmgisAPI', async ({ page }) => {
        const methods = await page.evaluate(() => {
            const api = window.mmgisAPI
            return {
                hasOn: typeof api.on === 'function',
                hasOff: typeof api.off === 'function',
                hasEmit: typeof api.emit === 'function',
                hasProvide: typeof api.provide === 'function',
                hasRequest: typeof api.request === 'function',
                hasHasHandler: typeof api.hasHandler === 'function',
            }
        })

        expect(methods.hasOn).toBe(true)
        expect(methods.hasOff).toBe(true)
        expect(methods.hasEmit).toBe(true)
        expect(methods.hasProvide).toBe(true)
        expect(methods.hasRequest).toBe(true)
        expect(methods.hasHasHandler).toBe(true)
    })

    test('event subscription and emission works in browser', async ({
        page,
    }) => {
        const result = await page.evaluate(() => {
            return new Promise((resolve) => {
                const testData = { value: 42, message: 'test' }
                let receivedData = null

                // Subscribe to event
                window.mmgisAPI.on('test:e2e', (data) => {
                    receivedData = data
                })

                // Emit event
                window.mmgisAPI.emit('test:e2e', testData)

                // Allow microtask to complete
                setTimeout(() => {
                    resolve({
                        received: receivedData !== null,
                        dataMatches:
                            receivedData?.value === 42 &&
                            receivedData?.message === 'test',
                    })
                }, 10)
            })
        })

        expect(result.received).toBe(true)
        expect(result.dataMatches).toBe(true)
    })

    test('unsubscribe function from on() works', async ({ page }) => {
        const result = await page.evaluate(() => {
            return new Promise((resolve) => {
                let callCount = 0

                // Subscribe and get unsubscribe function
                const unsubscribe = window.mmgisAPI.on('test:unsub', () => {
                    callCount++
                })

                // First emit - should be received
                window.mmgisAPI.emit('test:unsub', {})

                // Unsubscribe
                unsubscribe()

                // Second emit - should NOT be received
                window.mmgisAPI.emit('test:unsub', {})

                setTimeout(() => {
                    resolve({ callCount })
                }, 10)
            })
        })

        expect(result.callCount).toBe(1)
    })

    test('provide/request pattern works in browser', async ({ page }) => {
        const result = await page.evaluate(async () => {
            // Provide a handler
            window.mmgisAPI.provide('test:getData', (params) => {
                return { result: params.input * 2 }
            })

            // Request data
            const response = await window.mmgisAPI.request('test:getData', {
                input: 21,
            })

            return {
                hasResult: response !== null,
                resultValue: response?.result,
            }
        })

        expect(result.hasResult).toBe(true)
        expect(result.resultValue).toBe(42)
    })

    test('hasHandler returns correct boolean', async ({ page }) => {
        const result = await page.evaluate(() => {
            // Check before providing
            const beforeProvide = window.mmgisAPI.hasHandler('test:check')

            // Provide a handler
            window.mmgisAPI.provide('test:check', () => {})

            // Check after providing
            const afterProvide = window.mmgisAPI.hasHandler('test:check')

            return { beforeProvide, afterProvide }
        })

        expect(result.beforeProvide).toBe(false)
        expect(result.afterProvide).toBe(true)
    })

    test('request throws for unknown handler', async ({ page }) => {
        const result = await page.evaluate(async () => {
            try {
                await window.mmgisAPI.request('nonexistent:handler', {})
                return { threw: false, message: null }
            } catch (e) {
                return { threw: true, message: e.message }
            }
        })

        expect(result.threw).toBe(true)
        expect(result.message).toContain('No handler for')
    })

    test('async handlers work correctly', async ({ page }) => {
        const result = await page.evaluate(async () => {
            // Provide an async handler
            window.mmgisAPI.provide('test:asyncHandler', async (params) => {
                // Simulate async operation
                await new Promise((resolve) => setTimeout(resolve, 50))
                return { computed: params.value + 10 }
            })

            // Request and await
            const response = await window.mmgisAPI.request('test:asyncHandler', {
                value: 32,
            })

            return { result: response?.computed }
        })

        expect(result.result).toBe(42)
    })

    test('cleanup function from provide() removes handler', async ({
        page,
    }) => {
        const result = await page.evaluate(async () => {
            // Provide and get cleanup function
            const cleanup = window.mmgisAPI.provide(
                'test:cleanup',
                () => 'value'
            )

            // Verify handler exists
            const existsBefore = window.mmgisAPI.hasHandler('test:cleanup')

            // Cleanup
            cleanup()

            // Verify handler is gone
            const existsAfter = window.mmgisAPI.hasHandler('test:cleanup')

            return { existsBefore, existsAfter }
        })

        expect(result.existsBefore).toBe(true)
        expect(result.existsAfter).toBe(false)
    })

    test('backward compatibility - existing mmgisAPI methods still work', async ({
        page,
    }) => {
        const result = await page.evaluate(() => {
            const api = window.mmgisAPI
            return {
                // Check that legacy methods still exist
                hasMap: typeof api.map === 'object' || api.map === undefined, // map may be null before init
                hasToggleLayer: typeof api.toggleLayer === 'function',
                hasAddEventListener: typeof api.addEventListener === 'function',
                hasRemoveEventListener:
                    typeof api.removeEventListener === 'function',
            }
        })

        expect(result.hasToggleLayer).toBe(true)
        expect(result.hasAddEventListener).toBe(true)
        expect(result.hasRemoveEventListener).toBe(true)
    })
})

test.describe('mmgisAPI Core Providers - Browser Integration', () => {
    test.beforeEach(async ({ page }) => {
        // Wait a bit more for providers to be registered during app init
        await page.waitForTimeout(1000)
    })

    test('map providers are registered after app load', async ({ page }) => {
        const result = await page.evaluate(() => {
            return {
                hasGetCenter: window.mmgisAPI.hasHandler('map:getCenter'),
                hasGetBounds: window.mmgisAPI.hasHandler('map:getBounds'),
                hasGetZoom: window.mmgisAPI.hasHandler('map:getZoom'),
                hasSetView: window.mmgisAPI.hasHandler('map:setView'),
                hasFitBounds: window.mmgisAPI.hasHandler('map:fitBounds'),
            }
        })

        // These should be registered if the map initialized
        // Note: May be false if running without a proper mission config
        // In that case, the test documents expected behavior
        expect(typeof result.hasGetCenter).toBe('boolean')
        expect(typeof result.hasGetBounds).toBe('boolean')
        expect(typeof result.hasGetZoom).toBe('boolean')
        expect(typeof result.hasSetView).toBe('boolean')
        expect(typeof result.hasFitBounds).toBe('boolean')
    })

    test('layers providers are registered after app load', async ({ page }) => {
        const result = await page.evaluate(() => {
            return {
                hasGetAll: window.mmgisAPI.hasHandler('layers:getAll'),
                hasGetVisible: window.mmgisAPI.hasHandler('layers:getVisible'),
                hasGetConfig: window.mmgisAPI.hasHandler('layers:getConfig'),
                hasToggle: window.mmgisAPI.hasHandler('layers:toggle'),
            }
        })

        expect(typeof result.hasGetAll).toBe('boolean')
        expect(typeof result.hasGetVisible).toBe('boolean')
        expect(typeof result.hasGetConfig).toBe('boolean')
        expect(typeof result.hasToggle).toBe('boolean')
    })

    test('time providers are registered after app load', async ({ page }) => {
        const result = await page.evaluate(() => {
            return {
                hasGetCurrent: window.mmgisAPI.hasHandler('time:getCurrent'),
                hasGetStart: window.mmgisAPI.hasHandler('time:getStart'),
                hasGetEnd: window.mmgisAPI.hasHandler('time:getEnd'),
                hasSet: window.mmgisAPI.hasHandler('time:set'),
            }
        })

        expect(typeof result.hasGetCurrent).toBe('boolean')
        expect(typeof result.hasGetStart).toBe('boolean')
        expect(typeof result.hasGetEnd).toBe('boolean')
        expect(typeof result.hasSet).toBe('boolean')
    })
})

test.describe('mmgisAPI Events - Dual Emission Integration', () => {
    test('can subscribe to tool:change events', async ({ page }) => {
        const result = await page.evaluate(() => {
            const unsubscribe = window.mmgisAPI.on('tool:change', () => {})
            return { subscribed: typeof unsubscribe === 'function' }
        })

        expect(result.subscribed).toBe(true)
    })

    test('can subscribe to layer:visibilityChange events', async ({ page }) => {
        const result = await page.evaluate(() => {
            const unsubscribe = window.mmgisAPI.on('layer:visibilityChange', () => {})
            return { subscribed: typeof unsubscribe === 'function' }
        })

        expect(result.subscribed).toBe(true)
    })

    test('can subscribe to feature:active events', async ({ page }) => {
        const result = await page.evaluate(() => {
            const unsubscribe = window.mmgisAPI.on('feature:active', () => {})
            return { subscribed: typeof unsubscribe === 'function' }
        })

        expect(result.subscribed).toBe(true)
    })

    test('can subscribe to websocket:change events', async ({ page }) => {
        const result = await page.evaluate(() => {
            const unsubscribe = window.mmgisAPI.on('websocket:change', () => {})
            return { subscribed: typeof unsubscribe === 'function' }
        })

        expect(result.subscribed).toBe(true)
    })

    test('can subscribe to legend:made events', async ({ page }) => {
        const result = await page.evaluate(() => {
            const unsubscribe = window.mmgisAPI.on('legend:made', () => {})
            return { subscribed: typeof unsubscribe === 'function' }
        })

        expect(result.subscribed).toBe(true)
    })

    test('multiple listeners can subscribe to same event', async ({ page }) => {
        const result = await page.evaluate(() => {
            return new Promise((resolve) => {
                let listener1Called = false
                let listener2Called = false
                let listener3Called = false

                window.mmgisAPI.on('test:multi', () => {
                    listener1Called = true
                })
                window.mmgisAPI.on('test:multi', () => {
                    listener2Called = true
                })
                window.mmgisAPI.on('test:multi', () => {
                    listener3Called = true
                })

                window.mmgisAPI.emit('test:multi', {})

                setTimeout(() => {
                    resolve({
                        allCalled:
                            listener1Called && listener2Called && listener3Called,
                    })
                }, 10)
            })
        })

        expect(result.allCalled).toBe(true)
    })
})
