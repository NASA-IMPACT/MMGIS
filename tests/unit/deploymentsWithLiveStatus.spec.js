import { test, expect } from 'vitest'

// withLiveStatus is what POST /api/deployments/:id/update feeds to
// updateRefusalFor, so the two are exercised together here over a real
// Deployments instance (built, never saved — no database). That is what pins
// the age window to the field name the model actually produces: a refusal
// reading `updated_at` off a row that only carries `updatedAt` would let every
// abandoned-looking row straight through, and no table of hand-written rows
// would notice.

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
        expect(updateRefusalFor(row, STATUS, NOW)).toEqual({
            message: 'Deployment is provisioning; wait for it to finish',
        })
    })

    test('a provisioning row past the window is one an update may take over', async () => {
        settledStack()
        const row = await withLiveStatus(rowAged(120 * MINUTE))
        expect(updateRefusalFor(row, STATUS, NOW)).toBe(null)
    })
})
