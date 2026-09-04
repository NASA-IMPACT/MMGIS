import { test, expect } from 'vitest'

// The decision behind the 409 POST /api/deployments/:id/update answers with.
// It is a pure function of the row withLiveStatus produces, so it is tabled
// here directly — no Express harness, no AWS.

const {
    updateRefusalFor,
} = require('../../API/Backend/Deployments/updateRefusal')
const STATUS = require('../../API/Backend/Deployments/models/deployment').STATUS

const NOW = Date.UTC(2026, 1, 1, 12, 0, 0)
const MINUTE = 60 * 1000
// Older than any task could still be running for, so a row carrying it is one
// a killed task left behind. Every case that is not about the row's age uses
// it, since a young row is refused whatever its stack says.
const ABANDONED = NOW - 6 * 60 * MINUTE
const ARN = 'arn:aws:cloudformation:us-west-2:111122223333:stack/x/abc'

const refusalFor = (row) =>
    updateRefusalFor({ updatedAt: ABANDONED, ...row }, STATUS, NOW)

test.describe('updateRefusalFor', () => {
    // [label, row, refusal message or null]
    const cases = [
        // A publish task killed before its error handler runs leaves the row
        // in `provisioning` forever. The live stack is what tells a task that
        // is really running from a row nobody is coming back to — and a row
        // whose stack ARN names a stack that is gone has nothing for an update
        // to converge, so the answer names the way out rather than sending
        // anyone off to wait.
        [
            'provisioning behind a stack that is gone',
            { status: 'provisioning', stack_status: null, stack_arn: ARN },
            'Deployment is provisioning but has no stack; delete the ' +
                'deployment and publish it again (this mints a new URL)',
        ],
        // Killed before CreateStack ever ran: no stack was minted, so no URL
        // is at stake and the update creates one.
        [
            'provisioning with no stack ever recorded',
            { status: 'provisioning', stack_status: null, stack_arn: null },
            null,
        ],
        [
            'provisioning mid-create',
            { status: 'provisioning', stack_status: 'CREATE_IN_PROGRESS' },
            'Deployment is provisioning; wait for it to finish',
        ],
        [
            'provisioning on a created stack',
            { status: 'provisioning', stack_status: 'CREATE_COMPLETE' },
            null,
        ],
        [
            'updating behind a stack that is gone',
            { status: 'updating', stack_status: null, stack_arn: ARN },
            'Deployment is updating but has no stack; delete the deployment ' +
                'and publish it again (this mints a new URL)',
        ],
        [
            'updating mid-update',
            { status: 'updating', stack_status: 'UPDATE_IN_PROGRESS' },
            'Deployment is updating; wait for it to finish',
        ],
        [
            'updating on a settled stack',
            { status: 'updating', stack_status: 'UPDATE_COMPLETE' },
            null,
        ],
        [
            'updating on a rolled-back stack',
            { status: 'updating', stack_status: 'UPDATE_ROLLBACK_COMPLETE' },
            null,
        ],
        // A settled stack only lets an update in once the row is old enough
        // that no task could still be working for it: a publish bakes and
        // builds for minutes before CloudFormation hears about it, and the
        // stack sits at its previous status the whole time.
        [
            'updating on a settled stack, minutes old',
            {
                status: 'updating',
                stack_status: 'UPDATE_COMPLETE',
                updatedAt: NOW - 5 * MINUTE,
            },
            'Deployment is updating; wait for it to finish',
        ],
        [
            'updating on a settled stack, hours old',
            {
                status: 'updating',
                stack_status: 'UPDATE_COMPLETE',
                updatedAt: NOW - 120 * MINUTE,
            },
            null,
        ],
        // An operation in flight that no update will ever be accepted after,
        // whatever it settles at: waiting it out gets the operator nowhere.
        [
            'provisioning behind a stack on its way out',
            {
                status: 'provisioning',
                stack_status: 'DELETE_IN_PROGRESS',
                stack_name: 'mmgis-dashboard-1',
            },
            "Stack 'mmgis-dashboard-1' is in DELETE_IN_PROGRESS and cannot be " +
                'used — delete the deployment and publish it again (this mints a new URL)',
        ],
        // A stack that settled somewhere no update will ever be accepted onto
        // earns the same way out as one still moving there — the row's age
        // never comes into it, since no amount of waiting makes CREATE_FAILED
        // updatable.
        [
            'provisioning on a stack whose create failed',
            {
                status: 'provisioning',
                stack_status: 'CREATE_FAILED',
                stack_name: 'mmgis-dashboard-1',
                updatedAt: NOW - 5 * MINUTE,
            },
            "Stack 'mmgis-dashboard-1' is in CREATE_FAILED and cannot be used " +
                '— delete the deployment and publish it again (this mints a new URL)',
        ],
        [
            'updating behind a rolling-back stack',
            {
                status: 'updating',
                stack_status: 'ROLLBACK_IN_PROGRESS',
                stack_name: 'mmgis-dashboard-1',
            },
            "Stack 'mmgis-dashboard-1' is in ROLLBACK_IN_PROGRESS and cannot " +
                'be used — delete the deployment and publish it again (this mints a new URL)',
        ],
        // A delete owns the row from the moment it starts, and its stack looks
        // settled for most of the teardown (the bucket is emptied before
        // DeleteStack goes out) — so no stack status lets an update in.
        [
            'deleting with no stack read',
            { status: 'deleting', stack_status: null },
            'Deployment is deleting; wait for it to finish',
        ],
        [
            'deleting mid-teardown',
            { status: 'deleting', stack_status: 'DELETE_IN_PROGRESS' },
            'Deployment is deleting; wait for it to finish',
        ],
        [
            'deleting with its stack still up',
            { status: 'deleting', stack_status: 'CREATE_COMPLETE' },
            'Deployment is deleting; wait for it to finish',
        ],
        [
            'deleted',
            { status: 'deleted', stack_status: null },
            'Deployment was deleted; publish it again',
        ],
        // A row that is not mid-operation is exactly what an update is for —
        // the publish task decides what to do with its stack.
        ['published', { status: 'published', stack_status: null }, null],
        // Unless that stack is one only a delete moves. Nothing about the row
        // makes CloudFormation accept an UpdateStack there, so a settled row
        // meets the same wall as a busy one rather than baking and building
        // for minutes into a rejection.
        [
            'failed on a stack that rolled back its create',
            {
                status: 'failed',
                stack_status: 'ROLLBACK_COMPLETE',
                stack_name: 'mmgis-dashboard-1',
            },
            "Stack 'mmgis-dashboard-1' is in ROLLBACK_COMPLETE and cannot be " +
                'used — delete the deployment and publish it again (this mints a new URL)',
        ],
        // A timestamp that will not parse says nothing about how long ago the
        // task last spoke, and letting it through would put a second task on
        // the same stack.
        [
            'updating with an unreadable timestamp',
            {
                status: 'updating',
                stack_status: 'UPDATE_COMPLETE',
                updatedAt: 'whenever',
            },
            'Deployment is updating; wait for it to finish',
        ],
    ]

    cases.forEach(([label, row, message]) => {
        test(label, () => {
            const refusal = refusalFor(row)
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
            refusalFor({
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
            refusalFor({
                status: 'published',
                stack_status: null,
                stack_status_error: 'Could not load credentials',
            })
        ).toBe(null)
    })
})
