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

// The statuses a `where` fragment refuses to write over.
const excluded = (fragment) => fragment.status[Sequelize.Op.notIn]

test.describe('the terminal write guards', () => {
    // A Delete that overlaps the task owns the row from the moment it starts,
    // so neither terminal write may land on a row it has claimed. The failure
    // write goes further: a task that already got the dashboard live owns the
    // `published` status, and a straggler's failure must not paint over it.
    const cases = [
        ['the published write', rowStillOurs, ['deleting', 'deleted']],
        [
            'the failed write',
            rowStillOursForFailure,
            ['deleting', 'deleted', 'published'],
        ],
    ]

    cases.forEach(([label, build, statuses]) => {
        test(`${label} skips a row in ${statuses.join(', ')}`, () => {
            expect(excluded(build(STATUS))).toEqual(statuses)
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
