import { test, expect } from 'vitest'

// Tests for the lean deployment's AWS recipes in infrastructure/.
// These are static checks: every JSON file must parse, the Terraform module
// must stay in lockstep with the app dashboard prefix, and the password-gate
// Function reference must stay in sync with the generator in
// scripts/lib/cfn-template.js.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const INFRA = path.join(ROOT, 'infrastructure')

const JSON_FILES = ['cloudfront-admin.json', 's3-asset-bucket.json']

function readJson(relative) {
    return JSON.parse(fs.readFileSync(path.join(INFRA, relative), 'utf8'))
}

const TF_MODULE = path.join(INFRA, 'terraform', 'modules', 'mmgis-environment')
const readTfModuleFile = (relative) =>
    fs.readFileSync(path.join(TF_MODULE, relative), 'utf8')

test.describe('infrastructure/ JSON recipes', () => {
    test('every infrastructure JSON file parses', () => {
        for (const file of JSON_FILES) {
            expect(() => readJson(file), `${file} parses`).not.toThrow()
        }
    })

    test('terraform module stays in lockstep with the app dashboard prefix', () => {
        // Pins the module to the exact strings the app composes from
        // MMGIS_ENVIRONMENT (scripts/lib/cfn-template.js), so silent drift on
        // either side fails CI instead of at publish time as an AccessDenied.
        const MODULE = path.join(
            INFRA,
            'terraform',
            'modules',
            'mmgis-environment'
        )
        const read = (f) => fs.readFileSync(path.join(MODULE, f), 'utf8')

        // main.tf composes mmgis-<env>-dashboard- exactly like stackNamePrefix()
        const mainTf = read('main.tf')
        expect(mainTf).toContain('name_prefix = "mmgis-${var.environment}"')
        expect(mainTf).toContain(
            'dashboard_prefix = "${local.name_prefix}-dashboard-"'
        )

        // Both task environments inject the variable the app reads
        const ecsTf = read('ecs.tf')
        const injections = ecsTf.match(
            /\{ name = "MMGIS_ENVIRONMENT", value = var\.environment \}/g
        )
        expect(injections).toHaveLength(2)

        // The module validation matches the app-side guard (regex + length cap)
        const variablesTf = read('variables.tf')
        expect(variablesTf).toContain('regex("^[a-z][a-z0-9-]*$", var.environment)')
        expect(variablesTf).toContain('length(var.environment) <= 11')

        // Every dashboard-facing IAM pattern uses the shared local, never a literal
        const iamTf = read('iam.tf')
        expect(iamTf).not.toContain('mmgis-dashboard-')
        expect(
            iamTf.match(/\$\{local\.dashboard_prefix\}\*/g).length
        ).toBeGreaterThanOrEqual(9)
    })

    test('cloudfront-function.js reference matches renderAuthFunctionCode()', () => {
        const {
            renderAuthFunctionCode,
            BASIC_AUTH_USER,
        } = require('../../scripts/lib/cfn-template')

        const reference = fs.readFileSync(
            path.join(INFRA, 'cloudfront-function.js'),
            'utf8'
        )
        // Strip the leading doc comment; bake a known password into the
        // <BASE64_BASIC_CREDENTIALS> placeholder.
        const body = reference.replace(/^\/\*[\s\S]*?\*\/\s*/, '').trimEnd()
        const password = 'reference-sync-check'
        const baked = body.replace(
            '<BASE64_BASIC_CREDENTIALS>',
            Buffer.from(`${BASIC_AUTH_USER}:${password}`).toString('base64')
        )
        expect(baked).toBe(renderAuthFunctionCode(password))
    })

    test('admin CloudFront uses AllViewerExceptHostHeader + CachingDisabled and serves /assets/*', () => {
        const distribution = readJson('cloudfront-admin.json')
        const defaultBehavior = distribution.DefaultCacheBehavior
        // AWS managed policy ids (documented in infrastructure/README.md):
        // CachingDisabled + AllViewer on the ALB default behavior.
        expect(defaultBehavior.CachePolicyId).toBe(
            '4135ea2d-6df8-44a3-9df3-4b5a84be39ad'
        )
        expect(defaultBehavior.OriginRequestPolicyId).toBe(
            'b689b0a8-53d0-40ab-baf2-68738e2966ac'
        )

        const assetBehavior = distribution.CacheBehaviors.Items.find(
            (b) => b.PathPattern === '/assets/*'
        )
        expect(assetBehavior).toBeTruthy()
        const assetOrigin = distribution.Origins.Items.find(
            (o) => o.Id === assetBehavior.TargetOriginId
        )
        expect(assetOrigin.DomainName).toContain('<ASSET_BUCKET_NAME>')
    })

    test('module refuses empty live facts unless greenfield is set, and pins CloudFront', () => {
        // The three live facts (serving image + the two express inputs) default
        // to the DESTRUCTIVE actions (placeholder image; CloudFront
        // destruction), so empty is only legal under the explicit greenfield
        // flag. Pin the validation conditions and the prevent_destroy backstop
        // so a module edit cannot silently drop either fence.
        const variablesTf = readTfModuleFile('variables.tf')
        for (const guarded of [
            'var.deployed_image != ""',
            'var.express_internal_alb_arn != ""',
            'var.express_onaws_endpoint != ""',
        ]) {
            expect(
                variablesTf,
                `validation gates ${guarded} behind var.greenfield`
            ).toContain(`var.greenfield || ${guarded}`)
        }

        const cloudfrontTf = readTfModuleFile('cloudfront.tf')
        expect(cloudfrontTf).toContain('prevent_destroy = true')
    })

    test('the DB instance names an explicit key for its managed master secret', () => {
        // The account's default aws/secretsmanager key cannot be granted on by
        // the CI apply role, so CreateDBInstance fails without this.
        expect(readTfModuleFile('rds.tf')).toContain(
            'master_user_secret_kms_key_id'
        )
    })

    test('the boundary caps every action the Express infrastructure role needs', () => {
        // mmgis-<env>-express-infrastructure carries exactly one policy, the
        // AWS managed AmazonECSInfrastructureRoleforExpressGatewayServices, and
        // a boundary is an intersection: an action the cap omits fails service
        // creation with an error naming the boundary, not the action. These are
        // that policy's actions (v6) — all 51 of them, so a coverage gap in any
        // service shows up here. Each is capped either literally or by its
        // service wildcard.
        const REQUIRED = [
            // iam (1)
            'iam:CreateServiceLinkedRole',
            // elasticloadbalancing (20)
            'elasticloadbalancing:AddListenerCertificates',
            'elasticloadbalancing:AddTags',
            'elasticloadbalancing:CreateListener',
            'elasticloadbalancing:CreateLoadBalancer',
            'elasticloadbalancing:CreateRule',
            'elasticloadbalancing:CreateTargetGroup',
            'elasticloadbalancing:DeleteListener',
            'elasticloadbalancing:DeleteLoadBalancer',
            'elasticloadbalancing:DeleteRule',
            'elasticloadbalancing:DeleteTargetGroup',
            'elasticloadbalancing:DeregisterTargets',
            'elasticloadbalancing:DescribeListeners',
            'elasticloadbalancing:DescribeLoadBalancers',
            'elasticloadbalancing:DescribeRules',
            'elasticloadbalancing:DescribeTargetGroups',
            'elasticloadbalancing:DescribeTargetHealth',
            'elasticloadbalancing:ModifyListener',
            'elasticloadbalancing:ModifyRule',
            'elasticloadbalancing:RegisterTargets',
            'elasticloadbalancing:RemoveListenerCertificates',
            // ec2 (11)
            'ec2:AuthorizeSecurityGroupEgress',
            'ec2:AuthorizeSecurityGroupIngress',
            'ec2:CreateSecurityGroup',
            'ec2:CreateTags',
            'ec2:DeleteSecurityGroup',
            'ec2:DescribeRouteTables',
            'ec2:DescribeSecurityGroups',
            'ec2:DescribeSubnets',
            'ec2:DescribeVpcs',
            'ec2:RevokeSecurityGroupEgress',
            'ec2:RevokeSecurityGroupIngress',
            // acm (4)
            'acm:AddTagsToCertificate',
            'acm:DeleteCertificate',
            'acm:DescribeCertificate',
            'acm:RequestCertificate',
            // application-autoscaling (8)
            'application-autoscaling:DeleteScalingPolicy',
            'application-autoscaling:DeregisterScalableTarget',
            'application-autoscaling:DescribeScalableTargets',
            'application-autoscaling:DescribeScalingActivities',
            'application-autoscaling:DescribeScalingPolicies',
            'application-autoscaling:PutScalingPolicy',
            'application-autoscaling:RegisterScalableTarget',
            'application-autoscaling:TagResource',
            // cloudwatch (4)
            'cloudwatch:DeleteAlarms',
            'cloudwatch:DescribeAlarms',
            'cloudwatch:PutMetricAlarm',
            'cloudwatch:TagResource',
            // logs (3)
            'logs:CreateLogGroup',
            'logs:DescribeLogGroups',
            'logs:TagResource',
        ]
        expect(REQUIRED.length, 'the whole policy is listed').toBe(51)

        const boundary = fs.readFileSync(
            path.join(INFRA, 'terraform', 'bootstrap', 'boundary.tf'),
            'utf8'
        )
        // Only the Allow statements count — the trailing Deny block names EC2
        // actions too, and a match there would be the opposite of coverage.
        const denyStart = boundary.indexOf('"DenyEc2BlastRadius"')
        expect(denyStart, 'the EC2 deny block is present').toBeGreaterThan(0)
        const allows = boundary.slice(0, denyStart)
        // …and it is the only Deny, so everything before it really is Allow.
        expect(allows).not.toContain('Effect = "Deny"')

        for (const action of REQUIRED) {
            const service = action.split(':')[0]
            expect(
                allows.includes(`"${action}"`) ||
                    allows.includes(`"${service}:*"`),
                `boundary caps ${action}`
            ).toBe(true)
        }
    })
})
