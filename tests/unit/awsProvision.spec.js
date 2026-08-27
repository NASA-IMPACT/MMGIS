import { test, expect } from 'vitest'

// Tests for scripts/lib/aws-provision.js using injected mock clients —
// no test here (or anywhere) ever calls real AWS.

const provision = require('../../scripts/lib/aws-provision')

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

    // Pins the name half of the guard: without it an unrelated error
    // carrying the same text is swallowed as "nothing to change", reporting
    // success for a publish that never happened.
    test('an error with the no-updates message but another name still rethrows', async () => {
        provision.setClients({
            cfn: mockClient(() => {
                const err = new Error('No updates are to be performed.')
                err.name = 'CredentialsProviderError'
                throw err
            }),
        })
        await expect(
            provision.updateStack({
                stackName: 'mmgis-dashboard-1',
                templateBody: '{}',
            })
        ).rejects.toThrow(/No updates are to be performed/)
    })
})

// Which status the publish path waits for when it finds a stack
// mid-operation. An in-flight rollback settles at UPDATE_ROLLBACK_COMPLETE
// and can never reach UPDATE_COMPLETE, so waiting for that would always
// throw — even though the same status at rest is reusable.
test.describe('settleStatusFor', () => {
    // [status found, status it settles at]
    const CASES = [
        ['UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE'],
        [
            'UPDATE_ROLLBACK_COMPLETE_CLEANUP_IN_PROGRESS',
            'UPDATE_ROLLBACK_COMPLETE',
        ],
        ['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE'],
        ['UPDATE_COMPLETE_CLEANUP_IN_PROGRESS', 'UPDATE_COMPLETE'],
        ['CREATE_IN_PROGRESS', 'CREATE_COMPLETE'],
        // Terminal and permanently stuck, and the prefix match sends it to a
        // target it can never reach. Harmless only because waitForStack
        // checks TERMINAL_STACK_STATUSES first — pinned below.
        ['UPDATE_FAILED', 'UPDATE_COMPLETE'],
    ]

    for (const [found, settlesAt] of CASES)
        test(`${found} settles at ${settlesAt}`, () => {
            expect(provision.settleStatusFor(found)).toBe(settlesAt)
        })
})

test.describe('isStackBusyError', () => {
    // A second republish click starts a second ECS task, whose UpdateStack
    // CloudFormation rejects outright. Recognizing that rejection is the
    // difference between a harmless double click and a deployment row marked
    // failed after the first task succeeded.
    test('classifies the concurrent-operation ValidationError and nothing else', () => {
        const busy = new Error(
            'Stack:arn:aws:cloudformation:us-west-2:111122223333:stack/mmgis-dashboard-1/abc ' +
                'is in UPDATE_IN_PROGRESS state and can not be updated.'
        )
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
})

// The wait parameters publish-static spreads into waitForStack(). Dropping
// one here is dropping it from the real call, which is what these rows pin.
test.describe('planStackWait', () => {
    test('no stack yet: create, then wait for CREATE_COMPLETE', () => {
        expect(
            provision.planStackWait({ action: 'publish', existing: null })
        ).toEqual({
            mode: 'create',
            wait: { desiredStatus: 'CREATE_COMPLETE', prior: null },
        })
    })

    for (const status of [
        'CREATE_COMPLETE',
        'UPDATE_COMPLETE',
        'UPDATE_ROLLBACK_COMPLETE',
    ])
        test(`a stack resting at ${status} is reused, with no wait at all`, () => {
            expect(
                provision.planStackWait({
                    action: 'publish',
                    existing: { StackStatus: status },
                })
            ).toEqual({ mode: 'reuse', wait: null })
        })

    for (const [found, desiredStatus] of [
        ['CREATE_IN_PROGRESS', 'CREATE_COMPLETE'],
        ['UPDATE_IN_PROGRESS', 'UPDATE_COMPLETE'],
        ['UPDATE_ROLLBACK_IN_PROGRESS', 'UPDATE_ROLLBACK_COMPLETE'],
    ])
        test(`a stack found at ${found} is settled to ${desiredStatus}`, () => {
            expect(
                provision.planStackWait({
                    action: 'publish',
                    existing: { StackStatus: found },
                })
            ).toEqual({
                mode: 'settle',
                // No prior: nothing this run started, so every read is real.
                wait: { desiredStatus, prior: null },
            })
        })

    test('update: waits for UPDATE_COMPLETE keyed on the pre-update LastUpdatedTime', () => {
        const lastUpdatedTime = new Date('2026-02-01T00:00:00Z')
        expect(
            provision.planStackWait({
                action: 'update',
                existing: {
                    StackStatus: 'UPDATE_COMPLETE',
                    LastUpdatedTime: lastUpdatedTime,
                },
            })
        ).toEqual({
            mode: 'update',
            wait: {
                desiredStatus: 'UPDATE_COMPLETE',
                prior: { status: 'UPDATE_COMPLETE', lastUpdatedTime },
            },
        })
    })

    test('update of a never-updated stack carries the absent LastUpdatedTime through', () => {
        expect(
            provision.planStackWait({
                action: 'update',
                existing: { StackStatus: 'CREATE_COMPLETE' },
            }).wait.prior
        ).toEqual({ status: 'CREATE_COMPLETE', lastUpdatedTime: undefined })
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
    // here: terminal and stuck until someone continues the rollback or
    // deletes it. Absent from TERMINAL_STACK_STATUSES it is polled for the
    // full 30 minutes and then reported as a timeout — and settleStatusFor
    // sends it toward UPDATE_COMPLETE, which it can never reach, so the
    // terminal check has to win.
    test('throws promptly on UPDATE_FAILED rather than polling toward its settle target', async () => {
        const state = replayStacks([
            {
                StackStatus: 'UPDATE_FAILED',
                StackStatusReason: 'The new Function code is invalid',
            },
        ])
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: provision.settleStatusFor('UPDATE_FAILED'),
                pollIntervalMs: 1,
                timeoutMs: 500,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' reached terminal status 'UPDATE_FAILED': The new Function code is invalid"
        )
        expect(state.polls).toBe(1)
    })

    // CloudFormation puts the failure reason on the IN_PROGRESS rollback and
    // typically leaves it empty on the terminal one, so reading it only off
    // the status we throw on produces a reasonless error — and the reason is
    // the operator's only clue about what in the template failed.
    test('reports the reason seen mid-rollback when the terminal status carries none', async () => {
        replayStacks([
            {
                StackStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
                StackStatusReason:
                    'The following resource(s) failed to update: [DashboardAuthFunction].',
            },
            { StackStatus: 'UPDATE_ROLLBACK_COMPLETE' },
        ])
        await expect(
            provision.waitForStack({
                stackName: 'mmgis-dashboard-1',
                desiredStatus: 'UPDATE_COMPLETE',
                pollIntervalMs: 1,
            })
        ).rejects.toThrow(
            "Stack 'mmgis-dashboard-1' reached terminal status 'UPDATE_ROLLBACK_COMPLETE': " +
                'The following resource(s) failed to update: [DashboardAuthFunction].'
        )
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
        const state = replayStacks([
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
        expect(state.polls).toBe(3)
    })

    // The ordinary republish, converging inside one poll interval: the
    // desired status and the stale status are the SAME string, so only
    // LastUpdatedTime separates the pre-update read from the converged one.
    // Status equality alone hands back the pre-update stack; treating every
    // matching status as stale never resolves at all, because the update
    // completed before a single poll could catch it in flight.
    test('the prior state is stale until LastUpdatedTime advances, even with no in-flight read', async () => {
        const state = replayStacks([
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
        expect(state.polls).toBe(2)
    })

    // The mirror image: an update that rolls back lands on the same status
    // it started from, and once LastUpdatedTime has advanced that is this
    // run's own failure — it has to throw with the reason instead of being
    // tolerated until the 30-minute timeout.
    test('a rollback back to the prior status fails once LastUpdatedTime has advanced', async () => {
        const state = replayStacks([
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
        // Promptly: the third poll decided it, no waiting out the timeout.
        expect(state.polls).toBe(3)
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

test.describe('copyPrefix', () => {
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
                            { Key: 'assets/TestMission/icon.png' },
                            { Key: 'assets/TestMission/photo.jpg' },
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
        expect(copies[0].Bucket).toBe('dash')
        expect(copies[0].Key).toBe('assets/TestMission/icon.png')
        // CopySource is "bucket/key" with the separators left intact —
        // NOT encodeURIComponent of the whole string (that would turn the
        // slashes into %2F and break the copy).
        expect(copies[0].CopySource).toBe('shared/assets/TestMission/icon.png')
        // Special chars inside a segment are encoded; the "/" separators
        // and the bucket/key boundary are preserved.
        expect(copies[2].Key).toBe('assets/TestMission/with space.png')
        expect(copies[2].CopySource).toBe(
            'shared/assets/TestMission/with%20space.png'
        )
    })
})

test.describe('copyObjectIfExists', () => {
    test.afterEach(() => provision.setClients(null))

    test('returns false when the source object is absent', async () => {
        provision.setClients({
            s3: mockClient(() => {
                const err = new Error('NoSuchKey')
                err.name = 'NoSuchKey'
                throw err
            }),
        })
        expect(
            await provision.copyObjectIfExists({
                sourceBucket: 'shared',
                destBucket: 'dash',
                key: 'Missions/Test/Data/mosaic_parameters.csv',
            })
        ).toBe(false)
    })

    test('returns true when copied', async () => {
        provision.setClients({ s3: mockClient(() => ({})) })
        expect(
            await provision.copyObjectIfExists({
                sourceBucket: 'shared',
                destBucket: 'dash',
                key: 'Missions/Test/Data/mosaic_parameters.csv',
            })
        ).toBe(true)
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
