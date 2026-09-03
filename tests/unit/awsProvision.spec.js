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
        // The template this run rendered is what reaches CloudFormation.
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

test.describe('busyStatusOf', () => {
    const busyMessage = (status) =>
        'Stack:arn:aws:cloudformation:us-west-2:111122223333:stack/mmgis-dashboard-1/abc ' +
        `is in ${status} state and can not be updated.`

    const validationError = (message) =>
        Object.assign(new Error(message), { name: 'ValidationError' })

    // A second republish click starts a second ECS task, whose UpdateStack
    // CloudFormation rejects because the winner's operation is genuinely in
    // flight. Recognizing that rejection is the difference between a harmless
    // double click (wait it out, retry) and a row marked failed — and the
    // status it names is what the converge loop reports it is waiting on.
    test('hands back the in-flight status a busy rejection names', () => {
        expect(
            provision.busyStatusOf(
                validationError(busyMessage('UPDATE_IN_PROGRESS'))
            )
        ).toBe('UPDATE_IN_PROGRESS')
        expect(
            provision.busyStatusOf(
                validationError(busyMessage('CREATE_IN_PROGRESS'))
            )
        ).toBe('CREATE_IN_PROGRESS')
    })

    test('answers null for anything that is not a busy rejection', () => {
        const otherName = Object.assign(
            new Error(busyMessage('UPDATE_IN_PROGRESS')),
            { name: 'ThrottlingException' }
        )
        expect(provision.busyStatusOf(otherName)).toBe(null)

        // The other ValidationError the update path can see stays a no-op,
        // not a race to wait out.
        expect(
            provision.busyStatusOf(
                validationError('No updates are to be performed.')
            )
        ).toBe(null)

        expect(provision.busyStatusOf(null)).toBe(null)
    })

    // CloudFormation reuses this wording for the delete-only statuses too, and
    // treating one of those as busy would wait forever on an operation that is
    // never coming (see UNUSABLE_STACK_STATUSES).
    test('answers null for a delete-only status in the rejection', () => {
        const deleteOnly = [
            'UPDATE_ROLLBACK_FAILED',
            'DELETE_IN_PROGRESS',
            'REVIEW_IN_PROGRESS',
        ]
        deleteOnly.forEach((status) => {
            expect(
                provision.busyStatusOf(validationError(busyMessage(status))),
                status
            ).toBe(null)
        })
    })
})

// The convergence loop (see convergeStackUpdate's docblock). Driven with a cfn
// mock that scripts what each kind of command answers.
test.describe('convergeStackUpdate', () => {
    test.afterEach(() => provision.setClients(null))

    const BEFORE = new Date('2026-02-01T10:00:00Z')
    const WINNER = new Date('2026-02-01T10:03:00Z')
    const OURS = new Date('2026-02-01T10:06:00Z')

    // Scripts cfn.send with one queue per command kind: `updates` answers the
    // UpdateStack calls and `describes` the DescribeStacks calls, each in
    // order, with its last entry repeating so a poll can settle. A step is
    // { reply } or { throw }; a Describe reply is wrapped as { Stacks: [reply] }.
    // Splitting the queues means a test says what a command answers rather than
    // where it falls in the interleaving, so a read added or dropped between
    // two UpdateStacks doesn't rewrite every script.
    function scriptCfn({ updates = [], describes = [] }) {
        const state = { updates: 0, describes: 0, updateInputs: [] }
        const next = (queue, index, kind) => {
            const step = queue[Math.min(index, queue.length - 1)]
            if (step == null) throw new Error(`Unscripted ${kind} command`)
            return step
        }
        provision.setClients({
            cfn: mockClient((command) => {
                const kind = command.constructor.name
                if (kind === 'UpdateStackCommand') {
                    state.updateInputs.push(command.input)
                    const step = next(updates, state.updates++, kind)
                    if (step.throw) throw step.throw
                    return step.reply || {}
                }
                const step = next(describes, state.describes++, kind)
                if (step.throw) throw step.throw
                return { Stacks: [step.reply] }
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

    // A stack that rejects every UpdateStack as busy and settles instantly
    // between them, so the loop can only ever stop on one of its own bounds.
    // Each read carries a newer LastUpdatedTime than the one before it, so a
    // wait-out sees the operation it waited on land instead of polling a read
    // it has to treat as stale.
    function alwaysBusyCfn() {
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
    }

    // The loser waits the winner out and then runs its OWN UpdateStack, and
    // never resolves on a still-in-progress read. Our own update is what the
    // returned stack reflects (OURS, not the winner's).
    test('waits out an in-flight winner, then runs and waits for OUR own update', async () => {
        const state = scriptCfn({
            updates: [
                // attempt 0: our UpdateStack is rejected — winner in flight
                { throw: busyError() },
                // attempt 1: our UpdateStack now accepted
                { reply: {} },
            ],
            describes: [
                // attempt 0's read
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: BEFORE,
                    },
                },
                // wait-out poll 1: the busy rejection is itself proof an
                // operation is in flight, so this pre-rejection read is stale
                // and must NOT end the wait-out — retrying here would walk
                // straight back into the same rejection
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: BEFORE,
                    },
                },
                // wait-out poll 2: the winner, mid-update
                { reply: { StackStatus: 'UPDATE_IN_PROGRESS' } },
                // wait-out poll 3: the winner settled
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: WINNER,
                    },
                },
                // attempt 1's read
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: WINNER,
                    },
                },
                // final wait poll 1: stale winner read (same status, WINNER
                // time) — prior blocks it from resolving us
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: WINNER,
                        StackId: 'winner',
                    },
                },
                // final wait poll 2: our update in flight
                {
                    reply: {
                        StackStatus: 'UPDATE_IN_PROGRESS',
                        LastUpdatedTime: OURS,
                    },
                },
                // final wait poll 3: our update landed
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: OURS,
                        StackId: 'ours',
                    },
                },
            ],
        })
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{"our":"template"}',
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('ours')
        // Our own UpdateStack ran twice (rejected, then accepted): the loser
        // did not merely ride the winner's update, and both attempts carried
        // this run's template.
        expect(state.updates).toBe(2)
        expect(state.updateInputs.map((input) => input.TemplateBody)).toEqual([
            '{"our":"template"}',
            '{"our":"template"}',
        ])
    })

    // Another task can converge the stack moments before this attempt reads
    // it. Its UPDATE_COMPLETE must not be accepted as proof our own update
    // landed — that would hand the caller the other task's stack.
    test('waits for OUR update, not a read another task already converged', async () => {
        const state = scriptCfn({
            updates: [{ reply: {} }],
            describes: [
                // this attempt's read: another task converged just before it
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: WINNER,
                    },
                },
                // final wait poll 1: stale relative to OUR update
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: WINNER,
                        StackId: 'theirs',
                    },
                },
                // final wait poll 2: our update in flight
                {
                    reply: {
                        StackStatus: 'UPDATE_IN_PROGRESS',
                        LastUpdatedTime: OURS,
                    },
                },
                // final wait poll 3: our update landed
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: OURS,
                        StackId: 'ours',
                    },
                },
            ],
        })
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('ours')
        expect(state.updates).toBe(1)
    })

    // A delete started while this task was baking and building leaves a stack
    // with no bucket to publish into; the read at the top of the attempt is
    // what catches it.
    test('a delete that starts mid-build stops with the guidance', async () => {
        const state = scriptCfn({
            describes: [{ reply: { StackStatus: 'DELETE_IN_PROGRESS' } }],
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                pollIntervalMs: 1,
                timeoutMs: 2000,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' is in DELETE_IN_PROGRESS and cannot be used"
        )
        expect(state.updates).toBe(0)
    })

    // A delete that finished mid-build leaves nothing to converge onto.
    // Publishing again is what recreates the dashboard, so the message has to
    // say the stack is gone rather than report some stale read of it.
    test('a stack deleted mid-build stops with the does-not-exist message', async () => {
        const state = scriptCfn({
            describes: [
                {
                    throw: Object.assign(
                        new Error(
                            'Stack with id mmgis-dashboard-1 does not exist'
                        ),
                        { name: 'ValidationError' }
                    ),
                },
            ],
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                pollIntervalMs: 1,
                timeoutMs: 2000,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' does not exist (deleted or never created)"
        )
        expect(state.updates).toBe(0)
    })

    // A wait-out can settle on a delete-only status; retrying UpdateStack
    // there would surface CloudFormation's own opaque rejection instead of the
    // guidance (see UNUSABLE_STACK_STATUSES).
    test('a wait-out that settles in a delete-only status stops with the guidance', async () => {
        const state = scriptCfn({
            // attempt 0: rejected — an operation is in flight
            updates: [{ throw: busyError() }],
            describes: [
                // attempt 0's read
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: BEFORE,
                    },
                },
                { reply: { StackStatus: 'ROLLBACK_IN_PROGRESS' } },
                // wait-out: it settled somewhere only a delete moves it out of
                {
                    reply: {
                        StackStatus: 'ROLLBACK_COMPLETE',
                        LastUpdatedTime: WINNER,
                    },
                },
            ],
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
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
        scriptCfn({
            updates: [{ reply: {} }],
            describes: [
                // attempt 0's read
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: BEFORE,
                    },
                },
                {
                    reply: {
                        StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
                        LastUpdatedTime: OURS,
                        StackStatusReason: 'The new Function code is invalid',
                    },
                },
                {
                    reply: {
                        StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
                        LastUpdatedTime: OURS,
                    },
                },
            ],
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
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
        const state = scriptCfn({
            updates: [
                // attempt 0: rejected — the winner is mid-update
                { throw: busyError() },
                // attempt 1: our UpdateStack is accepted from that status
                { reply: {} },
            ],
            describes: [
                // attempt 0's read
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: BEFORE,
                    },
                },
                { reply: { StackStatus: 'UPDATE_IN_PROGRESS' } },
                // wait-out: the winner's update rolled back
                {
                    reply: {
                        StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
                        LastUpdatedTime: WINNER,
                    },
                },
                // attempt 1's read
                {
                    reply: {
                        StackStatus: 'UPDATE_ROLLBACK_COMPLETE',
                        LastUpdatedTime: WINNER,
                    },
                },
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: OURS,
                        StackId: 'ours',
                    },
                },
            ],
        })
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('ours')
        expect(state.updates).toBe(2)
    })

    // The stack may be mid-create; after waiting that out, the template is
    // already converged and CloudFormation reports "no updates". The stack
    // handed back has to be a read taken after the wait — the in-progress one
    // carries no Outputs, so publish would fail on the missing BucketName.
    test('returns the settled stack, not the pre-wait snapshot, when there is nothing to update', async () => {
        const settled = {
            StackStatus: 'CREATE_COMPLETE',
            StackId: 'settled',
            Outputs: [{ OutputKey: 'BucketName', OutputValue: 'b' }],
        }
        const state = scriptCfn({
            updates: [
                // attempt 0: rejected — the create is still in flight
                { throw: busyError() },
                // attempt 1: the created stack already matches our template
                {
                    throw: Object.assign(
                        new Error('No updates are to be performed.'),
                        { name: 'ValidationError' }
                    ),
                },
            ],
            describes: [
                { reply: { StackStatus: 'CREATE_IN_PROGRESS' } },
                // wait-out: the create finished, and only now are there Outputs
                { reply: settled },
            ],
        })
        const stack = await provision.convergeStackUpdate({
            stackName: 'mmgis-dashboard-1',
            templateBody: '{}',
            pollIntervalMs: 1,
            timeoutMs: 2000,
        })
        expect(stack.StackId).toBe('settled')
        expect(provision.getStackOutputs(stack)).toEqual({ BucketName: 'b' })
        // Two UpdateStack attempts (rejected, then "no updates") over three
        // reads: one at the top of each attempt, plus the poll that ended the
        // wait-out.
        expect(state.updates).toBe(2)
        expect(state.describes).toBe(3)
    })

    // A stack that never frees up must fail the row, not loop forever.
    test('gives up after maxBusyRetries when the stack stays busy', async () => {
        alwaysBusyCfn()
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                maxBusyRetries: 2,
                pollIntervalMs: 1,
                timeoutMs: 2000,
            })
        ).rejects.toThrow(/stayed busy after 3 UpdateStack attempts/)
    })

    // Each wait-out is bounded on its own, so a stack that keeps settling and
    // going busy again could burn the retry budget for hours. The whole
    // convergence shares one deadline, which stops it long before that.
    test('gives up when the convergence deadline passes', async () => {
        alwaysBusyCfn()
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                // Room for far more attempts than the deadline allows, so the
                // deadline is what stops the loop.
                maxBusyRetries: 100,
                deadlineMs: 1,
                pollIntervalMs: 5,
            })
        ).rejects.toThrow(/did not converge within/)
    })

    // A wait the shared deadline cut short rejects with an ordinary poll
    // timeout; reported as-is it would name a wait's clock instead of the
    // budget the whole convergence actually ran out of.
    test('a wait the deadline cuts short is reported as the deadline', async () => {
        scriptCfn({
            updates: [{ reply: {} }],
            describes: [
                {
                    reply: {
                        StackStatus: 'UPDATE_COMPLETE',
                        LastUpdatedTime: BEFORE,
                    },
                },
                // Our update never lands, so the converge wait polls until its
                // budget — the deadline's remainder — is gone.
                { reply: { StackStatus: 'UPDATE_IN_PROGRESS' } },
            ],
        })
        await expect(
            provision.convergeStackUpdate({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
                deadlineMs: 20,
                pollIntervalMs: 1,
            })
        ).rejects.toThrow(/did not converge within/)
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

    // A terminal status the wait is not after can never become the one it is,
    // so it throws on the first read rather than polling out the timeout.
    // UPDATE_FAILED is where an out-of-band `update-stack --disable-rollback`
    // leaves a real stack; ROLLBACK_COMPLETE is where a failed create rests.
    test('throws promptly on a terminal status it is not waiting for', async () => {
        const terminal = [
            ['UPDATE_FAILED', 'The new Function code is invalid'],
            ['ROLLBACK_COMPLETE', 'Resource creation cancelled'],
        ]
        for (const [status, reason] of terminal) {
            const state = replayStacks([
                { StackStatus: status, StackStatusReason: reason },
            ])
            await expect(
                provision.waitForStack({
                    stackName: 'mmgis-dashboard-1',
                    desiredStatus: 'UPDATE_COMPLETE',
                    pollIntervalMs: 1,
                    timeoutMs: 500,
                })
            ).rejects.toThrow(
                `Stack 'mmgis-dashboard-1' reached terminal status '${status}': ${reason}`
            )
            expect(state.polls, status).toBe(1)
        }
    })

    // CloudFormation stamps "User Initiated" on the status that starts an
    // operation and usually leaves the terminal status's reason empty, so the
    // wait carries the last real reason forward. Carrying the boilerplate one
    // too would end the failure message with "User Initiated" — the one thing
    // that is never why the stack failed.
    test('the thrown message carries the real reason, never the User Initiated stamp', async () => {
        replayStacks([
            {
                StackStatus: 'UPDATE_IN_PROGRESS',
                StackStatusReason: 'User Initiated',
            },
            {
                StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
                StackStatusReason: 'The new Function code is invalid',
            },
            { StackStatus: 'UPDATE_ROLLBACK_COMPLETE' },
        ])
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: 'UPDATE_COMPLETE',
                pollIntervalMs: 1,
                timeoutMs: 500,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' reached terminal status 'UPDATE_ROLLBACK_COMPLETE': The new Function code is invalid"
        )
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
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: 'UPDATE_COMPLETE',
                pollIntervalMs: 1,
                timeoutMs: 20,
            })
        ).rejects.toThrow(/Timed out.*UPDATE_IN_PROGRESS/)
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
    // a short TTL for everything else. The upload-key half of the immutable
    // tier belongs to tests/unit/uploadKeyClassifier.spec.js, which checks it
    // against the other two copies of that classifier.
    const TIERS = [
        ['index.html', 'no-cache'],
        ['build/index.html', 'no-cache'],
        ['Missions/M/config.json', 'no-cache'],
        ['build/static/js/main.abc123.js', 'max-age=31536000, immutable'],
        ['build/static/css/x.css', 'max-age=31536000, immutable'],
        ['build/static/media/a.png', 'max-age=31536000, immutable'],
        ['build/asset-manifest.json', 'max-age=300'],
        // Under build/static but not content-hashed, so explicitly NOT
        // immutable.
        ['build/static/cesium/Cesium.js', 'max-age=300'],
        ['public/workers/pdf.worker.min.mjs', 'max-age=300'],
    ]

    // No tier says "public": the responses are password-gated, and CloudFront
    // caches on max-age alone.
    test.each(TIERS)("'%s' -> '%s'", (key, expected) => {
        expect(provision.cacheControlForKey(key)).toBe(expected)
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
                'max-age=31536000, immutable'
            )
            expect(byKey['build/index.html'].CacheControl).toBe('no-cache')
        })
    })

    test('skips the files filter rejects, by their prefixed key', async () => {
        await withUploadFixture(async (dir, puts) => {
            // The filter names the prefixed key, so it fails to match — and
            // nothing is skipped — if the filter is handed the relative one.
            fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>')
            fs.writeFileSync(path.join(dir, 'keep.txt'), 'keep')
            const count = await provision.uploadDirectory({
                bucket: 'dash',
                dir,
                prefix: 'public/',
                filter: (key) => key !== 'public/index.html',
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
    const UPLOAD_KEY = `assets/TestMission/CardPlugin/uploads/${UPLOAD_UUID}.png`

    // What each mocked source object carries as its own Content-Type, for the
    // extensions the table does not name. An empty head is a source with none.
    const SOURCE_HEADS = {
        'assets/TestMission/scan.tif': { ContentType: 'image/tiff' },
        'assets/TestMission/untyped.bin': {},
    }

    const SOURCE_KEYS = [
        // The shape the upload router writes.
        UPLOAD_KEY,
        'assets/TestMission/icon.png',
        'assets/TestMission/with space.png',
        'assets/TestMission/photo.jpg',
        ...Object.keys(SOURCE_HEADS),
    ]

    const byKey = (copies) =>
        Object.fromEntries(copies.map((input) => [input.Key, input]))

    test.afterEach(() => provision.setClients(null))

    test('same-key copies every object under the prefix', async () => {
        const copies = []
        const heads = []
        provision.setClients({
            s3: mockClient((command) => {
                const name = command.constructor.name
                if (name === 'ListObjectsV2Command') {
                    expect(command.input.Prefix).toBe('assets/TestMission/')
                    return {
                        Contents: SOURCE_KEYS.map((Key) => ({ Key })),
                        IsTruncated: false,
                    }
                }
                if (name === 'HeadObjectCommand') {
                    heads.push(command.input.Key)
                    return SOURCE_HEADS[command.input.Key]
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
        expect(count).toBe(SOURCE_KEYS.length)
        const copied = byKey(copies)
        // Same keys in the destination bucket
        expect(Object.keys(copied).sort()).toEqual([...SOURCE_KEYS].sort())
        const icon = copied['assets/TestMission/icon.png']
        expect(icon.Bucket).toBe('dash')
        // CopySource is "bucket/key" with the separators left intact —
        // NOT encodeURIComponent of the whole string (that would turn the
        // slashes into %2F and break the copy).
        expect(icon.CopySource).toBe('shared/assets/TestMission/icon.png')
        // Special chars inside a segment are encoded; the "/" separators
        // and the bucket/key boundary are preserved.
        expect(copied['assets/TestMission/with space.png'].CopySource).toBe(
            'shared/assets/TestMission/with%20space.png'
        )
        // REPLACE lets the copy carry its own Cache-Control and Content-Type.
        expect(copied[UPLOAD_KEY].MetadataDirective).toBe('REPLACE')
        // An upload key gets the immutable tier, everything else the short one.
        expect(copied[UPLOAD_KEY].CacheControl).toBe(
            'max-age=31536000, immutable'
        )
        expect(icon.CacheControl).toBe('max-age=300')
        // A mapped extension is typed from the key alone...
        expect(icon.ContentType).toBe('image/png')
        expect(copied['assets/TestMission/photo.jpg'].ContentType).toBe(
            'image/jpeg'
        )
        // ...and only an unmapped one costs a HeadObject, which is what keeps
        // the source's own type instead of downgrading it to octet-stream...
        expect(heads).toEqual(Object.keys(SOURCE_HEADS))
        expect(copied['assets/TestMission/scan.tif'].ContentType).toBe(
            'image/tiff'
        )
        // ...which is where a source with no Content-Type of its own lands.
        expect(copied['assets/TestMission/untyped.bin'].ContentType).toBe(
            'application/octet-stream'
        )
    })

    test('copies the pages after the first the same way', async () => {
        // A prefix holding more than a page of objects lists truncated, and
        // every later page has to be copied under the same rules — a loop that
        // stopped after page one would leave those objects behind in the
        // shared bucket, missing from the published dashboard.
        const copies = []
        const tokens = []
        provision.setClients({
            s3: mockClient((command) => {
                const name = command.constructor.name
                if (name === 'ListObjectsV2Command') {
                    tokens.push(command.input.ContinuationToken)
                    if (command.input.ContinuationToken == null)
                        return {
                            Contents: [{ Key: 'assets/TestMission/one.png' }],
                            IsTruncated: true,
                            NextContinuationToken: 'page-two',
                        }
                    return {
                        Contents: [{ Key: 'assets/TestMission/two.png' }],
                        // A last page can still name a token; IsTruncated is
                        // what ends the loop.
                        IsTruncated: false,
                        NextContinuationToken: 'page-three',
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
        expect(count).toBe(2)
        expect(tokens).toEqual([undefined, 'page-two'])
        const pageTwo = byKey(copies)['assets/TestMission/two.png']
        expect(pageTwo.Bucket).toBe('dash')
        expect(pageTwo.MetadataDirective).toBe('REPLACE')
        expect(pageTwo.CacheControl).toBe('max-age=300')
        expect(pageTwo.ContentType).toBe('image/png')
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
