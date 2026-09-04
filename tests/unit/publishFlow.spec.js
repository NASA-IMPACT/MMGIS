import { test, expect } from 'vitest'

// The decisions the ECS publish task makes around its AWS work. They are pure
// functions of a row, an action, and a stack read, so they are tabled here
// directly — no AWS and no database.

const Sequelize = require('sequelize')

const {
    rowStillOurs,
    rowStillOursForFailure,
    stackAction,
    assertRowLive,
    touchRow,
} = require('../../scripts/lib/publish-flow')
const STATUS = require('../../API/Backend/Deployments/models/deployment').STATUS

test.describe('stackAction', () => {
    const stack = { StackStatus: 'CREATE_COMPLETE' }
    const arn = 'arn:aws:cloudformation:us-west-2:111122223333:stack/x/abc'

    // [action, live stack, row's stack_arn, outcome]
    const cases = [
        // Nothing to converge onto: publish is what mints a stack.
        ['publish', null, null, { action: 'create' }],
        // A publish retried after a stack was created but the task died: the
        // stack exists, and this run's template has to reach it.
        ['publish', stack, arn, { action: 'converge' }],
        ['update', stack, arn, { action: 'converge' }],
        // An update of a row that never recorded a stack owns no URL a second
        // stack could displace, so it may create one.
        ['update', null, null, { action: 'create' }],
        // An update of a row that DOES own one: creating would mint a second
        // URL behind the same row, which is not an update.
        [
            'update',
            null,
            arn,
            {
                action: 'converge',
                refuse:
                    "Stack 'mmgis-dashboard-1' does not exist (deleted or " +
                    'never created) — delete the deployment and publish it ' +
                    'again (this mints a new URL)',
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

test.describe('the row guards on the tasks terminal writes', () => {
    // [builder, the statuses its write refuses to land on]. A Delete claims
    // the row the moment it starts; a failure additionally leaves `published`
    // alone, since a later task that got the dashboard live owns that status
    // and a straggler's failure must not paint over it.
    const cases = [
        [rowStillOurs, [STATUS.DELETING, STATUS.DELETED]],
        [
            rowStillOursForFailure,
            [STATUS.DELETING, STATUS.DELETED, STATUS.PUBLISHED],
        ],
    ]

    cases.forEach(([build, excluded]) => {
        test(`excludes ${excluded.join(', ')}`, () => {
            expect(build(STATUS)).toEqual({
                status: { [Sequelize.Op.notIn]: excluded },
            })
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

test.describe('touchRow', () => {
    // Enough of a model instance to record what the touch asked of it.
    function stubbedRow(status) {
        const row = { status, changes: [], saveOptions: null }
        row.changed = (field, value) => row.changes.push([field, value])
        row.save = async (options) => {
            row.saveOptions = options
            return row
        }
        return row
    }
    const modelFor = (row) => ({ findByPk: async () => row })

    test('writes the timestamp and nothing else', async () => {
        const row = stubbedRow('provisioning')
        await touchRow(modelFor(row), 4, STATUS)
        // Sequelize skips a save of a column nothing assigned, so the touch
        // has to mark it changed itself.
        expect(row.changes).toEqual([['updatedAt', true]])
        // Naming the field is what keeps the save from carrying whatever this
        // instance was holding back onto the row.
        expect(row.saveOptions).toEqual({ fields: ['updatedAt'] })
    })

    test('stops the task on a row a delete has claimed', async () => {
        const row = stubbedRow('deleting')
        await expect(touchRow(modelFor(row), 4, STATUS)).rejects.toThrow(
            'Deployment is deleting; abandoning this publish'
        )
        expect(row.saveOptions).toBe(null)
    })
})
