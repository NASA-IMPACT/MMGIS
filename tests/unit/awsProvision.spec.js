import { test, expect } from 'vitest'

// Tests for scripts/lib/aws-provision.js using injected mock clients —
// no test here (or anywhere) ever calls real AWS.

const provision = require('../../scripts/lib/aws-provision')

function mockClient(handler) {
    return { send: async (command) => handler(command) }
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

    test('re-prefixes the destination keys when destPrefix is given', async () => {
        const copies = []
        provision.setClients({
            s3: mockClient((command) => {
                const name = command.constructor.name
                if (name === 'ListObjectsV2Command') {
                    expect(command.input.Prefix).toBe('assets/OldMission/')
                    return {
                        Contents: [
                            { Key: 'assets/OldMission/look/uploads/logo.png' },
                            { Key: 'assets/OldMission/CardTool/a.geojson' },
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
            destBucket: 'shared',
            prefix: 'assets/OldMission/',
            destPrefix: 'assets/NewMission/',
        })
        expect(count).toBe(2)
        // Only the leading prefix is swapped; the rest of the key is kept.
        expect(copies.map((c) => c.Key)).toEqual([
            'assets/NewMission/look/uploads/logo.png',
            'assets/NewMission/CardTool/a.geojson',
        ])
        // The source still reads from the old prefix.
        expect(copies[0].CopySource).toBe(
            'shared/assets/OldMission/look/uploads/logo.png'
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
