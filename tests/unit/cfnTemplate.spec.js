import { test, expect, beforeEach, afterEach, vi } from 'vitest'

// Tests for the per-dashboard CloudFormation template renderer
// (scripts/lib/cfn-template.js) used by the lean publish flow.

const {
    DEFAULT_STACK_NAME_PREFIX,
    BASIC_AUTH_USER,
    dashboardsAuthRequiredFromEnv,
    stackNamePrefix,
    stackNameForDeployment,
    renderAuthFunctionCode,
    renderCfnTemplate,
} = require('../../scripts/lib/cfn-template')

const PASSWORD = 'a-Distinctive-Passw0rd!'

test.describe('dashboardsAuthRequiredFromEnv', () => {
    test('only the exact string "false" ungates', () => {
        expect(dashboardsAuthRequiredFromEnv('false')).toBe(false)
        // Boolean false and null are in the list on purpose: the argument is
        // a raw environment value, so anything that is not the string
        // "false" — including the boolean — still gates.
        for (const value of [
            undefined,
            null,
            false,
            '',
            'False',
            '0',
            ' false',
            'true',
        ])
            expect(dashboardsAuthRequiredFromEnv(value)).toBe(true)
    })
})

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
        // Gating is the default, so an explicit true behaves like omitting it.
        expect(() => renderCfnTemplate({ requireAuth: true })).toThrow(
            /password/
        )
        // The Function renderer refuses on its own too, for a caller that
        // reaches it directly.
        expect(() => renderAuthFunctionCode()).toThrow(/password/)
        expect(() => renderAuthFunctionCode('')).toThrow(/password/)
    })

    test('only requireAuth === false ungates; falsy look-alikes still gate', () => {
        // A flag that arrives as null/0/"" is a caller bug, and the render
        // must fail toward the gate rather than quietly shipping a dashboard
        // with no password at all.
        for (const requireAuth of [undefined, null, 0, '', NaN])
            expect(() => renderCfnTemplate({ requireAuth })).toThrow(/password/)

        // And with the password supplied, such a flag renders the GATED
        // function — the throw above is the missing password talking, not a
        // falsy flag quietly ungating.
        const template = JSON.parse(
            renderCfnTemplate({ password: PASSWORD, requireAuth: 0 })
        )
        expect(
            template.Resources.DashboardAuthFunction.Properties.FunctionCode
        ).toContain(
            Buffer.from(`${BASIC_AUTH_USER}:${PASSWORD}`).toString('base64')
        )
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

    test('bakes the password into the Function code as a base64 constant', () => {
        const body = renderCfnTemplate({ password: PASSWORD })
        const template = JSON.parse(body)
        const code =
            template.Resources.DashboardAuthFunction.Properties.FunctionCode
        const expected = Buffer.from(
            `${BASIC_AUTH_USER}:${PASSWORD}`
        ).toString('base64')
        expect(code).toContain(`Basic ${expected}`)
        // The plaintext password never appears anywhere in the template
        expect(body).not.toContain(PASSWORD)
    })

    // A CloudFront Function serves its LIVE stage. Without AutoPublish the
    // rendered code would sit in DEVELOPMENT and never reach a request.
    test('sets AutoPublish on the Function', () => {
        const template = JSON.parse(renderCfnTemplate({ password: PASSWORD }))
        expect(
            template.Resources.DashboardAuthFunction.Properties.AutoPublish
        ).toBe(true)
    })

    test('auth function returns 401 with a www-authenticate challenge', () => {
        const code = renderAuthFunctionCode(PASSWORD)
        expect(code).toContain('statusCode: 401')
        expect(code).toContain('www-authenticate')
        expect(code).toContain('return request')
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

// The shape an environment with dashboards_require_auth = false publishes.
test.describe('renderCfnTemplate with requireAuth: false', () => {
    // The invariant the whole flag rests on: the ungated function is the
    // gated one with the marked span removed and nothing else touched. The
    // cut here is line-based rather than the module's own regex, so a broken
    // regex cannot agree with itself.
    test('the ungated function is the gated one minus the marked span', () => {
        const lines = renderAuthFunctionCode(PASSWORD).split('\n')
        const start = lines.findIndex((l) => l.includes('MMGIS:AUTH-GATE-START'))
        const end = lines.findIndex((l) => l.includes('MMGIS:AUTH-GATE-END'))
        expect(start).toBeGreaterThanOrEqual(0)
        expect(end).toBeGreaterThan(start)

        const cut = lines
            .slice(0, start)
            .concat(lines.slice(end + 1))
            .join('\n')
        expect(renderAuthFunctionCode(null, false)).toBe(cut)
    })

    // The association is the thing an ungated dashboard could plausibly lose
    // by accident, and losing it would break every prefix-served dashboard.
    test('the Function is still associated on viewer-request', () => {
        const template = JSON.parse(renderCfnTemplate({ requireAuth: false }))
        const associations =
            template.Resources.DashboardDistribution.Properties
                .DistributionConfig.DefaultCacheBehavior.FunctionAssociations
        expect(associations).toHaveLength(1)
        expect(associations[0].EventType).toBe('viewer-request')
        expect(associations[0].FunctionARN['Fn::GetAtt']).toEqual([
            'DashboardAuthFunction',
            'FunctionARN',
        ])
    })

    // A password handed in alongside requireAuth: false must not leak into
    // the template — the flag, not the caller's argument list, decides.
    test('a password passed anyway is never baked in', () => {
        const body = renderCfnTemplate({
            password: PASSWORD,
            requireAuth: false,
        })
        expect(body).not.toContain(PASSWORD)
        expect(body).not.toContain(
            Buffer.from(`${BASIC_AUTH_USER}:${PASSWORD}`).toString('base64')
        )
    })
})

// A source file whose markers stop bracketing the gate would otherwise ship
// a Function still carrying the un-substituted credentials line. Both guards
// need a doctored source, so the read is stubbed.
test.describe('renderAuthFunctionCode refuses a broken gate span', () => {
    const fs = require('fs')
    const path = require('path')
    const REAL_SOURCE = fs.readFileSync(
        path.join(
            __dirname,
            '..',
            '..',
            'infrastructure',
            'cloudfront-function.js'
        ),
        'utf8'
    )

    afterEach(() => {
        vi.restoreAllMocks()
    })

    const withSource = (source) =>
        vi.spyOn(fs, 'readFileSync').mockReturnValue(source)

    test('throws when the markers are gone', () => {
        withSource(
            REAL_SOURCE.replace('// MMGIS:AUTH-GATE-START', '// gate starts')
        )
        expect(() => renderAuthFunctionCode(null, false)).toThrow(/markers/)
    })

    test('throws when the placeholder survives the cut', () => {
        // An END marker moved up to just after START: the span matches, the
        // cut removes only the marker lines, and the credentials line stays.
        withSource(
            REAL_SOURCE.replace(
                '    // MMGIS:AUTH-GATE-START\n',
                '    // MMGIS:AUTH-GATE-START\n    // MMGIS:AUTH-GATE-END\n'
            )
        )
        expect(() => renderAuthFunctionCode(null, false)).toThrow(/survives/)
    })
})
