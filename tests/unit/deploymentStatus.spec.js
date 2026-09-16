import { test, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

import {
    STATUS,
    PUBLISH_TASK_STATE,
    updateDisabledReason,
    deleteDisabledReason,
    publishTaskUnconfirmedNotice,
    publishTaskNotice,
} from '../../configure/src/core/deploymentStatus'

// The Configure SPA mirrors the backend deployment STATUS constants and the
// IN_FLIGHT_STATUSES subset (separate build trees, so the values are
// duplicated and pinned here, same trick as the staticHandlers parity spec).

const root = path.join(__dirname, '..', '..')

function extractStatusValues(source) {
    const block = source.match(/STATUS\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/)
    expect(block).not.toBeNull()
    return [...block[1].matchAll(/[A-Z_]+:\s*"([a-z_]+)"/g)]
        .map((m) => m[1])
        .sort()
}

function extractInFlightStatuses(source) {
    const block = source.match(/IN_FLIGHT_STATUSES\s*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/)
    expect(block).not.toBeNull()
    return [...block[1].matchAll(/STATUS\.([A-Z_]+)/g)].map((m) => m[1]).sort()
}

test('Configure deploymentStatus mirrors the backend model STATUS and IN_FLIGHT_STATUSES', () => {
    const backend = fs.readFileSync(
        path.join(root, 'API/Backend/Deployments/models/deployment.js'),
        'utf8'
    )
    const configure = fs.readFileSync(
        path.join(root, 'configure/src/core/deploymentStatus.js'),
        'utf8'
    )
    expect(extractStatusValues(backend).length).toBeGreaterThan(0)
    expect(extractStatusValues(configure)).toEqual(extractStatusValues(backend))
    expect(extractInFlightStatuses(backend).length).toBeGreaterThan(0)
    expect(extractInFlightStatuses(configure)).toEqual(extractInFlightStatuses(backend))
})

// The Deployments page decides what an admin may click, and what the row
// says, from these helpers. Each case is a state an admin can find a row in.
test.describe('Deployments page button and row-text rules', () => {
    test('Update is blocked, with a reason, on every non-resting status and open otherwise', () => {
        for (const status of [STATUS.PROVISIONING, STATUS.UPDATING, STATUS.DELETING, STATUS.DELETED]) {
            expect(updateDisabledReason({ status }), status).toEqual(expect.any(String))
        }
        expect(updateDisabledReason({ status: STATUS.PUBLISHED })).toBeNull()
        expect(updateDisabledReason({ status: STATUS.FAILED, stack_arn: 'arn:aws:cloudformation:us-east-1:123:stack/mmgis-1/x' })).toBeNull()
    })

    test('Update is blocked on a failed row that never got a stack, pointing at Delete and a fresh publish', () => {
        expect(updateDisabledReason({ status: STATUS.FAILED, stack_arn: null })).toBe(
            'This publish failed before its dashboard was created. Delete this row and publish again.'
        )
    })

    test('Delete is blocked only on a deleted row or a confirmed-alive task', () => {
        expect(deleteDisabledReason({ status: STATUS.DELETED })).toBe('Already deleted.')
        expect(
            deleteDisabledReason({ status: STATUS.PROVISIONING, publish_task_state: PUBLISH_TASK_STATE.ALIVE })
        ).toMatch(/publish task is running/)
        expect(
            deleteDisabledReason({ status: STATUS.UPDATING, publish_task_state: PUBLISH_TASK_STATE.ALIVE })
        ).toMatch(/update task is running/)
        // An unconfirmed task must not lock the row: the admin can still clear it.
        expect(
            deleteDisabledReason({ status: STATUS.PROVISIONING, publish_task_state: PUBLISH_TASK_STATE.UNKNOWN })
        ).toBeNull()
        // A deleting row keeps Delete so a stuck teardown can be retried.
        expect(deleteDisabledReason({ status: STATUS.DELETING })).toBeNull()
        expect(deleteDisabledReason({ status: STATUS.PUBLISHED })).toBeNull()
        expect(deleteDisabledReason({ status: STATUS.FAILED })).toBeNull()
    })

    test('an in-flight row says since when its task has been running and how to unstick it, or why that is not known and what deleting risks', () => {
        const updatedAt = '2026-09-08T14:05:00.000Z'
        expect(
            publishTaskNotice({ status: STATUS.PROVISIONING, publish_task_state: PUBLISH_TASK_STATE.ALIVE, publish_task_detail: 'RUNNING', updatedAt })
        ).toEqual({
            text: `The publish task has been running since ${new Date(updatedAt).toLocaleString()} (ECS status RUNNING). If it looks stuck, stop the task in ECS; Delete becomes available once it stops.`,
            tone: 'note',
        })
        const unconfirmed = 'Could not confirm whether the update task is still running: not authorized. Deleting now may race a live update.'
        expect(
            publishTaskNotice({ status: STATUS.UPDATING, publish_task_state: PUBLISH_TASK_STATE.UNKNOWN, publish_task_error: 'not authorized' })
        ).toEqual({ text: unconfirmed, tone: 'warning', modalText: unconfirmed })
        expect(publishTaskNotice({ status: STATUS.PUBLISHED })).toBeNull()
        expect(publishTaskNotice({ status: STATUS.DELETING })).toBeNull()
    })

    test('a row with no recorded task is starting for its first minute, and a warning after that', () => {
        const claimedAt = Date.parse('2026-09-08T14:05:00.000Z')
        const row = { status: STATUS.PROVISIONING, publish_task_state: PUBLISH_TASK_STATE.UNKNOWN, updatedAt: new Date(claimedAt).toISOString() }
        expect(publishTaskNotice(row, claimedAt + 30 * 1000)).toEqual({
            text: 'Starting the publish task…',
            tone: 'note',
            modalText: 'Starting the publish task… Deleting now may race it once it starts.',
        })
        const noTask = 'No publish task was recorded for this row. If it stays this way, delete the deployment and publish again.'
        expect(publishTaskNotice(row, claimedAt + 61 * 1000)).toEqual({ text: noTask, tone: 'warning', modalText: noTask })
        // A row with no claim time gets no grace.
        expect(publishTaskNotice({ status: STATUS.UPDATING, publish_task_state: PUBLISH_TASK_STATE.UNKNOWN }).tone).toBe('warning')
    })

    test('the delete modal repeats the row text only for an unknown in-flight task', () => {
        const unknown = { status: STATUS.UPDATING, publish_task_state: PUBLISH_TASK_STATE.UNKNOWN, publish_task_error: 'timed out' }
        const notice = publishTaskUnconfirmedNotice(unknown)
        expect(notice).not.toBeNull()
        expect(notice.modalText).toBe(notice.text)
        expect(
            publishTaskUnconfirmedNotice({ status: STATUS.PROVISIONING, publish_task_state: PUBLISH_TASK_STATE.ALIVE })
        ).toBeNull()
        expect(publishTaskUnconfirmedNotice({ status: STATUS.PUBLISHED })).toBeNull()
    })
})
