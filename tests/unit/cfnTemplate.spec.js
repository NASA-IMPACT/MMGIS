import { test, expect, beforeEach, afterEach, vi } from 'vitest'

// Tests for the per-dashboard CloudFormation template renderer
// (scripts/lib/cfn-template.js) used by the lean publish flow.

const {
    DEFAULT_STACK_NAME_PREFIX,
    BASIC_AUTH_USER,
    stackNamePrefix,
    stackNameForDeployment,
    renderCfnTemplate,
} = require('../../scripts/lib/cfn-template')

const PASSWORD = 'a-Distinctive-Passw0rd!'

test.describe('stackNameForDeployment', () => {
    // The default shape only holds when MMGIS_ENVIRONMENT is unset; stub it
    // away so a machine or CI job that exports it can't fail these spuriously.
    beforeEach(() => {
        vi.stubEnv('MMGIS_ENVIRONMENT', '')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    test('encodes the deployment id with the mmgis-dashboard- prefix', () => {
        expect(stackNameForDeployment(12)).toBe('mmgis-dashboard-12')
        expect(stackNameForDeployment('40')).toBe('mmgis-dashboard-40')
        expect(DEFAULT_STACK_NAME_PREFIX).toBe('mmgis-dashboard-')
        expect(stackNamePrefix()).toBe('mmgis-dashboard-')
    })

    test('throws without an id', () => {
        expect(() => stackNameForDeployment(null)).toThrow()
        expect(() => stackNameForDeployment('')).toThrow()
    })
})

test.describe('MMGIS_ENVIRONMENT namespacing', () => {
    afterEach(() => {
        vi.unstubAllEnvs()
    })

    test('namespaces the prefix per environment when the var is set', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', 'development')
        expect(stackNamePrefix()).toBe('mmgis-development-dashboard-')
        expect(stackNameForDeployment(12)).toBe('mmgis-development-dashboard-12')
    })

    test('an empty value falls back to the legacy shared prefix', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', '')
        expect(stackNamePrefix()).toBe(DEFAULT_STACK_NAME_PREFIX)
        expect(stackNameForDeployment(12)).toBe('mmgis-dashboard-12')
    })

    test('still throws without an id', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', 'development')
        expect(() => stackNameForDeployment(null)).toThrow()
        expect(() => stackNameForDeployment('')).toThrow()
    })

    test('rejects a value the Terraform module would reject', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', 'Dev_1')
        expect(() => stackNamePrefix()).toThrow(/MMGIS_ENVIRONMENT/)
        expect(() => stackNameForDeployment(1)).toThrow(/MMGIS_ENVIRONMENT/)
    })

    test('rejects a value that does not start with a letter', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', '-development')
        expect(() => stackNameForDeployment(1)).toThrow(/MMGIS_ENVIRONMENT/)
    })

    test('rejects a value longer than the S3 bucket-name budget', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', 'developments')
        expect(() => stackNamePrefix()).toThrow(/MMGIS_ENVIRONMENT/)
        expect(() => stackNameForDeployment(1)).toThrow(/MMGIS_ENVIRONMENT/)
    })

    test('accepts a value at the 11-character cap', () => {
        vi.stubEnv('MMGIS_ENVIRONMENT', 'development')
        expect('development'.length).toBe(11)
        expect(stackNamePrefix()).toBe('mmgis-development-dashboard-')
    })
})

test.describe('renderCfnTemplate', () => {
    test('throws without a password', () => {
        expect(() => renderCfnTemplate({})).toThrow(/password/)
        expect(() => renderCfnTemplate({ password: '' })).toThrow(/password/)
    })

    test('renders valid JSON with the expected resources', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        const resources = template.Resources
        expect(resources.DashboardBucket.Type).toBe('AWS::S3::Bucket')
        expect(resources.DashboardBucketPolicy.Type).toBe(
            'AWS::S3::BucketPolicy'
        )
        expect(resources.DashboardOriginAccessControl.Type).toBe(
            'AWS::CloudFront::OriginAccessControl'
        )
        expect(resources.DashboardAuthFunction.Type).toBe(
            'AWS::CloudFront::Function'
        )
        expect(resources.DashboardDistribution.Type).toBe(
            'AWS::CloudFront::Distribution'
        )
    })

    test('has no Parameters block — the password is never a CFN parameter', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        expect(template.Parameters).toBeUndefined()
    })

    test('bakes the password into the Function code and ships only the body', () => {
        const body = renderCfnTemplate({ password: PASSWORD })
        const template = JSON.parse(body)
        const code =
            template.Resources.DashboardAuthFunction.Properties.FunctionCode
        const expected = Buffer.from(
            `${BASIC_AUTH_USER}:${PASSWORD}`
        ).toString('base64')
        expect(code).toContain(`Basic ${expected}`)
        expect(code).not.toContain('<BASE64_BASIC_CREDENTIALS>')
        // The source file's doc comment is stripped, so the uploaded code
        // starts at the handler itself.
        expect(code.startsWith('function handler')).toBe(true)
        // The plaintext password never appears anywhere in the template
        expect(body).not.toContain(PASSWORD)
    })

    test('distribution is gated by the viewer-request function and serves index.html', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        const dist =
            template.Resources.DashboardDistribution.Properties
                .DistributionConfig
        expect(dist.DefaultRootObject).toBe('index.html')
        const associations = dist.DefaultCacheBehavior.FunctionAssociations
        expect(associations).toHaveLength(1)
        expect(associations[0].EventType).toBe('viewer-request')
        expect(associations[0].FunctionARN['Fn::GetAtt']).toEqual([
            'DashboardAuthFunction',
            'FunctionARN',
        ])
    })

    test('bucket blocks all public access; CloudFront reads via OAC', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        const block =
            template.Resources.DashboardBucket.Properties
                .PublicAccessBlockConfiguration
        expect(block.BlockPublicAcls).toBe(true)
        expect(block.RestrictPublicBuckets).toBe(true)
        const statement =
            template.Resources.DashboardBucketPolicy.Properties.PolicyDocument
                .Statement[0]
        expect(statement.Principal.Service).toBe('cloudfront.amazonaws.com')
        expect(statement.Action).toBe('s3:GetObject')
    })

    test('declares the outputs the publish task and routes consume', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        expect(Object.keys(template.Outputs).sort()).toEqual([
            'BucketName',
            'DistributionDomainName',
            'DistributionId',
        ])
    })

    test('the bucket is left unnamed (naming it would REPLACE it, minting a new domain)', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        // A named bucket makes UpdateStack REPLACE it, and a replaced bucket
        // drops the distribution's origin — the one thing a published dashboard
        // must never change. (Resource renames are already caught by the
        // "expected resources" test, which addresses each by its logical ID.)
        expect(
            template.Resources.DashboardBucket.Properties
        ).not.toHaveProperty('BucketName')
    })
})
