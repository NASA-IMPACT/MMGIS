import { test, expect } from 'vitest'

// The decisions the ECS publish task makes around its AWS work. They are pure
// functions of a row, an action, and a stack read, so they are tabled here
// directly — no AWS, no database, and no import of publish-static.js (which
// runs its main() the moment it is loaded).

const Sequelize = require('sequelize')
const {
    rowStillOurs,
    rowStillOursForFailure,
    stackAction,
    assertRowLive,
} = require('../../scripts/lib/publish-flow')
const STATUS = require('../../API/Backend/Deployments/models/deployment').STATUS

// The `where` fragments the task's terminal writes carry, read back through
// Sequelize's own operator symbol so the table names statuses rather than
// shape.
test.describe('terminal-write guards', () => {
    // [label, fragment, the statuses it refuses to write onto]
    const cases = [
        [
            'a publish that got the dashboard live leaves a torn-down row alone',
            rowStillOurs(STATUS),
            ['deleting', 'deleted'],
        ],
        [
            "a straggler's failure also leaves a published row alone",
            rowStillOursForFailure(STATUS),
            ['deleting', 'deleted', 'published'],
        ],
    ]

    cases.forEach(([label, fragment, statuses]) => {
        test(label, () => {
            expect(fragment.status[Sequelize.Op.notIn]).toEqual(statuses)
        })
    })
})

test.describe('stackAction', () => {
    const stack = { StackStatus: 'CREATE_COMPLETE' }
    const arn = 'arn:aws:cloudformation:us-west-2:111122223333:stack/x/abc'

    // [action, live stack, row's stack_arn, outcome]
    const cases = [
        // Nothing to converge onto: publish is what mints a stack.
        ['publish', null, null, 'create'],
        // A publish retried after a stack was created but the task died: the
        // stack exists, and this run's template has to reach it.
        ['publish', stack, arn, 'converge'],
        ['update', stack, arn, 'converge'],
        // An update of a row that never recorded a stack owns no URL a second
        // stack could displace, so it may create one.
        ['update', null, null, 'create'],
        // An update of a row that DOES own one: creating would mint a second
        // URL behind the same row, which is not an update.
        [
            'update',
            null,
            arn,
            {
                refuse:
                    "Stack 'mmgis-dashboard-1' does not exist (deleted or " +
                    'never created) — delete this deployment and publish it again',
            },
        ],
    ]

    cases.forEach(([action, live, stackArn, expected]) => {
        const named = `${action} on a ${live ? 'live' : 'missing'} stack`
        test(`${named}, stack_arn ${stackArn ? 'set' : 'null'}`, () => {
            expect(
                stackAction({
                    action,
                    stack: live,
                    stackName: 'mmgis-dashboard-1',
                    stackArn,
                })
            ).toEqual(expected)
        })
    })
})

test.describe('assertRowLive', () => {
    // Re-read before each step that leaves something behind. A Delete that
    // landed during the multi-minute bake and build owns the row, and going on
    // would hand the operator a stack nobody is tearing down.
    const stopped = [
        [null, 'Deployment row is gone; abandoning this publish'],
        [
            { status: 'deleting' },
            'Deployment is deleting; abandoning this publish',
        ],
        [
            { status: 'deleted' },
            'Deployment is deleted; abandoning this publish',
        ],
    ]

    stopped.forEach(([row, message]) => {
        test(`stops on a ${row ? row.status : 'missing'} row`, () => {
            expect(() => assertRowLive(row, STATUS)).toThrow(message)
        })
    })

    // Every other status is a row this task is still working for, including
    // the `failed` a retried attempt starts from.
    const live = ['provisioning', 'updating', 'published', 'failed']
    live.forEach((status) => {
        test(`carries on for a ${status} row`, () => {
            expect(() => assertRowLive({ status }, STATUS)).not.toThrow()
        })
    })
})
