import { test, expect } from 'vitest'

// Tests for the lean deployment's AWS recipes in infrastructure/.
// These are static checks: every JSON file must parse, the IAM must stay
// least-privilege (no `Resource: "*"` except the unscopeable
// ecr:GetAuthorizationToken, dashboard grants pinned to the
// mmgis-dashboard-* prefix, PassRole for both publish roles), the task
// definitions must carry every env var the publish flow's code actually
// reads (publish-only vars like MMGIS_DASHBOARDS_PASSWORD on the publish
// task, the rest on the admin task), and the password-gate Function
// reference must stay in sync with the generator in
// scripts/lib/cfn-template.js.

const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..', '..')
const INFRA = path.join(ROOT, 'infrastructure')

const JSON_FILES = [
    'ecs/admin-task.json',
    'ecs/publish-task.json',
    'iam/admin-task-execution-role.json',
    'iam/admin-task-role.json',
    'iam/publish-task-execution-role.json',
    'iam/publish-task-role.json',
    'cloudfront-admin.json',
    's3-asset-bucket.json',
]

const IAM_FILES = JSON_FILES.filter((f) => f.startsWith('iam/'))

function readJson(relative) {
    return JSON.parse(fs.readFileSync(path.join(INFRA, relative), 'utf8'))
}

const TF_MODULE = path.join(INFRA, 'terraform', 'modules', 'mmgis-environment')
const readTfModuleFile = (relative) =>
    fs.readFileSync(path.join(TF_MODULE, relative), 'utf8')

// Every "Resource" value (string or array) in a parsed IAM document.
function collectResources(node, found = []) {
    if (Array.isArray(node)) {
        node.forEach((item) => collectResources(item, found))
    } else if (node != null && typeof node === 'object') {
        Object.keys(node).forEach((key) => {
            if (key === 'Resource') {
                const value = node[key]
                if (Array.isArray(value)) found.push(...value)
                else found.push(value)
            } else {
                collectResources(node[key], found)
            }
        })
    }
    return found
}

// All policy statements of a role file, flattened.
function statementsOf(roleJson) {
    return (roleJson.Properties.Policies || []).flatMap(
        (policy) => policy.PolicyDocument.Statement
    )
}

function statementBySid(roleJson, sid) {
    const statement = statementsOf(roleJson).find((s) => s.Sid === sid)
    expect(statement, `statement '${sid}' exists`).toBeTruthy()
    return statement
}

test.describe('infrastructure/ JSON recipes', () => {
    test('every infrastructure JSON file parses', () => {
        for (const file of JSON_FILES) {
            expect(() => readJson(file), `${file} parses`).not.toThrow()
        }
    })

    test('no IAM statement uses Resource: "*" (except ecr:GetAuthorizationToken)', () => {
        // Single documented exception: ecr:GetAuthorizationToken supports NO
        // resource-level permissions, so a statement whose ONLY action is
        // that one MUST use Resource: "*" (anything narrower is an implicit
        // deny that fails every Fargate image pull). This matches AWS's own
        // AmazonECSTaskExecutionRolePolicy.
        for (const file of IAM_FILES) {
            const statements = statementsOf(readJson(file))
            expect(statements.length).toBeGreaterThan(0)
            for (const statement of statements) {
                const actions = Array.isArray(statement.Action)
                    ? statement.Action
                    : [statement.Action]
                if (
                    actions.length === 1 &&
                    actions[0] === 'ecr:GetAuthorizationToken'
                ) {
                    expect(
                        collectResources(statement),
                        `${file} '${statement.Sid}' must NOT pin the token call`
                    ).toEqual(['*'])
                    continue
                }
                const resources = collectResources(statement)
                expect(resources.length).toBeGreaterThan(0)
                for (const resource of resources) {
                    expect(
                        resource,
                        `${file} '${statement.Sid}' pins every Resource`
                    ).not.toBe('*')
                }
            }
        }
    })

    test('dashboard-facing grants are pinned to the mmgis-dashboard-* prefix', () => {
        // The prefix the IAM is pinned to must be the one the code creates
        // stacks under. These JSON docs describe the hand-built environment,
        // which never sets MMGIS_ENVIRONMENT, so they pin the DEFAULT prefix;
        // the per-environment patterns live in the Terraform module
        // (infrastructure/terraform/modules/mmgis-environment/iam.tf).
        const {
            DEFAULT_STACK_NAME_PREFIX,
        } = require('../../scripts/lib/cfn-template')
        expect(DEFAULT_STACK_NAME_PREFIX).toBe('mmgis-dashboard-')

        const adminRole = readJson('iam/admin-task-role.json')
        const publishRole = readJson('iam/publish-task-role.json')

        const pinned = [
            [adminRole, 'DashboardStackReadDelete', ':stack/mmgis-dashboard-'],
            [adminRole, 'EmptyDashboardBuckets', 'arn:aws:s3:::mmgis-dashboard-'],
            [adminRole, 'ListDashboardBuckets', 'arn:aws:s3:::mmgis-dashboard-'],
            [adminRole, 'TeardownDashboardBuckets', 'arn:aws:s3:::mmgis-dashboard-'],
            [adminRole, 'TeardownDashboardAuthFunctions', ':function/mmgis-dashboard-'],
            [publishRole, 'DashboardStackLifecycle', ':stack/mmgis-dashboard-'],
            [publishRole, 'DashboardBucketLifecycle', 'arn:aws:s3:::mmgis-dashboard-'],
            [publishRole, 'DashboardBucketWriteObjects', 'arn:aws:s3:::mmgis-dashboard-'],
            [publishRole, 'DashboardAuthFunctionLifecycle', ':function/mmgis-dashboard-'],
        ]
        for (const [role, sid, prefix] of pinned) {
            const resources = collectResources(statementBySid(role, sid))
            expect(resources.length).toBeGreaterThan(0)
            for (const resource of resources) {
                expect(resource, `${sid} resource carries '${prefix}'`).toContain(
                    prefix
                )
            }
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

    test('admin task role can complete inline DeleteStack teardown', () => {
        // The DELETE handler calls DeleteStack with no CloudFormation
        // service role, so CloudFormation deletes the dashboard's S3 bucket
        // and CloudFront distribution with the ADMIN task role's
        // credentials. The role must hold those teardown actions, pinned to
        // the mmgis-dashboard-* prefix (buckets) or the account's
        // distribution ARN space (ids are random, so no name pin possible).
        const adminRole = readJson('iam/admin-task-role.json')

        const buckets = statementBySid(adminRole, 'TeardownDashboardBuckets')
        expect(buckets.Action).toContain('s3:DeleteBucket')
        for (const resource of collectResources(buckets)) {
            expect(resource).toContain('arn:aws:s3:::mmgis-dashboard-')
        }

        const distributions = statementBySid(
            adminRole,
            'TeardownDashboardDistributions'
        )
        expect(distributions.Action).toContain('cloudfront:DeleteDistribution')
        for (const resource of collectResources(distributions)) {
            expect(resource).toContain('<ACCOUNT_ID>:distribution/')
        }
    })

    test('admin task role passes BOTH publish roles to RunTask', () => {
        const adminRole = readJson('iam/admin-task-role.json')
        const passRole = statementBySid(adminRole, 'PassBothPublishRoles')
        expect(passRole.Action).toContain('iam:PassRole')

        const resources = collectResources(passRole)
        const publishExecutionArn = readJson('ecs/publish-task.json')
            .executionRoleArn
        const publishTaskArn = readJson('ecs/publish-task.json').taskRoleArn
        expect(resources).toContain(publishExecutionArn)
        expect(resources).toContain(publishTaskArn)
        expect(publishExecutionArn).not.toBe(publishTaskArn)

        const runTask = statementBySid(adminRole, 'RunPublishTask')
        expect(runTask.Action).toContain('ecs:RunTask')
        const publishFamily = readJson('ecs/publish-task.json').family
        for (const resource of collectResources(runTask)) {
            expect(resource).toContain(`:task-definition/${publishFamily}:`)
        }
    })

    test('task defs cover every env var the publish-flow code reads', () => {
        // Env names the code actually reads, greppable from
        // requireEnv("...") and process.env.MMGIS_* / process.env.AWS_REGION.
        const sourceFiles = fs
            .readdirSync(path.join(ROOT, 'scripts', 'lib'))
            .filter((f) => f.endsWith('.js'))
            .map((f) => path.join(ROOT, 'scripts', 'lib', f))
        sourceFiles.push(path.join(ROOT, 'scripts', 'publish-static.js'))

        // MMGIS_DEPLOYMENT_ID / MMGIS_DEPLOYMENT_ACTION are deliberately NOT in any task
        // definition: runPublishTask() supplies them per run via RunTask
        // container overrides (see infrastructure/README.md).
        const RUN_TASK_OVERRIDES = ['MMGIS_DEPLOYMENT_ID', 'MMGIS_DEPLOYMENT_ACTION']

        // MMGIS_ENVIRONMENT is OPTIONAL by design: the Terraform module injects
        // it to namespace dashboards per environment; the legacy hand-built
        // environment deliberately omits it to keep the original
        // mmgis-dashboard-* names.
        const OPTIONAL_VARS = ['MMGIS_ENVIRONMENT']

        // Vars only the publish-side code (scripts/publish-static.js and the
        // template renderer it calls) reads. They ride the PUBLISH task
        // definition; the admin task deliberately does not carry them.
        const PUBLISH_ONLY = ['MMGIS_DASHBOARDS_PASSWORD']

        const wanted = new Set()
        const pattern =
            /requireEnv\(\s*["']([A-Z0-9_]+)["']\s*\)|process\.env\.(MMGIS_[A-Z0-9_]+|AWS_REGION)/g
        for (const file of sourceFiles) {
            const source = fs.readFileSync(file, 'utf8')
            let match
            while ((match = pattern.exec(source)) !== null) {
                const name = match[1] || match[2]
                if (
                    (name.startsWith('MMGIS_') || name === 'AWS_REGION') &&
                    !RUN_TASK_OVERRIDES.includes(name) &&
                    !OPTIONAL_VARS.includes(name)
                )
                    wanted.add(name)
            }
        }
        // Sanity: the grep found the publish-flow configuration set.
        expect(wanted.size).toBeGreaterThanOrEqual(8)

        function providedBy(taskDefFile) {
            const container = readJson(taskDefFile).containerDefinitions[0]
            return new Set([
                ...(container.environment || []).map((e) => e.name),
                ...(container.secrets || []).map((s) => s.name),
            ])
        }
        const adminProvided = providedBy('ecs/admin-task.json')
        const publishProvided = providedBy('ecs/publish-task.json')
        for (const name of wanted) {
            if (PUBLISH_ONLY.includes(name)) {
                expect(
                    publishProvided.has(name),
                    `publish task def provides ${name}`
                ).toBe(true)
                expect(
                    adminProvided.has(name),
                    `admin task def omits publish-only ${name}`
                ).toBe(false)
            } else {
                expect(
                    adminProvided.has(name),
                    `admin task def provides ${name}`
                ).toBe(true)
            }
        }
    })

    test('publish task def runs publish-static.js with the same image and its own roles', () => {
        const adminTask = readJson('ecs/admin-task.json')
        const publishTask = readJson('ecs/publish-task.json')
        const adminContainer = adminTask.containerDefinitions[0]
        const publishContainer = publishTask.containerDefinitions[0]

        expect(publishContainer.command).toEqual([
            'node',
            'scripts/publish-static.js',
        ])
        // Same image placeholder, distinct role pairs
        expect(publishContainer.image).toBe(adminContainer.image)
        expect(publishTask.executionRoleArn).not.toBe(adminTask.executionRoleArn)
        expect(publishTask.taskRoleArn).not.toBe(adminTask.taskRoleArn)

        // The container name must match runPublishTask()'s override target
        // (MMGIS_PUBLISH_CONTAINER_NAME, default "mmgis").
        const configuredName = (adminContainer.environment || []).find(
            (e) => e.name === 'MMGIS_PUBLISH_CONTAINER_NAME'
        )
        expect(configuredName.value).toBe(publishContainer.name)

        // Lean-mode switch + first-signup gate ride the admin environment[]
        const adminEnv = Object.fromEntries(
            adminContainer.environment.map((e) => [e.name, e.value])
        )
        expect(adminEnv.MMGIS_DEPLOYMENT_MODE).toBe('lean')
        expect(adminEnv.DISABLE_FIRST_SIGNUP).toBe('true')
    })

    test('publish task role omits rds-db:connect (password auth only)', () => {
        for (const file of IAM_FILES) {
            const actions = statementsOf(readJson(file)).flatMap((s) =>
                Array.isArray(s.Action) ? s.Action : [s.Action]
            )
            expect(actions).not.toContain('rds-db:connect')
        }
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
