import { test, expect } from 'vitest'

// withLiveStatus is what POST /api/deployments/:id/update feeds to
// updateRefusalFor, so the two are exercised together here over a real
// Deployments instance (built, never saved — no database). A hand-written row
// carries whatever field a table gives it; this one carries only what the
// model produces, which is what pins the age the refusal measures to a
// timestamp that is really there.

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

// A stack that settled long ago: nothing in flight, so only the row's age is
// left to decide.
function settledStack() {
    provision.setClients({
        cfn: {
            send: async () => ({
                Stacks: [{ StackStatus: 'CREATE_COMPLETE' }],
            }),
        },
    })
}

const rowAged = (ms) =>
    Deployments.build({
        id: 4,
        name: 'Jezero',
        mission: 'Jezero',
        status: STATUS.PROVISIONING,
        stack_name: 'mmgis-dashboard-4',
        updatedAt: new Date(NOW - ms),
    })

test.describe('withLiveStatus into updateRefusalFor', () => {
    test.afterEach(() => provision.setClients(null))

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
})
