import { test, expect, vi } from 'vitest'

// withLiveStatus is what POST /api/deployments/:id/update feeds to
// updateRefusalFor, so the two are exercised together here over a real
// Deployments instance (built, never saved — no database). What that reaches
// past a table of hand-written rows is the merge itself: which live read lands
// on which field, and the row withLiveStatus writes back on its way.

const provision = require('../../scripts/lib/aws-provision')
const Deployments = require('../../API/Backend/Deployments/models/deployment')
const STATUS = Deployments.STATUS
const {
    withLiveStatus,
} = require('../../API/Backend/Deployments/routes/deployments')
const {
    updateRefusalFor,
} = require('../../API/Backend/Deployments/updateRefusal')

const NOW = Date.UTC(2026, 1, 1, 12, 0, 0)
const MINUTE = 60 * 1000

// Answers every DescribeStacks with `respond`, which returns the AWS response
// or throws the way the SDK does.
function stackReads(respond) {
    provision.setClients({ cfn: { send: async () => respond() } })
}

// A stack that settled long ago: nothing in flight, so only the row's age is
// left to decide.
const settledStack = () =>
    stackReads(() => ({ Stacks: [{ StackStatus: 'CREATE_COMPLETE' }] }))

const rowAged = (ms, status = STATUS.PROVISIONING) =>
    Deployments.build({
        id: 4,
        name: 'Jezero',
        mission: 'Jezero',
        status,
        stack_name: 'mmgis-dashboard-4',
        updatedAt: new Date(NOW - ms),
    })

test.describe('withLiveStatus into updateRefusalFor', () => {
    test.afterEach(() => {
        provision.setClients(null)
        vi.restoreAllMocks()
    })

    test('a young provisioning row is still a task nobody should cut in on', async () => {
        settledStack()
        const row = await withLiveStatus(rowAged(10 * MINUTE))
        expect(row.stack_status).toBe('CREATE_COMPLETE')
        // The age the refusal measures comes off this field.
        expect(new Date(row.updatedAt).getTime()).toBe(NOW - 10 * MINUTE)
        expect(updateRefusalFor(row, STATUS, NOW)).toEqual({
            message: 'Deployment is provisioning; wait for it to finish',
        })
    })

    // A listing must survive AWS being unreachable, so the failure rides along
    // on the row — and it is the field the refusal reads to say why it cannot
    // tell what the stack is doing.
    test('a stack that will not describe carries its error onto the row', async () => {
        stackReads(() => {
            throw new Error('Could not load credentials')
        })
        const row = await withLiveStatus(rowAged(6 * 60 * MINUTE))
        expect(row.stack_status).toBe(null)
        expect(row.stack_status_error).toBe('Could not load credentials')
        expect(updateRefusalFor(row, STATUS, NOW)).toEqual({
            message:
                "Could not read the deployment's stack: Could not load credentials",
        })
    })

    // There is no reconcile job: a teardown finishes when a read notices the
    // stack is gone, and that read is what writes the row's ending.
    test('a deleting row whose stack is gone flips to deleted', async () => {
        stackReads(() => {
            const err = new Error(
                'Stack with id mmgis-dashboard-4 does not exist'
            )
            err.name = 'ValidationError'
            throw err
        })
        const deployment = rowAged(30 * MINUTE, STATUS.DELETING)
        const update = vi
            .spyOn(deployment, 'update')
            .mockResolvedValue(deployment)
        const row = await withLiveStatus(deployment)
        expect(update).toHaveBeenCalledWith({ status: STATUS.DELETED })
        expect(row.status).toBe(STATUS.DELETED)
        expect(updateRefusalFor(row, STATUS, NOW)).toEqual({
            message: 'Deployment was deleted; publish it again',
        })
    })
})
