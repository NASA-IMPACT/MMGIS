import { test, expect } from 'vitest'

// Tests for the init-db boot-time connection retry helper.

const {
    isRetryableConnectionError,
    authenticateWithRetry,
} = require('../../scripts/init-db-retry.js')

test.describe('isRetryableConnectionError', () => {
    test('retries Node errnos on err.parent.code', () => {
        for (const code of ['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND']) {
            expect(isRetryableConnectionError({ parent: { code } })).toBe(true)
        }
    })

    test('retries Node errnos on err.original.code', () => {
        expect(
            isRetryableConnectionError({ original: { code: 'ECONNREFUSED' } })
        ).toBe(true)
    })

    test('retries Postgres connection SQLSTATEs (08* and 53300)', () => {
        expect(isRetryableConnectionError({ parent: { code: '08006' } })).toBe(
            true
        )
        expect(isRetryableConnectionError({ parent: { code: '53300' } })).toBe(
            true
        )
    })

    test('retries Sequelize connection-error class names', () => {
        expect(
            isRetryableConnectionError({
                name: 'SequelizeConnectionRefusedError',
                parent: { code: 'ECONNREFUSED' },
            })
        ).toBe(true)
        // DB still starting up: generic connection error with a
        // connection-ish parent code, or no parent code at all.
        expect(
            isRetryableConnectionError({
                name: 'SequelizeConnectionError',
                parent: { code: 'ECONNRESET' },
            })
        ).toBe(true)
        expect(
            isRetryableConnectionError({ name: 'SequelizeConnectionError' })
        ).toBe(true)
    })

    test('does not retry permission/config errors', () => {
        // insufficient_privilege
        expect(isRetryableConnectionError({ parent: { code: '42501' } })).toBe(
            false
        )
        // Bad credentials: the postgres dialect wraps auth failures in a
        // generic SequelizeConnectionError with SQLSTATE 28P01 in
        // parent.code (it never throws SequelizeAccessDeniedError).
        expect(
            isRetryableConnectionError({
                name: 'SequelizeConnectionError',
                parent: { code: '28P01' },
            })
        ).toBe(false)
        // invalid_authorization_specification
        expect(
            isRetryableConnectionError({
                name: 'SequelizeConnectionError',
                parent: { code: '28000' },
            })
        ).toBe(false)
        // Missing default database: invalid_catalog_name
        expect(
            isRetryableConnectionError({
                name: 'SequelizeConnectionError',
                parent: { code: '3D000' },
            })
        ).toBe(false)
        // database already exists
        expect(isRetryableConnectionError({ parent: { code: '42P04' } })).toBe(
            false
        )
    })

    test('does not retry null/empty errors', () => {
        expect(isRetryableConnectionError(null)).toBe(false)
        expect(isRetryableConnectionError({})).toBe(false)
        expect(isRetryableConnectionError(new Error('boom'))).toBe(false)
    })
})

test.describe('authenticateWithRetry', () => {
    function connectionRefused() {
        const err = new Error('connect ECONNREFUSED')
        err.name = 'SequelizeConnectionRefusedError'
        err.parent = { code: 'ECONNREFUSED' }
        return err
    }

    test('retries connection failures until success', async () => {
        let attempts = 0
        const fake = {
            authenticate: async () => {
                attempts++
                if (attempts < 3) throw connectionRefused()
            },
        }
        const retriesSeen = []
        await authenticateWithRetry(fake, {
            maxAttempts: 5,
            delayMs: 1,
            onRetry: (attempt) => retriesSeen.push(attempt),
        })
        expect(attempts).toBe(3)
        expect(retriesSeen).toEqual([1, 2])
    })

    test('throws after the attempt budget is exhausted', async () => {
        let attempts = 0
        const fake = {
            authenticate: async () => {
                attempts++
                throw connectionRefused()
            },
        }
        await expect(
            authenticateWithRetry(fake, { maxAttempts: 3, delayMs: 1 })
        ).rejects.toThrow('ECONNREFUSED')
        expect(attempts).toBe(3)
    })

    test('fails fast on non-connection errors without retrying', async () => {
        let attempts = 0
        const err = new Error('permission denied')
        err.parent = { code: '42501' }
        const fake = {
            authenticate: async () => {
                attempts++
                throw err
            },
        }
        await expect(
            authenticateWithRetry(fake, { maxAttempts: 5, delayMs: 1 })
        ).rejects.toThrow('permission denied')
        expect(attempts).toBe(1)
    })
})
