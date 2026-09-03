import { test, expect } from 'vitest'

// The decision behind the 409 POST /api/deployments/:id/update answers with.
// It is a pure function of the row withLiveStatus produces, so it is tabled
// here directly — no Express harness, no AWS.

const {
    updateRefusalFor,
} = require('../../API/Backend/Deployments/updateRefusal')

test.describe('updateRefusalFor', () => {
    // [row status, live stack status, refusal message or null]
    const cases = [
        // A publish task killed before its error handler runs leaves the row
        // in `provisioning` forever. The live stack is what tells a task that
        // is really running from a row nobody is coming back to — and with no
        // stack at all there is nothing for an update to converge, so the
        // answer names the way out rather than sending anyone off to wait.
        [
            'provisioning',
            null,
            'Deployment is provisioning but has no stack; delete it and publish again.',
        ],
        [
            'provisioning',
            'CREATE_IN_PROGRESS',
            'Deployment is provisioning; wait for it to finish',
        ],
        ['provisioning', 'CREATE_COMPLETE', null],
        [
            'updating',
            null,
            'Deployment is updating but has no stack; delete it and publish again.',
        ],
        [
            'updating',
            'UPDATE_IN_PROGRESS',
            'Deployment is updating; wait for it to finish',
        ],
        ['updating', 'UPDATE_COMPLETE', null],
        ['updating', 'UPDATE_ROLLBACK_COMPLETE', null],
        // A delete owns the row from the moment it starts, and its stack looks
        // settled for most of the teardown (the bucket is emptied before
        // DeleteStack goes out) — so no stack status lets an update in.
        ['deleting', null, 'Deployment is deleting; wait for it to finish'],
        [
            'deleting',
            'DELETE_IN_PROGRESS',
            'Deployment is deleting; wait for it to finish',
        ],
        [
            'deleting',
            'CREATE_COMPLETE',
            'Deployment is deleting; wait for it to finish',
        ],
        ['deleted', null, 'Deployment was deleted; publish it again'],
        // Terminal rows are exactly what an update is for, whatever their
        // stack looks like — the publish task decides what to do with it.
        ['published', null, null],
        ['failed', 'ROLLBACK_COMPLETE', null],
    ]

    cases.forEach(([status, stackStatus, message]) => {
        test(`${status} on a ${stackStatus || 'missing'} stack`, () => {
            const refusal = updateRefusalFor({
                status,
                stack_status: stackStatus,
            })
            if (message == null) expect(refusal).toBe(null)
            else expect(refusal).toEqual({ message })
        })
    })

    // DescribeStacks failing (expired credentials, throttling) leaves
    // stack_status null for a reason that has nothing to do with the row.
    // Reporting it as "wait for it to finish" would send an operator waiting
    // on an operation that may not exist.
    test('a stack that could not be read is refused with the read error', () => {
        expect(
            updateRefusalFor({
                status: 'updating',
                stack_status: null,
                stack_status_error: 'Could not load credentials',
            })
        ).toEqual({
            message:
                "Could not read the deployment's stack: Could not load credentials",
        })
    })

    // A published row needs no live stack to be updated, so a failed read
    // doesn't stand in the way of one.
    test('a failed stack read does not block a published row', () => {
        expect(
            updateRefusalFor({
                status: 'published',
                stack_status: null,
                stack_status_error: 'Could not load credentials',
            })
        ).toBe(null)
    })
})
