import { test, expect } from '@playwright/test'

// Tests for teardownDeployment in
// API/Backend/Deployments/routes/deployments.js using injected mock AWS
// clients (the same seam as awsProvision.spec.js) — no real AWS is touched.

const provision = require('../../scripts/lib/aws-provision')
const {
    teardownDeployment,
} = require('../../API/Backend/Deployments/routes/deployments')

function mockClient(handler) {
    return { send: async (command) => handler(command) }
}

test.describe('teardownDeployment', () => {
    test.afterEach(() => provision.setClients(null))

    test('resolves the bucket from the stack output when settings.bucket is null, then deletes the stack', async () => {
        const cfnCommands = []
        const s3Commands = []
        provision.setClients({
            cfn: mockClient((command) => {
                const name = command.constructor.name
                cfnCommands.push({ name, input: command.input })
                if (name === 'DescribeStacksCommand') {
                    return {
                        Stacks: [
                            {
                                StackName: 'mmgis-dashboard-7',
                                StackStatus: 'CREATE_COMPLETE',
                                Outputs: [
                                    {
                                        OutputKey: 'BucketName',
                                        OutputValue: 'resolved-bucket',
                                    },
                                ],
                            },
                        ],
                    }
                }
                if (name === 'DeleteStackCommand') return {}
                throw new Error(`Unexpected CFN command ${name}`)
            }),
            s3: mockClient((command) => {
                const name = command.constructor.name
                s3Commands.push({ name, input: command.input })
                if (name === 'ListObjectsV2Command')
                    return { Contents: [], IsTruncated: false }
                throw new Error(`Unexpected S3 command ${name}`)
            }),
        })

        // status `provisioning`/`deleting` row whose publish task hasn't yet
        // written settings.bucket — the orphaned-bucket race window.
        await teardownDeployment({
            id: 7,
            stack_name: 'mmgis-dashboard-7',
            settings: null,
        })

        // The bucket name came from the stack's BucketName output...
        const listCall = s3Commands.find(
            (c) => c.name === 'ListObjectsV2Command'
        )
        expect(listCall).toBeTruthy()
        expect(listCall.input.Bucket).toBe('resolved-bucket')
        // ...and the stack was deleted by name.
        const deleteCall = cfnCommands.find(
            (c) => c.name === 'DeleteStackCommand'
        )
        expect(deleteCall).toBeTruthy()
        expect(deleteCall.input.StackName).toBe('mmgis-dashboard-7')
    })

    test('uses settings.bucket directly and skips DescribeStacks when it is set', async () => {
        const cfnCommands = []
        const s3Commands = []
        provision.setClients({
            cfn: mockClient((command) => {
                const name = command.constructor.name
                cfnCommands.push(name)
                if (name === 'DeleteStackCommand') return {}
                throw new Error(`Unexpected CFN command ${name}`)
            }),
            s3: mockClient((command) => {
                const name = command.constructor.name
                s3Commands.push({ name, input: command.input })
                if (name === 'ListObjectsV2Command')
                    return { Contents: [], IsTruncated: false }
                throw new Error(`Unexpected S3 command ${name}`)
            }),
        })

        await teardownDeployment({
            id: 8,
            stack_name: 'mmgis-dashboard-8',
            settings: { bucket: 'known-bucket' },
        })

        expect(cfnCommands).not.toContain('DescribeStacksCommand')
        const listCall = s3Commands.find(
            (c) => c.name === 'ListObjectsV2Command'
        )
        expect(listCall.input.Bucket).toBe('known-bucket')
    })
})
