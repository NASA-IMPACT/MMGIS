import { test, expect } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Tests for scripts/lib/aws-provision.js using injected mock clients —
// no test here (or anywhere) ever calls real AWS.

const provision = require('../../scripts/lib/aws-provision')
const { IMAGE_MIME_TO_EXT } = require('../../API/Backend/Upload/validate')

function mockClient(handler) {
    return { send: async (command) => handler(command) }
}

// Replays one Stack object per DescribeStacks poll (the last one repeats)
// and records how many polls happened.
function replayStacks(stacks) {
    const state = { polls: 0 }
    provision.setClients({
        cfn: mockClient(() => {
            const stack = stacks[Math.min(state.polls++, stacks.length - 1)]
            return { Stacks: [stack] }
        }),
    })
    return state
}

test.describe('describeStack', () => {
    test.afterEach(() => provision.setClients(null))

    test('returns the stack when it exists', async () => {
        provision.setClients({
            cfn: mockClient(() => ({
                Stacks: [{ StackName: 'mmgis-dashboard-1', StackStatus: 'CREATE_COMPLETE' }],
            })),
        })
        const stack = await provision.describeStack({
            stackName: 'mmgis-dashboard-1',
        })
        expect(stack.StackStatus).toBe('CREATE_COMPLETE')
    })

    test('returns null when the stack does not exist', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error(
                    'Stack with id mmgis-dashboard-9 does not exist'
                )
                err.name = 'ValidationError'
                throw err
            }),
        })
        const stack = await provision.describeStack({
            stackName: 'mmgis-dashboard-9',
        })
        expect(stack).toBe(null)
    })

    // ValidationError is also what CloudFormation raises for a malformed stack
    // name. Reading that as "no stack" would send the publish path into
    // CreateStack on a name that can never be created.
    test('rethrows a ValidationError that is not about a missing stack', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error(
                    "1 validation error detected: Value 'mmgis dashboard 1' at 'stackName' failed to satisfy constraint"
                )
                err.name = 'ValidationError'
                throw err
            }),
        })
        await expect(
            provision.describeStack({ stackName: 'mmgis dashboard 1' })
        ).rejects.toThrow(/validation error detected/)
    })

    test('rethrows other errors (e.g. missing credentials)', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error('Could not load credentials')
                err.name = 'CredentialsProviderError'
                throw err
            }),
        })
        await expect(
            provision.describeStack({ stackName: 'mmgis-dashboard-1' })
        ).rejects.toThrow(/credentials/i)
    })
})

test.describe('updateStack', () => {
    test.afterEach(() => provision.setClients(null))

    test('sends UpdateStackCommand with the template and the deployment tag, resolves true', async () => {
        const calls = []
        provision.setClients({
            cfn: {
                send: async (cmd) => {
                    calls.push(cmd)
                    return {}
                },
            },
        })
        const started = await provision.updateStack({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
        })
        expect(started).toBe(true)
        expect(calls.length).toBe(1)
        expect(calls[0].constructor.name).toBe('UpdateStackCommand')
        expect(calls[0].input.StackName).toBe('mmgis-dashboard-1')
        expect(calls[0].input.TemplateBody).toBe('{}')
        expect(calls[0].input.Tags).toEqual([
            { Key: 'mmgis:deployment', Value: 'mmgis-dashboard-1' },
        ])
    })

    test('resolves false on the "no updates" ValidationError', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error('No updates are to be performed.')
                err.name = 'ValidationError'
                throw err
            }),
        })
        expect(
            await provision.updateStack({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
            })
        ).toBe(false)
    })

    test('rethrows a ValidationError with a different message (e.g. stack does not exist)', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error(
                    'Stack with id mmgis-dashboard-9 does not exist'
                )
                err.name = 'ValidationError'
                throw err
            }),
        })
        await expect(
            provision.updateStack({
                stackName: 'mmgis-dashboard-9',
                templateBody: '{}',
            })
        ).rejects.toThrow(/does not exist/)
    })
})

test.describe('isStackBusyError', () => {
    const busyMessage = (status) =>
        'Stack:arn:aws:cloudformation:us-west-2:111122223333:stack/mmgis-dashboard-1/abc ' +
        `is in ${status} state and can not be updated.`

    // A second republish click starts a second ECS task, whose UpdateStack
    // CloudFormation rejects because the winner's operation is genuinely in
    // flight. Recognizing that rejection is the difference between a harmless
    // double click (wait it out, retry) and a row marked failed.
    test('classifies a genuinely in-flight (*_IN_PROGRESS) rejection as busy', () => {
        const busy = new Error(busyMessage('UPDATE_IN_PROGRESS'))
        busy.name = 'ValidationError'
        expect(provision.isStackBusyError(busy)).toBe(true)

        const otherName = new Error(busy.message)
        otherName.name = 'ThrottlingException'
        expect(provision.isStackBusyError(otherName)).toBe(false)

        // The other ValidationError the update path can see stays a no-op,
        // not a race to wait out.
        const noUpdates = new Error('No updates are to be performed.')
        noUpdates.name = 'ValidationError'
        expect(provision.isStackBusyError(noUpdates)).toBe(false)

        expect(provision.isStackBusyError(null)).toBe(false)
    })

    // CloudFormation reuses the exact same "... state and can not be updated"
    // wording for wedged, delete-only statuses. Classifying one of THOSE as
    // busy would make the loser wait forever on an operation that is never
    // coming, instead of surfacing the delete-and-republish guidance. Only the
    // status the message names tells them apart.
    test('a wedged UPDATE_ROLLBACK_FAILED rejection is NOT classified as busy', () => {
        const err = new Error(busyMessage('UPDATE_ROLLBACK_FAILED'))
        err.name = 'ValidationError'
        expect(provision.isStackBusyError(err)).toBe(false)
    })
})

// The convergence loop (see convergeStackUpdate's docblock). Driven with a cfn
// mock that scripts a reply per command, in the order the loop issues them.
test.describe('convergeStackUpdate', () => {
    test.afterEach(() => provision.setClients(null))

    const BEFORE = new Date('2026-02-01T10:00:00Z')
    const WINNER = new Date('2026-02-01T10:03:00Z')
    const OURS = new Date('2026-02-01T10:06:00Z')

    // Scripts cfn.send with an ordered list of steps. Each step is
    // { kind: 'Update' | 'Describe', reply?, throw? }; the reply is the mock
    // return (Describe steps are wrapped as { Stacks: [reply] }). The last
    // step repeats so a poll can settle. Each step asserts the command it
    // receives is the one the script expects, so a loop that issues its
    // commands in a different order fails on the step that diverged rather
    // than on a confusing reply mismatch further down.
    function scriptCfn(steps) {
        const state = { i: 0, kinds: [], updates: 0 }
        provision.setClients({
            cfn: mockClient((command) => {
                const kind = command.constructor.name
                state.kinds.push(kind)
                const step = steps[Math.min(state.i, steps.length - 1)]
                expect(kind, `step ${state.i}`).toBe(
                    step.kind === 'Update'
                        ? 'UpdateStackCommand'
                        : 'DescribeStacksCommand'
                )
                state.i++
                if (kind === 'UpdateStackCommand') state.updates++
                if (step.throw) throw step.throw
                if (kind === 'DescribeStacksCommand')
                    return { Stacks: [step.reply] }
                return step.reply || {}
            }),
        })
        return state
    }

    const busyError = () => {
        const err = new Error(
            'Stack:arn:.../abc is in UPDATE_IN_PROGRESS state and can not be updated.'
        )
        err.name = 'ValidationError'
        return err
    }

    // The loser waits the winner out and then runs its OWN UpdateStack, and
    // never resolves on a still-in-progress read. Our own update is what the
    // returned stack reflects (OURS, not the winner's).
    test('waits out an in-flight winner, then runs and waits for OUR own update', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: BEFORE }
        const state = scriptCfn([
            // attempt 0: our UpdateStack is rejected — winner in flight
            { kind: 'Update', throw: busyError() },
            // the `current` describe: winner mid-update
            { kind: 'Describe', reply: { StackStatus: 'UPDATE_IN_PROGRESS' } },
            // wait-out poll 1: STILL in progress — must NOT resolve early
            { kind: 'Describe', reply: { StackStatus: 'UPDATE_IN_PROGRESS' } },
            // wait-out poll 2: winner settled
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: WINNER,
                },
            },
            // attempt 1: our UpdateStack now accepted
            { kind: 'Update', reply: {} },
            // final wait poll 1: stale winner read (same status, WINNER time) —
            // prior blocks it from resolving us
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: WINNER,
                    StackId: 'winner',
                },
            },
            // final wait poll 2: our update in flight
            { kind: 'Describe', reply: { StackStatus: 'UPDATE_IN_PROGRESS', LastUpdatedTime: OURS } },
            // final wait poll 3: our update landed
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: OURS,
                    StackId: 'ours',
                },
            },
        ])
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            existing,
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('ours')
        // Our own UpdateStack ran twice (rejected, then accepted): the loser
        // did not merely ride the winner's update.
        expect(state.updates).toBe(2)
    })

    // The busy rejection is itself proof another operation is in flight, so
    // the read taken right after it can still show the pre-operation state.
    // Ending the wait-out on one of those reads would send our UpdateStack
    // straight back into the same rejection.
    test('a stale read after the busy rejection does not end the wait-out', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: BEFORE }
        const state = scriptCfn([
            // attempt 0: rejected — the winner's update is in flight
            { kind: 'Update', throw: busyError() },
            // the `current` describe still reports the pre-rejection state
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: BEFORE,
                },
            },
            // wait-out poll 1: the same stale read — must NOT resolve
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: BEFORE,
                },
            },
            // wait-out poll 2: the winner's update actually landed
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: WINNER,
                },
            },
            // attempt 1: our UpdateStack now accepted
            { kind: 'Update', reply: {} },
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: OURS,
                    StackId: 'ours',
                },
            },
        ])
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            existing,
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('ours')
        expect(state.updates).toBe(2)
    })

    // A wait-out can settle on a status the stack can only be deleted out of.
    // Retrying UpdateStack there would surface CloudFormation's own opaque
    // rejection instead of the delete-and-republish guidance.
    test('a wait-out that settles in a delete-only status stops with the guidance', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: BEFORE }
        const state = scriptCfn([
            // attempt 0: rejected — an operation is in flight
            { kind: 'Update', throw: busyError() },
            { kind: 'Describe', reply: { StackStatus: 'ROLLBACK_IN_PROGRESS' } },
            // wait-out: it settled somewhere only a delete moves it out of
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'ROLLBACK_COMPLETE',
                    LastUpdatedTime: WINNER,
                },
            },
        ])
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                existing,
                pollIntervalMs: 1,
                timeoutMs: 2000,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' is in ROLLBACK_COMPLETE and cannot be used"
        )
        // No second UpdateStack: the retry is abandoned, not attempted.
        expect(state.updates).toBe(1)
    })

    // An update that rolls back lands on UPDATE_ROLLBACK_COMPLETE — the
    // update path must THROW, never report the dashboard published.
    test('throws when OUR update rolls back to UPDATE_ROLLBACK_COMPLETE', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: BEFORE }
        scriptCfn([
            { kind: 'Update', reply: {} },
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
                    LastUpdatedTime: OURS,
                    StackStatusReason: 'The new Function code is invalid',
                },
            },
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
                    LastUpdatedTime: OURS,
                },
            },
        ])
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                existing,
                pollIntervalMs: 1,
                timeoutMs: 2000,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' reached terminal status 'UPDATE_ROLLBACK_COMPLETE': The new Function code is invalid"
        )
    })

    // The winner's update can end in a rollback. UPDATE_ROLLBACK_COMPLETE is
    // still a status CloudFormation accepts an UpdateStack from, so the loser
    // must retry its own template there rather than treat the winner's outcome
    // as its own failure.
    test('waits out a winner that rolls back, then converges our own update', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: BEFORE }
        const state = scriptCfn([
            // attempt 0: rejected — the winner is mid-update
            { kind: 'Update', throw: busyError() },
            { kind: 'Describe', reply: { StackStatus: 'UPDATE_IN_PROGRESS' } },
            // wait-out: the winner's update rolled back
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
                    LastUpdatedTime: WINNER,
                },
            },
            // attempt 1: our UpdateStack is accepted from that status
            { kind: 'Update', reply: {} },
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: OURS,
                    StackId: 'ours',
                },
            },
        ])
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            existing,
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('ours')
        expect(state.updates).toBe(2)
    })

    // The stack the caller read may be mid-create; after waiting that out, the
    // template is already converged and CloudFormation reports "no updates".
    // The stack handed back has to be the settled read — the pre-wait snapshot
    // carries the in-progress status and no Outputs, so publish would fail on
    // the missing BucketName.
    test('returns the settled stack, not the pre-wait snapshot, when there is nothing to update', async () => {
        const existing = { StackStatus: 'CREATE_IN_PROGRESS', StackId: 'pre' }
        scriptCfn([
            // attempt 0: rejected — the create is still in flight
            { kind: 'Update', throw: busyError() },
            { kind: 'Describe', reply: { StackStatus: 'CREATE_IN_PROGRESS' } },
            // wait-out: the create finished, and only now are there Outputs
            {
                kind: 'Describe',
                reply: {
                    StackStatus: 'CREATE_COMPLETE',
                    StackId: 'settled',
                    Outputs: [{ OutputKey: 'BucketName', OutputValue: 'b' }],
                },
            },
            // attempt 1: the created stack already matches our template
            {
                kind: 'Update',
                throw: Object.assign(
                    new Error('No updates are to be performed.'),
                    { name: 'ValidationError' }
                ),
            },
        ])
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            existing,
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('settled')
        expect(provision.getStackOutputs(stack)).toEqual({ BucketName: 'b' })
    })

    // A stack being torn down has no bucket to publish into, and the loop must
    // not spend its busy budget waiting for one that is going away.
    test('refuses a stack in a delete-only status before sending any command', async () => {
        const kinds = []
        provision.setClients({
            cfn: mockClient((command) => {
                kinds.push(command.constructor.name)
                return {}
            }),
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                existing: { StackStatus: 'DELETE_IN_PROGRESS' },
                pollIntervalMs: 1,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' is in DELETE_IN_PROGRESS and cannot be used"
        )
        expect(kinds).toEqual([])
    })

    // "No updates are to be performed" — the template already converged; the
    // stack read before the UpdateStack is still current, because nothing was
    // waited on.
    test('returns the existing stack when there is nothing to update', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', StackId: 'same' }
        const state = scriptCfn([
            {
                kind: 'Update',
                throw: Object.assign(
                    new Error('No updates are to be performed.'),
                    { name: 'ValidationError' }
                ),
            },
        ])
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            existing,
            pollIntervalMs: 1,
        })
        expect(stack).toBe(existing)
        // One UpdateStack, and no DescribeStacks poll at all.
        expect(state.updates).toBe(1)
        expect(state.kinds).toEqual(['UpdateStackCommand'])
    })

    // A stack that never frees up must fail the row, not loop forever. Every
    // UpdateStack is rejected busy and every wait-out settles instantly, so the
    // loop only stops on the maxBusyRetries bound.
    test('gives up after maxBusyRetries when the stack stays busy', async () => {
        const existing = { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: BEFORE }
        // Each read carries a newer LastUpdatedTime than the one before it, so
        // every wait-out sees the operation it waited on land instead of
        // polling a read it has to treat as stale.
        let reads = 0
        provision.setClients({
            cfn: mockClient((command) => {
                if (command.constructor.name === 'UpdateStackCommand')
                    throw busyError()
                reads++
                return {
                    Stacks: [
                        {
                            StackStatus: 'UPDATE_COMPLETE',
                            LastUpdatedTime: new Date(
                                BEFORE.getTime() + reads * 60000
                            ),
                        },
                    ],
                }
            }),
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                existing,
                maxBusyRetries: 2,
                pollIntervalMs: 1,
                timeoutMs: 2000,
            })
        ).rejects.toThrow(/stayed busy after 3 UpdateStack attempts/)
    })
})

test.describe('waitForStack', () => {
    test.afterEach(() => provision.setClients(null))

    test('resolves once the stack reaches the desired status', async () => {
        const statuses = ['CREATE_IN_PROGRESS', 'CREATE_COMPLETE']
        let i = 0
        provision.setClients({
            cfn: mockClient(() => ({
                Stacks: [{ StackStatus: statuses[Math.min(i++, 1)] }],
            })),
        })
        const stack = await provision.waitForStack({
            stackName: 'mmgis-dashboard-1',
            pollIntervalMs: 1,
        })
        expect(stack.StackStatus).toBe('CREATE_COMPLETE')
    })

    test('throws on a terminal failure status', async () => {
        provision.setClients({
            cfn: mockClient(() => ({
                Stacks: [
                    {
                        StackStatus: 'ROLLBACK_COMPLETE',
                        StackStatusReason: 'Resource creation cancelled',
                    },
                ],
            })),
        })
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                pollIntervalMs: 1,
            })
        ).rejects.toThrow(/ROLLBACK_COMPLETE/)
    })

    // An out-of-band `update-stack --disable-rollback` leaves a real stack
    // here, and it can never reach the desired status.
    test('throws promptly on UPDATE_FAILED rather than polling until the timeout', async () => {
        const state = replayStacks([
            {
                StackStatus: 'UPDATE_FAILED',
                StackStatusReason: 'The new Function code is invalid',
            },
        ])
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: 'UPDATE_COMPLETE',
                pollIntervalMs: 1,
                timeoutMs: 500,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' reached terminal status 'UPDATE_FAILED': The new Function code is invalid"
        )
        expect(state.polls).toBe(1)
    })

    // The busy wait-out resolves on whatever the other operation settled at,
    // so a status outside the set still ends the wait while any member of it
    // resolves — including the rollback status a failed update lands on.
    test('a list of desired statuses resolves on any member', async () => {
        replayStacks([
            { StackStatus: 'UPDATE_IN_PROGRESS' },
            { StackStatus: 'UPDATE_ROLLBACK_COMPLETE', StackId: 'settled' },
        ])
        const stack = await provision.waitForStack({
            stackName: 'mmgis-dashboard-1',
            desiredStatus: ['UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'],
            pollIntervalMs: 1,
            timeoutMs: 500,
        })
        expect(stack.StackId).toBe('settled')
    })

    // A stack that never settles: the message has to name the status it was
    // stuck on, or the row's last_error says only "timed out".
    test('times out naming the last status seen', async () => {
        replayStacks([{ StackStatus: 'UPDATE_IN_PROGRESS' }])
        let error
        try {
            await provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: 'UPDATE_COMPLETE',
                pollIntervalMs: 1,
                timeoutMs: 20,
            })
        } catch (err) {
            error = err
        }
        expect(error).toBeDefined()
        expect(error.message).toBe(
            "Timed out waiting for stack 'mmgis-dashboard-1' to reach 'UPDATE_COMPLETE' (last status 'UPDATE_IN_PROGRESS')"
        )
    })

    // The busy wait-out passes the whole terminal set, and a bare array
    // interpolates as an unreadable comma run — so a set is spelled out.
    test('times out spelling out a set of desired statuses', async () => {
        replayStacks([{ StackStatus: 'UPDATE_IN_PROGRESS' }])
        let error
        try {
            await provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: ['UPDATE_COMPLETE', 'UPDATE_ROLLBACK_COMPLETE'],
                pollIntervalMs: 1,
                timeoutMs: 20,
            })
        } catch (err) {
            error = err
        }
        expect(error).toBeDefined()
        expect(error.message).toBe(
            "Timed out waiting for stack 'mmgis-dashboard-1' to settle (any of: UPDATE_COMPLETE, UPDATE_ROLLBACK_COMPLETE) (last status 'UPDATE_IN_PROGRESS')"
        )
    })

    // Someone deleting the stack out from under the wait has to read as a
    // missing stack, not as a DescribeStacks error.
    test('a stack deleted mid-wait produces the does-not-exist message', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error(
                    'Stack with id mmgis-dashboard-1 does not exist'
                )
                err.name = 'ValidationError'
                throw err
            }),
        })
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                pollIntervalMs: 1,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' does not exist (deleted or never created)"
        )
    })
})

// `prior` is the { status, lastUpdatedTime } the caller read just before
// starting an UpdateStack. DescribeStacks is eventually consistent, so the
// first polls can still return that pre-update state; LastUpdatedTime is
// what tells it apart from the converged one.
test.describe('waitForStack prior', () => {
    const BEFORE = new Date('2026-02-01T10:00:00Z')
    const AFTER = new Date('2026-02-01T10:04:00Z')

    test.afterEach(() => provision.setClients(null))

    // A never-updated stack has no LastUpdatedTime at all, so the stale read
    // is recognized by status alone. Without that, the pre-update
    // CREATE_COMPLETE trips the terminal-status check and fails an update
    // that is converging fine.
    test('a stale pre-update read is polled through, not failed', async () => {
        replayStacks([
            { StackStatus: 'CREATE_COMPLETE' },
            { StackStatus: 'UPDATE_IN_PROGRESS', LastUpdatedTime: AFTER },
            { StackStatus: 'UPDATE_COMPLETE', LastUpdatedTime: AFTER },
        ])
        const stack = await provision.waitForStack({
            stackName: 'mmgis-dashboard-1',
            desiredStatus: 'UPDATE_COMPLETE',
            prior: { status: 'CREATE_COMPLETE', lastUpdatedTime: undefined },
            pollIntervalMs: 1,
        })
        expect(stack.StackStatus).toBe('UPDATE_COMPLETE')
    })

    // The ordinary republish, converging inside one poll interval: the
    // desired status and the stale status are the SAME string, so only
    // LastUpdatedTime separates the pre-update read from the converged one.
    // Status equality alone hands back the pre-update stack; treating every
    // matching status as stale never resolves at all, because the update
    // completed before a single poll could catch it in flight.
    test('the prior state is stale until LastUpdatedTime advances, even with no in-flight read', async () => {
        replayStacks([
            {
                StackStatus: 'UPDATE_COMPLETE',
                LastUpdatedTime: BEFORE,
                StackId: 'pre',
            },
            {
                StackStatus: 'UPDATE_COMPLETE',
                LastUpdatedTime: AFTER,
                StackId: 'post',
            },
        ])
        const stack = await provision.waitForStack({
            stackName: 'mmgis-dashboard-1',
            desiredStatus: 'UPDATE_COMPLETE',
            prior: { status: 'UPDATE_COMPLETE', lastUpdatedTime: BEFORE },
            pollIntervalMs: 1,
            timeoutMs: 500,
        })
        expect(stack.StackId).toBe('post')
    })

    // The mirror image: an update that rolls back lands on the same status
    // it started from, and once LastUpdatedTime has advanced that is this
    // run's own failure — it has to throw with the reason instead of being
    // tolerated until the 30-minute timeout.
    test('a rollback back to the prior status fails once LastUpdatedTime has advanced', async () => {
        replayStacks([
            { StackStatus: 'UPDATE_ROLLBACK_COMPLETE', LastUpdatedTime: BEFORE },
            {
                StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
                LastUpdatedTime: AFTER,
                StackStatusReason: 'The new Function code is invalid',
            },
            { StackStatus: 'UPDATE_ROLLBACK_COMPLETE', LastUpdatedTime: AFTER },
        ])
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: 'UPDATE_COMPLETE',
                prior: {
                    status: 'UPDATE_ROLLBACK_COMPLETE',
                    lastUpdatedTime: BEFORE,
                },
                pollIntervalMs: 1,
                timeoutMs: 500,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' reached terminal status 'UPDATE_ROLLBACK_COMPLETE': The new Function code is invalid"
        )
    })
})

test.describe('getStackOutputs', () => {
    test('maps Outputs into a key/value object', () => {
        expect(
            provision.getStackOutputs({
                Outputs: [
                    { OutputKey: 'BucketName', OutputValue: 'bkt' },
                    { OutputKey: 'DistributionDomainName', OutputValue: 'd.cloudfront.net' },
                ],
            })
        ).toEqual({
            BucketName: 'bkt',
            DistributionDomainName: 'd.cloudfront.net',
        })
        expect(provision.getStackOutputs(null)).toEqual({})
    })
})

test.describe('emptyBucket', () => {
    test.afterEach(() => provision.setClients(null))

    test('lists and deletes every object, following pagination', async () => {
        const deleted = []
        let page = 0
        provision.setClients({
            s3: mockClient((command) => {
                const name = command.constructor.name
                if (name === 'ListObjectsV2Command') {
                    page++
                    return page === 1
                        ? {
                              Contents: [{ Key: 'a' }, { Key: 'b' }],
                              IsTruncated: true,
                              NextContinuationToken: 't',
                          }
                        : { Contents: [{ Key: 'c' }], IsTruncated: false }
                }
                if (name === 'DeleteObjectsCommand') {
                    deleted.push(
                        ...command.input.Delete.Objects.map((o) => o.Key)
                    )
                    return {}
                }
                throw new Error(`Unexpected command ${name}`)
            }),
        })
        const count = await provision.emptyBucket({ bucket: 'bkt' })
        expect(count).toBe(3)
        expect(deleted).toEqual(['a', 'b', 'c'])
    })

    test('treats a missing bucket as already empty', async () => {
        provision.setClients({
            s3: mockClient(() => {
                const err = new Error('The specified bucket does not exist')
                err.name = 'NoSuchBucket'
                throw err
            }),
        })
        expect(await provision.emptyBucket({ bucket: 'gone' })).toBe(0)
    })
})

test.describe('contentTypeForFile', () => {
    // CopyObject's MetadataDirective: REPLACE drops the source's Content-Type
    // and takes this one, so every type the upload router can write has to
    // round-trip back to itself through the extension it was stored under.
    test.each(Object.entries(IMAGE_MIME_TO_EXT))(
        "round-trips the upload router's %s",
        (mime, ext) => {
            expect(provision.contentTypeForFile('x.' + ext)).toBe(mime)
        }
    )

    test('matches extensions case-insensitively', () => {
        expect(provision.contentTypeForFile('a/b/C.PNG')).toBe('image/png')
    })

    // The catch-all a copy or upload gets when nothing maps the extension.
    test('falls back to octet-stream for an unmapped extension', () => {
        expect(provision.contentTypeForFile('a/b/c.xyz')).toBe(
            'application/octet-stream'
        )
    })
})

test.describe('cacheControlForKey', () => {
    // [key, expected Cache-Control]. Three tiers: revalidate-always for the
    // entry page and the baked config, immutable for the content-addressed
    // keys (hashed webpack output and the never-overwritten plugin uploads),
    // a short TTL for everything else.
    const TIERS = [
        ['index.html', 'no-cache'],
        ['build/index.html', 'no-cache'],
        ['Missions/M/config.json', 'no-cache'],
        [
            'build/static/js/main.abc123.js',
            'public, max-age=31536000, immutable',
        ],
        ['build/static/css/x.css', 'public, max-age=31536000, immutable'],
        ['build/static/media/a.png', 'public, max-age=31536000, immutable'],
        ['Missions/M/Data/waypoints.csv', 'public, max-age=300'],
        // Under build/static but not content-hashed, so explicitly NOT
        // immutable.
        ['build/static/cesium/Cesium.js', 'public, max-age=300'],
        ['public/workers/pdf.worker.min.mjs', 'public, max-age=300'],
        // The upload router names every object crypto.randomUUID().<ext> and
        // never overwrites, so the key is content-addressed in practice.
        [
            'assets/M/CardPlugin/uploads/a.png',
            'public, max-age=31536000, immutable',
        ],
        // Under assets/ but not the writer's shape (no /uploads/ segment two
        // levels down), so it stays on the fallback tier.
        ['assets/M/CardPlugin/icon.png', 'public, max-age=300'],
        // A lookalike: "uploads" here is the mission segment, not the
        // router's directory, so it is not the content-addressed shape.
        ['assets/uploads/a.png', 'public, max-age=300'],
    ]

    TIERS.forEach(([key, expected]) => {
        test(`'${key}' -> '${expected}'`, () => {
            expect(provision.cacheControlForKey(key)).toBe(expected)
        })
    })
})

// Runs fn(dir, puts) against a fresh temp directory with an injected S3
// client that records every command input into `puts`, then resets the client
// and removes the directory. The mock never reads the body, so the stream's
// deferred fs.open() is swallowed here — otherwise the cleanup below can race
// it into an unhandled 'error' event.
async function withUploadFixture(fn) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mmgis-upload-'))
    const puts = []
    provision.setClients({
        s3: mockClient((command) => {
            puts.push(command.input)
            if (command.input.Body) {
                command.input.Body.on('error', () => {})
                command.input.Body.destroy()
            }
            return {}
        }),
    })
    try {
        await fn(dir, puts)
    } finally {
        provision.setClients(null)
        fs.rmSync(dir, { recursive: true, force: true })
    }
}

test.describe('uploadDirectory', () => {
    test('uploads every file with the tiered Cache-Control for its key', async () => {
        await withUploadFixture(async (dir, puts) => {
            fs.mkdirSync(path.join(dir, 'static', 'js'), { recursive: true })
            fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
            fs.writeFileSync(
                path.join(dir, 'static', 'js', 'main.abc123.js'),
                'console.log(1)'
            )
            const count = await provision.uploadDirectory({
                bucket: 'dash',
                dir,
                prefix: 'build/',
            })
            expect(count).toBe(2)
            const byKey = Object.fromEntries(
                puts.map((input) => [input.Key, input])
            )
            // Only the prefixed key earns the immutable tier — the relative
            // path 'static/js/main.abc123.js' falls through to max-age=300 —
            // so this fails if the tier is read off anything but the key.
            expect(byKey['build/static/js/main.abc123.js'].CacheControl).toBe(
                'public, max-age=31536000, immutable'
            )
            expect(byKey['build/index.html'].CacheControl).toBe('no-cache')
        })
    })

    test('skips the files filter rejects, by their unprefixed key', async () => {
        await withUploadFixture(async (dir, puts) => {
            fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
            fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep')
            const count = await provision.uploadDirectory({
                bucket: 'dash',
                dir,
                prefix: 'public/',
                filter: (key) => key !== 'index.html',
            })
            expect(count).toBe(1)
            expect(puts.map((input) => input.Key)).toEqual(['public/keep.txt'])
        })
    })
})

test.describe('uploadFile', () => {
    test('sets CacheControl for the tier of the target key', async () => {
        await withUploadFixture(async (dir, puts) => {
            // The local file's own name sits on a different tier from the key
            // it is uploaded under, so this fails if the tier is read off the
            // path instead of the key.
            const filePath = path.join(dir, 'payload.txt')
            fs.writeFileSync(filePath, '<html></html>\n')
            await provision.uploadFile({
                bucket: 'dash',
                key: 'index.html',
                filePath,
            })
            // Literal, not cacheControlForKey(key): that form would pass even
            // if the tiering broke.
            expect(puts[0].CacheControl).toBe('no-cache')
        })
    })
})

test.describe('copyPrefix', () => {
    // The upload router names every file crypto.randomUUID() + the extension.
    const UPLOAD_UUID = '6f1e2a3c-4b5d-4e6f-8a9b-0c1d2e3f4a5b'

    test.afterEach(() => provision.setClients(null))

    test('same-key copies every object under the prefix', async () => {
        const copies = []
        provision.setClients({
            s3: mockClient((command) => {
                const name = command.constructor.name
                if (name === 'ListObjectsV2Command') {
                    expect(command.input.Prefix).toBe('assets/TestMission/')
                    return {
                        Contents: [
                            // The shape the upload router writes.
                            {
                                Key: `assets/TestMission/CardPlugin/uploads/${UPLOAD_UUID}.png`,
                            },
                            { Key: 'assets/TestMission/icon.png' },
                            { Key: 'assets/TestMission/with space.png' },
                        ],
                        IsTruncated: false,
                    }
                }
                if (name === 'CopyObjectCommand') {
                    copies.push(command.input)
                    return {}
                }
                throw new Error(`Unexpected command ${name}`)
            }),
        })
        const count = await provision.copyPrefix({
            sourceBucket: 'shared',
            destBucket: 'dash',
            prefix: 'assets/TestMission/',
        })
        expect(count).toBe(3)
        // Same keys in the destination bucket
        expect(copies[1].Bucket).toBe('dash')
        expect(copies[1].Key).toBe('assets/TestMission/icon.png')
        // CopySource is "bucket/key" with the separators left intact —
        // NOT encodeURIComponent of the whole string (that would turn the
        // slashes into %2F and break the copy).
        expect(copies[1].CopySource).toBe('shared/assets/TestMission/icon.png')
        // Special chars inside a segment are encoded; the "/" separators
        // and the bucket/key boundary are preserved.
        expect(copies[2].Key).toBe('assets/TestMission/with space.png')
        expect(copies[2].CopySource).toBe(
            'shared/assets/TestMission/with%20space.png'
        )
        // CopyObject's default (COPY) keeps the source's metadata and cannot
        // add the Cache-Control the source never had; REPLACE can, and in turn
        // obliges the copy to restate its Content-Type. Tier coverage lives in
        // the cacheControlForKey table — this pins the wiring at this site,
        // across both tiers a copied object can land on.
        expect(copies[0].MetadataDirective).toBe('REPLACE')
        expect(copies[0].ContentType).toBe('image/png')
        expect(copies[0].CacheControl).toBe(
            'public, max-age=31536000, immutable'
        )
        expect(copies[1].MetadataDirective).toBe('REPLACE')
        expect(copies[1].ContentType).toBe('image/png')
        expect(copies[1].CacheControl).toBe('public, max-age=300')
    })
})

test.describe('runPublishTask', () => {
    const ENV_NAMES = [
        'MMGIS_PUBLISH_ECS_CLUSTER',
        'MMGIS_PUBLISH_TASK_DEFINITION',
        'MMGIS_PUBLISH_SUBNETS',
        'MMGIS_PUBLISH_SECURITY_GROUPS',
    ]
    let savedEnv

    test.beforeEach(() => {
        savedEnv = {}
        ENV_NAMES.forEach((name) => {
            savedEnv[name] = process.env[name]
            delete process.env[name]
        })
    })

    test.afterEach(() => {
        ENV_NAMES.forEach((name) => {
            if (savedEnv[name] === undefined) delete process.env[name]
            else process.env[name] = savedEnv[name]
        })
        provision.setClients(null)
    })

    test('throws a clear error when configuration is missing', async () => {
        provision.setClients({ ecs: mockClient(() => ({})) })
        await expect(
            provision.runPublishTask({ deploymentId: 1, action: 'publish' })
        ).rejects.toThrow(/MMGIS_PUBLISH_ECS_CLUSTER/)
    })

    test('starts the task with the deployment id and action', async () => {
        process.env.MMGIS_PUBLISH_ECS_CLUSTER = 'mmgis-cluster'
        process.env.MMGIS_PUBLISH_TASK_DEFINITION = 'mmgis-publish'
        process.env.MMGIS_PUBLISH_SUBNETS = 'subnet-1, subnet-2'
        process.env.MMGIS_PUBLISH_SECURITY_GROUPS = 'sg-1'

        let input
        provision.setClients({
            ecs: mockClient((command) => {
                input = command.input
                return { tasks: [{ taskArn: 'arn:aws:ecs:task/1' }], failures: [] }
            }),
        })
        const arn = await provision.runPublishTask({
            deploymentId: 7,
            action: 'update',
        })
        expect(arn).toBe('arn:aws:ecs:task/1')
        expect(input.cluster).toBe('mmgis-cluster')
        expect(input.taskDefinition).toBe('mmgis-publish')
        expect(input.networkConfiguration.awsvpcConfiguration.subnets).toEqual(
            ['subnet-1', 'subnet-2']
        )
        const env = input.overrides.containerOverrides[0].environment
        expect(env).toContainEqual({ name: 'MMGIS_DEPLOYMENT_ID', value: '7' })
        expect(env).toContainEqual({ name: 'MMGIS_DEPLOYMENT_ACTION', value: 'update' })
    })

    test('throws when RunTask reports failures', async () => {
        process.env.MMGIS_PUBLISH_ECS_CLUSTER = 'mmgis-cluster'
        process.env.MMGIS_PUBLISH_TASK_DEFINITION = 'mmgis-publish'
        process.env.MMGIS_PUBLISH_SUBNETS = 'subnet-1'
        process.env.MMGIS_PUBLISH_SECURITY_GROUPS = 'sg-1'

        provision.setClients({
            ecs: mockClient(() => ({
                tasks: [],
                failures: [{ reason: 'RESOURCE:MEMORY' }],
            })),
        })
        await expect(
            provision.runPublishTask({ deploymentId: 7, action: 'publish' })
        ).rejects.toThrow(/RESOURCE:MEMORY/)
    })
})
