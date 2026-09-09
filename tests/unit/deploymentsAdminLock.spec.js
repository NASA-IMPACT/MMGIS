import { test, expect } from 'vitest'

// Tests for the admin-level lock in
// API/Backend/Deployments/routes/deployments.js: the refusals the publish,
// update and delete routes send, and the read-time reconcile of a publish
// task against ECS. The model's statics are stubbed on the shared module
// and ECS is an injected mock client (the same seam as awsProvision.spec.js);
// no database and no real AWS is touched.

const provision = require('../../scripts/lib/aws-provision')
const Deployments = require('../../API/Backend/Deployments/models/deployment')
const { Op } = require('sequelize')
const {
    startPublishTask,
    reconcilePublishTask,
    publishRefusal,
    claimForUpdate,
    deleteRefusal,
    claimForDelete,
} = require('../../API/Backend/Deployments/routes/deployments')

const STATUS = Deployments.STATUS
const TASK_ARN = 'arn:aws:ecs:us-east-1:123:task/mmgis-cluster/abc'
const OTHER_TASK_ARN = 'arn:aws:ecs:us-east-1:123:task/mmgis-cluster/def'

function mockClient(handler) {
    return { send: async (command) => handler(command) }
}

// A row as the routes see it: the fields plus the toJSON() a Sequelize
// instance carries.
function fakeRow(fields) {
    const row = { id: 1, name: 'Jezero', mission: 'jezero', settings: null, ...fields }
    row.toJSON = () => ({ ...fields, id: row.id, name: row.name, mission: row.mission, settings: row.settings })
    return row
}

// Stubs the model statics the helpers call and restores them after the test.
const STATICS = ['update', 'findByPk', 'findOne']
let saved
function stubModel(stubs) {
    Object.keys(stubs).forEach((name) => {
        Deployments[name] = stubs[name]
    })
}

// True when a row satisfies a Sequelize `where`: each key is a column, or a
// dotted path into a JSON column, compared by equality or by the Op.in /
// Op.notIn list the value carries.
function rowMatches(row, where) {
    if (Reflect.ownKeys(where).some((key) => typeof key === 'symbol'))
        throw new Error('the fake table only evaluates column keys')
    return Object.keys(where).every((key) => {
        const actual = key.split('.').reduce((value, part) => (value == null ? value : value[part]), row)
        const expected = where[key]
        if (expected != null && typeof expected === 'object' && !Array.isArray(expected)) {
            if (Op.in in expected) return expected[Op.in].includes(actual)
            if (Op.notIn in expected) return !expected[Op.notIn].includes(actual)
        }
        return actual === expected
    })
}

// Stands in for the deployments table with rows the helpers can read and
// conditionally write, so a compare-and-set is judged by what it did to the
// rows rather than by the `where` it sent.
function fakeTable(rows) {
    const table = rows.map((fields) => fakeRow(fields))
    stubModel({
        findByPk: async (id) => table.find((row) => row.id === id) || null,
        findOne: async (options) => table.find((row) => rowMatches(row, options.where)) || null,
        update: async (values, options) => {
            const hit = table.filter((row) => rowMatches(row, options.where))
            hit.forEach((row) => Object.assign(row, values))
            return [hit.length]
        },
    })
    return table
}

test.beforeEach(() => {
    saved = {}
    STATICS.forEach((name) => {
        saved[name] = {
            own: Object.prototype.hasOwnProperty.call(Deployments, name),
            value: Deployments[name],
        }
        Deployments[name] = async () => {
            throw new Error(`Deployments.${name} was not stubbed for this test`)
        }
    })
    process.env.MMGIS_PUBLISH_ECS_CLUSTER = 'mmgis-cluster'
})

test.afterEach(() => {
    STATICS.forEach((name) => {
        if (saved[name].own) Deployments[name] = saved[name].value
        else delete Deployments[name]
    })
    delete process.env.MMGIS_PUBLISH_ECS_CLUSTER
    provision.setClients(null)
})

function ecsAnswering(response) {
    const calls = []
    provision.setClients({
        ecs: mockClient((command) => {
            calls.push(command.input)
            if (typeof response === 'function') return response()
            return response
        }),
    })
    return calls
}

const aliveTask = { tasks: [{ taskArn: TASK_ARN, lastStatus: 'RUNNING' }], failures: [] }
const stoppedTask = {
    tasks: [{ taskArn: TASK_ARN, lastStatus: 'STOPPED', stoppedReason: 'Essential container in task exited', containers: [{ exitCode: 1 }] }],
    failures: [],
}
const missingTask = { tasks: [], failures: [{ arn: TASK_ARN, reason: 'MISSING' }] }
const deniedDescribe = () => {
    throw new Error('not authorized to perform ecs:DescribeTasks')
}

test.describe('publishRefusal (duplicate dashboard guard)', () => {
    test('refuses with reason `exists` naming the existing dashboard and its URL', async () => {
        stubModel({
            findOne: async () =>
                fakeRow({ id: 4, name: 'Jezero Live', status: STATUS.PUBLISHED, cloudfront_url: 'https://d1.cloudfront.net' }),
        })
        const refused = await publishRefusal({ mission: 'jezero' })
        expect(refused.status).toBe('failure')
        expect(refused.reason).toBe('exists')
        expect(refused.message).toBe(
            "A dashboard for jezero already exists (Jezero Live, https://d1.cloudfront.net)."
        )
        expect(refused.deployment_id).toBe(4)

        // A row that has no URL yet is named by its status instead.
        stubModel({
            findOne: async () => fakeRow({ id: 5, name: 'Jezero', status: STATUS.PROVISIONING }),
        })
        expect((await publishRefusal({ mission: 'jezero' })).message).toBe(
            'A dashboard for jezero already exists (Jezero, provisioning).'
        )
    })

    test('lets the publish through when the mission has no rows, only deleted ones, or one mid-delete', async () => {
        fakeTable([])
        expect(await publishRefusal({ mission: 'jezero' })).toBeNull()

        fakeTable([
            { id: 2, status: STATUS.DELETED },
            { id: 3, status: STATUS.DELETING },
            { id: 4, mission: 'gale', status: STATUS.PUBLISHED },
        ])
        expect(await publishRefusal({ mission: 'jezero' })).toBeNull()
    })

    test('a resting or in-flight row for the mission counts as existing', async () => {
        for (const status of [STATUS.PUBLISHED, STATUS.FAILED, STATUS.PROVISIONING, STATUS.UPDATING]) {
            fakeTable([{ id: 4, status }])
            expect((await publishRefusal({ mission: 'jezero' }))?.reason, status).toBe('exists')
        }
    })

    test('force: true skips the guard entirely', async () => {
        stubModel({
            findOne: async () => fakeRow({ id: 4, status: STATUS.PUBLISHED }),
        })
        expect(await publishRefusal({ mission: 'jezero', force: true })).toBeNull()
    })
})

test.describe('startPublishTask (a RunTask failure on the row)', () => {
    const PUBLISH_ENV = {
        MMGIS_PUBLISH_TASK_DEFINITION: 'mmgis-publish:1',
        MMGIS_PUBLISH_SUBNETS: 'subnet-1',
        MMGIS_PUBLISH_SECURITY_GROUPS: 'sg-1',
    }
    test.beforeEach(() => Object.assign(process.env, PUBLISH_ENV))
    test.afterEach(() => Object.keys(PUBLISH_ENV).forEach((name) => delete process.env[name]))
    const runTaskDenied = () => {
        throw new Error('not authorized to perform ecs:RunTask')
    }

    test('marks the in-flight row failed with the error', async () => {
        ecsAnswering(runTaskDenied)
        const [row] = fakeTable([{ id: 1, status: STATUS.PROVISIONING }])
        await startPublishTask(fakeRow({ id: 1, status: STATUS.PROVISIONING }), 'publish')
        expect(row.status).toBe(STATUS.FAILED)
        expect(row.last_error).toBe('Failed to start publish task: not authorized to perform ecs:RunTask')
    })

    test('leaves a row a Delete has since claimed to the delete flow', async () => {
        ecsAnswering(runTaskDenied)
        const [row] = fakeTable([{ id: 1, status: STATUS.DELETING }])
        await startPublishTask(fakeRow({ id: 1, status: STATUS.PROVISIONING }), 'publish')
        expect(row.status).toBe(STATUS.DELETING)
        expect(row.last_error).toBeUndefined()
    })
})

test.describe('claimForUpdate (compare-and-set to updating)', () => {
    test('claims a resting row: moves it to updating and clears the previous task ARN, keeping other settings', async () => {
        let written
        stubModel({
            update: async (values) => {
                written = values
                return [1]
            },
        })
        const row = fakeRow({
            status: STATUS.PUBLISHED,
            settings: { bucket: 'b', publish_task_arn: 'arn:old' },
        })
        expect(await claimForUpdate(row)).toBeNull()
        expect(written.status).toBe(STATUS.UPDATING)
        expect(written.last_error).toBeNull()
        expect(written.settings).toEqual({ bucket: 'b', publish_task_arn: null })
    })

    const refusals = [
        [STATUS.PROVISIONING, 'in_progress', /A publish is already running for 'Jezero'/],
        [STATUS.UPDATING, 'in_progress', /An update is already running for 'Jezero'/],
        [STATUS.DELETING, 'deleting', /'Jezero' is being deleted and cannot be updated/],
        [STATUS.DELETED, 'deleted', /'Jezero' has been deleted and cannot be updated/],
    ]
    test.each(refusals)(
        'zero rows claimed while the row is %s -> reason %s',
        async (status, reason, message) => {
            stubModel({
                update: async () => [0],
                findByPk: async () => fakeRow({ status }),
            })
            const refused = await claimForUpdate(fakeRow({ status: STATUS.PUBLISHED }))
            expect(refused.status).toBe('failure')
            expect(refused.reason).toBe(reason)
            expect(refused.message).toMatch(message)
            expect(refused.body.deployment.status).toBe(status)
        }
    )

    test('a row that changed to a resting status between the claim and the re-read is a conflict, not a running publish', async () => {
        stubModel({
            update: async () => [0],
            findByPk: async () => fakeRow({ status: STATUS.FAILED }),
        })
        const refused = await claimForUpdate(fakeRow({ status: STATUS.PUBLISHED }))
        expect(refused.reason).toBe('conflict')
        expect(refused.message).toMatch(/changed to failed/)
    })

    test('a row that is gone by the re-read is a conflict that says so', async () => {
        stubModel({
            update: async () => [0],
            findByPk: async () => null,
        })
        const refused = await claimForUpdate(fakeRow({ status: STATUS.PUBLISHED }))
        expect(refused.reason).toBe('conflict')
        expect(refused.message).toBe("'Jezero' no longer exists. Refresh the Deployments page.")
    })
})

test.describe('claimForDelete (compare-and-set to deleting)', () => {
    test('claims the row from the status the delete gate judged', async () => {
        const [row] = fakeTable([{ id: 1, status: STATUS.PROVISIONING, last_error: 'old' }])
        expect(await claimForDelete(fakeRow({ id: 1, status: STATUS.PROVISIONING }))).toBeNull()
        expect(row.status).toBe(STATUS.DELETING)
        expect(row.last_error).toBeNull()
    })

    test('a row that moved on since the gate judged it is refused as a conflict and left alone', async () => {
        const [row] = fakeTable([{ id: 1, status: STATUS.PUBLISHED }])
        const refused = await claimForDelete(fakeRow({ id: 1, status: STATUS.PROVISIONING }))
        expect(refused.reason).toBe('conflict')
        expect(refused.message).toMatch(/changed to published/)
        expect(row.status).toBe(STATUS.PUBLISHED)
    })

    test('a row that is gone is a conflict that says so', async () => {
        fakeTable([])
        const refused = await claimForDelete(fakeRow({ id: 1, status: STATUS.PROVISIONING }))
        expect(refused.reason).toBe('conflict')
        expect(refused.message).toBe("'Jezero' no longer exists. Refresh the Deployments page.")
    })
})

test.describe('Deployments.recordPublishTaskArn', () => {
    test('records the ARN on an in-flight row, keeping the other settings', async () => {
        const [row] = fakeTable([{ id: 1, status: STATUS.UPDATING, settings: { bucket: 'b' } }])
        expect(await Deployments.recordPublishTaskArn(1, TASK_ARN)).toBe(1)
        expect(row.settings).toEqual({ bucket: 'b', publish_task_arn: TASK_ARN })
    })

    test('leaves a row a Delete has claimed without a task ARN', async () => {
        const [row] = fakeTable([{ id: 1, status: STATUS.DELETING, settings: { bucket: 'b' } }])
        expect(await Deployments.recordPublishTaskArn(1, TASK_ARN)).toBe(0)
        expect(row.settings).toEqual({ bucket: 'b' })
    })
})

test.describe('deleteRefusal (task-liveness gate)', () => {
    const inFlight = (extra) =>
        fakeRow({ status: STATUS.PROVISIONING, settings: { publish_task_arn: TASK_ARN }, ...extra })

    test('refuses while ECS says the task is alive, naming the task the row is running', async () => {
        ecsAnswering(aliveTask)
        const refused = await deleteRefusal(inFlight())
        expect(refused.reason).toBe('in_progress')
        expect(refused.message).toBe(
            "The publish task for 'Jezero' is still running (RUNNING). Wait for it to finish, then delete."
        )
        const updating = await deleteRefusal(inFlight({ status: STATUS.UPDATING }))
        expect(updating.message).toMatch(/^The update task for 'Jezero' is still running/)
    })

    test('allows the delete when the task has stopped', async () => {
        ecsAnswering(stoppedTask)
        expect(await deleteRefusal(inFlight())).toBeNull()
    })

    test('allows the delete when ECS has forgotten the task', async () => {
        ecsAnswering(missingTask)
        expect(await deleteRefusal(inFlight())).toBeNull()
    })

    test('allows the delete when ECS cannot be asked (fails open)', async () => {
        ecsAnswering(deniedDescribe)
        expect(await deleteRefusal(inFlight())).toBeNull()
    })

    test('allows the delete when no task ARN is recorded, without asking ECS', async () => {
        const calls = ecsAnswering(aliveTask)
        expect(await deleteRefusal(fakeRow({ status: STATUS.PROVISIONING }))).toBeNull()
        expect(calls).toHaveLength(0)
    })

    test('never gates a row that is not in flight (a deleting row retries its teardown)', async () => {
        const calls = ecsAnswering(aliveTask)
        for (const status of [STATUS.PUBLISHED, STATUS.FAILED, STATUS.DELETING]) {
            expect(await deleteRefusal(inFlight({ status }))).toBeNull()
        }
        expect(calls).toHaveLength(0)
    })
})

test.describe('reconcilePublishTask (read-time reconcile)', () => {
    const inFlightRow = (extra) => ({
        id: 1,
        status: STATUS.PROVISIONING,
        settings: { publish_task_arn: TASK_ARN },
        ...extra,
    })

    test('an alive task is reported on the row and nothing is written', async () => {
        ecsAnswering(aliveTask)
        const row = inFlightRow()
        await reconcilePublishTask(row)
        expect(row.status).toBe(STATUS.PROVISIONING)
        expect(row.publish_task_state).toBe('alive')
        expect(row.publish_task_detail).toBe('RUNNING')
    })

    test('a stopped publish task flips a provisioning row to failed: the stop reason, then delete and publish again', async () => {
        ecsAnswering(stoppedTask)
        const [stored] = fakeTable([inFlightRow()])
        const row = inFlightRow()
        await reconcilePublishTask(row)
        expect(row.status).toBe(STATUS.FAILED)
        expect(row.last_error).toBe(
            'The publish task exited before reporting: Essential container in task exited; exit code 1. Delete this row and publish again.'
        )
        expect(row.publish_task_state).toBe('stopped')
        expect(stored.status).toBe(STATUS.FAILED)
        expect(stored.last_error).toBe(row.last_error)
    })

    test('a stopped update task offers Update as the retry, since the stack exists', async () => {
        ecsAnswering(stoppedTask)
        fakeTable([inFlightRow({ status: STATUS.UPDATING })])
        const row = inFlightRow({ status: STATUS.UPDATING })
        await reconcilePublishTask(row)
        expect(row.status).toBe(STATUS.FAILED)
        expect(row.last_error).toBe(
            'The update task exited before reporting: Essential container in task exited; exit code 1. Use Update to retry, or Delete and publish again.'
        )
    })

    test('a task ECS has forgotten flips the row to failed once the row is old enough to have had one', async () => {
        const now = Date.parse('2026-09-08T14:10:00.000Z')
        const claimedAt = new Date(now - 3 * 60 * 1000).toISOString()
        ecsAnswering(missingTask)
        const [stored] = fakeTable([inFlightRow({ updatedAt: claimedAt })])
        const row = inFlightRow({ updatedAt: claimedAt })
        await reconcilePublishTask(row, now)
        expect(stored.status).toBe(STATUS.FAILED)
        expect(row.status).toBe(STATUS.FAILED)
        expect(row.publish_task_state).toBe('missing')
        expect(row.last_error).toBe(
            'The publish task exited before reporting: ECS no longer has a record of the task. Delete this row and publish again.'
        )
    })

    test('a MISSING answer within two minutes of the claim is the task not listed yet, not a verdict', async () => {
        const now = Date.parse('2026-09-08T14:10:00.000Z')
        const claimedAt = new Date(now - 30 * 1000).toISOString()
        ecsAnswering(missingTask)
        const [stored] = fakeTable([inFlightRow({ updatedAt: claimedAt })])
        const row = inFlightRow({ updatedAt: claimedAt })
        await reconcilePublishTask(row, now)
        expect(stored.status).toBe(STATUS.PROVISIONING)
        expect(row.status).toBe(STATUS.PROVISIONING)
        expect(row.publish_task_state).toBe('unknown')
        expect(row.publish_task_error).toBe('ECS does not list the task yet')
        expect(row.publish_task_detail).toBeUndefined()
    })

    test('when the task reported between the read and the flip, the row it wrote is served instead', async () => {
        ecsAnswering(stoppedTask)
        const [stored] = fakeTable([
            { id: 1, status: STATUS.PUBLISHED, cloudfront_url: 'https://d1.cloudfront.net', settings: { publish_task_arn: TASK_ARN } },
        ])
        const row = inFlightRow()
        await reconcilePublishTask(row)
        expect(stored.status).toBe(STATUS.PUBLISHED)
        expect(row.status).toBe(STATUS.PUBLISHED)
        expect(row.cloudfront_url).toBe('https://d1.cloudfront.net')
        expect(row.publish_task_state).toBeUndefined()
    })

    test('a verdict on an old task never lands on a row an Update has since re-claimed; the new task is reported instead', async () => {
        // The list read saw the old task's ARN; by the time ECS answered that
        // it had stopped, an Update claimed the row and a new task registered.
        provision.setClients({
            ecs: mockClient((command) =>
                command.input.tasks.includes(OTHER_TASK_ARN)
                    ? { tasks: [{ taskArn: OTHER_TASK_ARN, lastStatus: 'PENDING' }], failures: [] }
                    : stoppedTask
            ),
        })
        const [stored] = fakeTable([
            { id: 1, status: STATUS.UPDATING, settings: { publish_task_arn: OTHER_TASK_ARN } },
        ])
        const row = inFlightRow()
        await reconcilePublishTask(row)
        expect(stored.status).toBe(STATUS.UPDATING)
        expect(stored.last_error).toBeUndefined()
        expect(row.status).toBe(STATUS.UPDATING)
        expect(row.settings.publish_task_arn).toBe(OTHER_TASK_ARN)
        expect(row.publish_task_state).toBe('alive')
        expect(row.publish_task_detail).toBe('PENDING')
    })

    test('an unanswered DescribeTasks leaves the row in flight, reported as unknown with the error', async () => {
        ecsAnswering(deniedDescribe)
        const row = inFlightRow()
        await reconcilePublishTask(row)
        expect(row.status).toBe(STATUS.PROVISIONING)
        expect(row.publish_task_state).toBe('unknown')
        expect(row.publish_task_error).toMatch(/not authorized/)
    })

    test('a row with no recorded task ARN stays in flight as unknown, without asking ECS', async () => {
        const calls = ecsAnswering(aliveTask)
        const row = inFlightRow({ settings: null })
        await reconcilePublishTask(row)
        expect(row.status).toBe(STATUS.PROVISIONING)
        expect(row.publish_task_state).toBe('unknown')
        expect(row.publish_task_error).toBeUndefined()
        expect(calls).toHaveLength(0)
    })

    test('rows that are not in flight are left alone', async () => {
        const calls = ecsAnswering(stoppedTask)
        for (const status of [STATUS.PUBLISHED, STATUS.FAILED, STATUS.DELETING, STATUS.DELETED]) {
            const row = inFlightRow({ status })
            await reconcilePublishTask(row)
            expect(row.status).toBe(status)
            expect(row.publish_task_state).toBeUndefined()
        }
        expect(calls).toHaveLength(0)
    })
})
