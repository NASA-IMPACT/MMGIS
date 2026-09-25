import { test, expect } from 'vitest'

// Tests for a dashboard's own credential, `settings.auth`: what the routes
// store from a request body, that a row never serializes its password, and
// that the auth Function checks the credential. The model's statics are
// stubbed on the shared module; no database and no real AWS is touched.

const Deployments = require('../../API/Backend/Deployments/models/deployment')
const { authFromBody, claimForUpdate } = require('../../API/Backend/Deployments/routes/deployments')
const { renderAuthFunctionCode } = require('../../scripts/lib/cfn-template')

const STATUS = Deployments.STATUS
const stored = { username: 'old', password: 'p' }
let savedUpdate

test.beforeEach(() => {
    savedUpdate = Deployments.update
})

test.afterEach(() => {
    Deployments.update = savedUpdate
})

test.describe('authFromBody', () => {
    test('a username and password become the credential', () => {
        expect(authFromBody({ username: 'u', password: 'p' })).toEqual({ username: 'u', password: 'p' })
    })

    test('a password alone has no username key', () => {
        expect(authFromBody({ password: 'p' })).toEqual({ password: 'p' })
    })

    test('no password sets nothing', () => {
        expect(authFromBody({ username: 'u' })).toBeUndefined()
        expect(authFromBody({})).toBeUndefined()
    })

    test('a blank password keeps the stored one', () => {
        expect(authFromBody({ username: 'new', password: '' }, stored)).toEqual({ username: 'new', password: 'p' })
    })

    test('removePassword clears the credential', () => {
        expect(authFromBody({ removePassword: true }, stored)).toBeNull()
    })
})

test.describe('claimForUpdate stores the credential', () => {
    function claimWith(body) {
        let written
        Deployments.update = async (values) => {
            written = values
            return [1]
        }
        const row = { id: 1, status: STATUS.PUBLISHED, settings: { bucket: 'b', auth: stored } }
        return claimForUpdate(row, body).then(() => written.settings)
    }

    test('removePassword stores null and keeps other settings', async () => {
        const settings = await claimWith({ removePassword: true })
        expect(settings.auth).toBeNull()
        expect(settings.bucket).toBe('b')
    })

    test('no body leaves auth untouched', async () => {
        expect((await claimWith()).auth).toEqual(stored)
    })
})

test('a row never serializes its password', () => {
    const row = Deployments.build({ name: 'n', mission: 'm', settings: { bucket: 'b', auth: { username: 'u', password: 'x' } } })
    expect(row.toJSON().settings).toEqual({ bucket: 'b', auth: { username: 'u' } })
    expect(row.settings.auth.password).toBe('x')
    expect(Deployments.build({ name: 'n', mission: 'm', settings: { auth: null } }).toJSON().settings).toEqual({ auth: null })
})

test('the auth Function checks the dashboard username, mmgis by default', () => {
    const basic = (credential) => `Basic ${Buffer.from(credential).toString('base64')}`
    expect(renderAuthFunctionCode('pw', true, 'alice')).toContain(basic('alice:pw'))
    expect(renderAuthFunctionCode('pw', true)).toContain(basic('mmgis:pw'))
})
