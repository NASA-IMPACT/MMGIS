import { test, expect, vi } from 'vitest'

// POST /api/deployments/:id/update, driven through its own handler with a fake
// req/res and a stubbed Deployments model — no HTTP stack, no database, and no
// AWS. What is under test is the endpoint's own sequence: refuse, claim the row
// against the read it judged, and only then start a task.

const provision = require('../../scripts/lib/aws-provision')
const Deployments = require('../../API/Backend/Deployments/models/deployment')
const STATUS = Deployments.STATUS
const {
    router,
} = require('../../API/Backend/Deployments/routes/deployments')

const updateRoute = router.stack.find(
    (layer) => layer.route != null && layer.route.path === '/:id/update'
).route.stack[0].handle

const UPDATED_AT = new Date('2026-02-01T10:00:00Z')

// A row an update is allowed onto: terminal, and with no stack to describe, so
// the endpoint's answer turns on the row alone.
const publishedRow = () =>
    Deployments.build({
        id: 7,
        name: 'Jezero',
        mission: 'Jezero',
        status: STATUS.PUBLISHED,
        updatedAt: UPDATED_AT,
    })

function fakeRes() {
    const res = { statusCode: 200, body: null }
    res.status = (code) => {
        res.statusCode = code
        return res
    }
    res.send = (body) => {
        res.body = body
        return res
    }
    return res
}

// Answers the route's model calls: `row` comes back from findByPk, and
// `claimed` is how many rows the compare-and-swap reports it wrote.
function stubModel({ row, claimed = 1 }) {
    vi.spyOn(Deployments, 'findByPk').mockResolvedValue(row)
    vi.spyOn(Deployments, 'update').mockResolvedValue([claimed])
    return vi.spyOn(provision, 'runPublishTask').mockResolvedValue('task-arn')
}

const callUpdate = async () => {
    const res = fakeRes()
    await updateRoute(
        { params: { id: '7' }, body: {}, originalUrl: '/7/update' },
        res
    )
    return res
}

test.describe('POST /api/deployments/:id/update', () => {
    test.afterEach(() => vi.restoreAllMocks())

    test('answers 409 with the refusal and starts nothing', async () => {
        const runPublishTask = stubModel({
            row: Deployments.build({
                id: 7,
                name: 'Jezero',
                mission: 'Jezero',
                status: STATUS.DELETING,
                updatedAt: UPDATED_AT,
            }),
        })
        const res = await callUpdate()
        expect(res.statusCode).toBe(409)
        expect(res.body).toEqual({
            status: 'failure',
            message: 'Deployment is deleting; wait for it to finish',
        })
        expect(Deployments.update).not.toHaveBeenCalled()
        expect(runPublishTask).not.toHaveBeenCalled()
    })

    // Two clicks that both clear the refusal reach the claim, and the row the
    // claim names is the one the refusal was judged against — so the loser
    // writes nothing and must be told, not handed a second task.
    test('answers 409 when the claim finds the row already taken', async () => {
        const runPublishTask = stubModel({ row: publishedRow(), claimed: 0 })
        const res = await callUpdate()
        expect(res.statusCode).toBe(409)
        expect(res.body).toEqual({
            status: 'failure',
            message: 'Deployment is already updating',
        })
        expect(runPublishTask).not.toHaveBeenCalled()
    })

    test('claims the row it read, starts the task, and reports updating', async () => {
        const runPublishTask = stubModel({ row: publishedRow() })
        const res = await callUpdate()
        expect(res.statusCode).toBe(200)
        expect(res.body.status).toBe('success')
        expect(res.body.deployment_id).toBe(7)
        // The claim wrote the row, not the instance the route read; the
        // response has to report what the row now holds.
        expect(res.body.body.deployment.status).toBe(STATUS.UPDATING)
        // Both the status and the timestamp the refusal was judged against,
        // so a row that moved between the two reads is no longer claimable.
        expect(Deployments.update.mock.calls[0][1].where).toEqual({
            id: 7,
            status: STATUS.PUBLISHED,
            updatedAt: UPDATED_AT,
        })
        expect(runPublishTask).toHaveBeenCalledWith({
            deploymentId: 7,
            action: 'update',
        })
    })
})
