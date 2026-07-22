# MMGIS Lean AWS Infrastructure

Terraform for running MMGIS in the **lean** deployment shape
(`MMGIS_DEPLOYMENT_MODE=lean`) on AWS: the admin app as a long-running ECS
Express Mode service, a short-lived ECS task that publishes a mission as a
standalone static dashboard, the least-privilege IAM for both, the CloudFront
distribution in front of the admin, the password-gate CloudFront Function
reference, and the shared S3 asset bucket.

Standing up or changing an environment is `terraform plan` → review → `apply` —
never a runbook of CLI commands. One reusable module describes a complete
environment; thin per-environment roots instantiate it. The only things outside
Terraform are the one-time state-bucket bootstrap, the secret **values**, and
the runtime-created per-dashboard CloudFormation stacks (application behavior,
explicitly staying CloudFormation).

**Dual-deployment posture:** the **full** deployment is the upstream MMGIS
default (docker-compose, bundled sidecar services) and uses **none** of this
directory. The **lean** deployment is this directory plus
`.github/workflows/deploy-lean.yml`. The same image serves both;
`MMGIS_DEPLOYMENT_MODE` is a runtime ECS environment variable, never a Docker
build-arg (the `Dockerfile` is shared and unmodified).

## Layout

```
infrastructure/
├── terraform/
│   ├── modules/mmgis-environment/     # one complete environment, parameterized
│   └── environments/
│       ├── development/               # thin root: module call + backend + tfvars
│       └── production/                # thin root (instantiated by #195)
├── ecs/*.json                         # recipe source (provenance; see below)
├── iam/*.json                         # recipe source (provenance)
├── cloudfront-admin.json              # recipe source (provenance)
├── cloudfront-function.js             # canonical password-gate Function reference
└── s3-asset-bucket.json               # recipe source (provenance)
```

The module builds: ECS cluster; the admin Express Mode gateway service;
`mmgis-<env>-admin` / `mmgis-<env>-publish` task definitions; RDS PostgreSQL +
subnet group; two task security groups; two log groups; five Secrets Manager
secret shells; a per-environment ECR repository; the shared asset bucket + OAC
(+ policy); the CloudFront distribution + VPC origin; the task/exec/infra IAM
roles; and the per-environment GitHub OIDC deploy role.

### The recipe JSON files are provenance, not applied

`ecs/*.json`, `iam/*.json`, `cloudfront-admin.json`, and `s3-asset-bucket.json`
are the June recipes the Terraform module was translated from — every attribute
value in them is production-tested. They are **kept in place**: they document
where each Terraform value came from and are referenced by #195 discussions.
`cloudfront-function.js` is still load-bearing as the canonical reference the
publish generator (`scripts/lib/cfn-template.js`) is kept in sync with (see
`tests/unit/infrastructure.spec.js`). Nothing here is applied directly anymore.

## Prerequisites (operator-provided, not created by Terraform)

- **VPC + private subnets.** The account is limited to existing shared VPCs and
  **cannot create any**, so `vpc_id` and `private_subnet_ids` are required
  inputs (uncommitted, via tfvars). Use **at least two** private subnets in
  different AZs (ECS Express Mode requires two) with **NAT egress** — a private
  task needs it or webhooks and AWS-API calls hang silently. Private subnets
  make the admin reachable only through CloudFront.
- **A per-environment Terraform state bucket**, bootstrapped once (below).
  Development's is created here; production's is created by #195.
- **The account's GitHub OIDC identity provider**
  (`token.actions.githubusercontent.com`) must already exist — the module
  references it by data source and never creates it. The very first `plan`
  fails without it.
- **Secret values**, set out-of-band (below). Terraform defines the secrets'
  existence and names only.
- **The RDS regional CA bundle**, supplied as `rds_ca_bundle_base64` (below).
- **No custom domain.** Bare-CloudFront posture: viewers use the default
  `*.cloudfront.net` certificate; the distribution carries no aliases.
- **linux/amd64 images only.** The task defs pin `X86_64`; a local build on
  Apple Silicon must use `docker buildx build --platform linux/amd64`. The
  GitHub-hosted CI runners are amd64, so `deploy-lean.yml`'s plain build is fine.

## One-time state-bucket bootstrap (per environment)

Create the bucket that holds this environment's state (S3 native locking, so no
DynamoDB table). Do this once per environment, before the first `init`:

```sh
aws s3api create-bucket \
  --bucket mmgis-development-tfstate-<ACCOUNT_ID> \
  --region <REGION> \
  --create-bucket-configuration LocationConstraint=<REGION>
aws s3api put-bucket-versioning \
  --bucket mmgis-development-tfstate-<ACCOUNT_ID> \
  --versioning-configuration Status=Enabled
aws s3api put-public-access-block \
  --bucket mmgis-development-tfstate-<ACCOUNT_ID> \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

Then record the bucket in `backend.hcl` (copy `backend.hcl.example`). Nothing
is shared between environments — applying one can never touch another's state.

## Apply flow

The Express Mode service does not expose its internal ALB ARN or on.aws
endpoint as Terraform attributes (only `service_arn` and `ingress_paths` are
exported), and the CloudFront VPC origin needs the ALB ARN. So the front door
is built in a **second apply**.

From `terraform/environments/development/` (production is analogous, per #195):

```sh
cp terraform.tfvars.example terraform.tfvars   # fill in vpc_id, subnets, CA bundle
cp backend.hcl.example backend.hcl             # fill in the state bucket

terraform init -backend-config=backend.hcl
```

### Phase 1 — everything except CloudFront

With `express_internal_alb_arn` / `express_onaws_endpoint` left empty:

```sh
terraform apply
```

This creates the cluster, Express service (which provisions its own internal
ALB), task defs, RDS, secrets shells, ECR, asset bucket + OAC, IAM roles, and
the deploy role.

### Set the secret values out-of-band

Terraform created empty secret shells; give them values (nothing here touches
Terraform state). RDS generated the master password in its **own** managed
secret — copy it (and the endpoint) into the app-shaped DB secret:

```sh
# Where RDS put the generated master password, and the DB endpoint:
terraform output rds_managed_master_secret_arn
terraform output rds_endpoint

aws secretsmanager put-secret-value --secret-id mmgis/development/db \
  --secret-string '{"DB_HOST":"<RDS_ENDPOINT_HOST>","DB_PORT":"5432","DB_NAME":"<APP_DB>","DB_USER":"postgres","DB_PASS":"<COPIED_FROM_MANAGED_SECRET>"}'

aws secretsmanager put-secret-value --secret-id mmgis/development/session-secret       --secret-string '<random-session-secret>'
aws secretsmanager put-secret-value --secret-id mmgis/development/superadmin-username   --secret-string '<superadmin-username>'
aws secretsmanager put-secret-value --secret-id mmgis/development/superadmin-password   --secret-string '<superadmin-password>'
aws secretsmanager put-secret-value --secret-id mmgis/development/dashboards-password   --secret-string '<dashboards-password>'
```

The DB master **username must be `postgres`** (`scripts/init-db.js`'s bootstrap
connection defaults the maintenance DB name to the username, and a fresh RDS
instance only has the `postgres` database). That is enforced in the module.

Secrets Manager keeps **deleted secret names for 30 days** by default, so a
destroy/re-apply cycle collides on all five names. The development root sets
`secret_recovery_window_days = 0` (immediate deletion) for exactly this
reason; production keeps the 30-day window on purpose.

### First image deploy — before CloudFront

A from-scratch phase 1 leaves the service pointing at a **placeholder image
that does not exist in ECR** (CI pushes commit-SHA tags only), so the tasks
crash-loop until a real image arrives. Push one through the pipeline now:

1. Set the repository's GitHub Actions variables from
   `terraform output workflow_variables` (region, ECR repo, cluster, service,
   both task families) and the `AWS_DEPLOY_ROLE_ARN` secret from
   `terraform output deploy_role_arn`.
2. Run `deploy-lean.yml` (manual dispatch) and wait for the rollout to
   converge — the run summary shows the deployed image.

Only then move on: phase 2's inputs are read from the now-healthy service, and
Publish depends on the task families pointing at a real image.

### Phase 2 — CloudFront front door

Read **three values** from the running service with one call —
`aws ecs describe-express-gateway-service --service-arn "$(terraform output -raw express_service_arn)"`:
the internal ALB ARN, the on.aws endpoint host (also visible via
`terraform output express_ingress_paths`), and the ECS-managed ALB's
**security-group id**. Set them in `terraform.tfvars` and re-apply:

```hcl
express_internal_alb_arn      = "arn:aws:elasticloadbalancing:<REGION>:<ACCOUNT>:loadbalancer/app/ecs-express-gateway-alb-xxxx/xxxx"
express_onaws_endpoint        = "mm-xxxx.ecs.<REGION>.on.aws"
express_alb_security_group_id = "sg-xxxxxxxxxxxxxxxxx"
```

```sh
terraform apply   # VPC origin, distribution, asset-bucket policy, and the
                  # :443-from-VPC-CIDR ingress rule on the ECS-managed ALB SG
```

The ALB security group itself is created and owned by ECS Express Mode — the
module only adds the one ingress rule to it, so no hand-executed mutation
remains anywhere in the flow.

VPC origins **cannot be updated while status=Deploying** and deploy cycles run
~6–10 minutes — be patient between changes.

## Workflow variables

`terraform output workflow_variables` prints the exact values. Set them as the
environment's GitHub Actions variables (and the one secret):

| Variable | Source output | Notes |
|---|---|---|
| `AWS_REGION` | `aws_region` | |
| `ECR_REPOSITORY` | `ecr_repository_name` | per-environment repo |
| `ECS_CLUSTER` | `ecs_cluster_name` | |
| `ECS_SERVICE` | `ecs_service_name` | |
| `ADMIN_TASK_FAMILY` | `admin_task_family` | `mmgis-<env>-admin` — **new**; the workflow now reads this (falls back to `mmgis-admin`) |
| `PUBLISH_TASK_FAMILY` | `publish_task_family` | `mmgis-<env>-publish` — **new** (falls back to `mmgis-publish`) |
| `AWS_DEPLOY_ROLE_ARN` (secret) | `deploy_role_arn` | OIDC-assumable; no long-lived keys |

The two `*_TASK_FAMILY` variables are the one required change to
`deploy-lean.yml`: families are region-global, so per-environment names stop a
production deploy from registering a revision development's publish-by-family
flow would silently pick up. Everything else the workflow needs already came
from Actions variables. The deploy role's trust is **branch-scoped for now**
(`repo:NASA-IMPACT/MMGIS:ref:refs/heads/<branch>`); #195 tightens both
environments to GitHub-Environment-scoped trust when it wires `environment:`
into the job.

## Operational notes (still true, now in the Terraform world)

- **After ANY Terraform change that touches a task definition, run
  `deploy-lean.yml`.** Terraform's task defs point at a placeholder `:latest`
  tag that never exists in ECR; a re-registered revision therefore points at a
  nonexistent image, and Publish (`RunTask` on the family's latest revision)
  silently breaks until the deploy workflow re-registers both families with a
  real commit-SHA image.
- **Express Mode is not task-definition driven.** The service runs from its own
  inline `primary_container`; the deploy workflow rolls it with
  `aws ecs update-express-gateway-service --primary-container`, not
  `update-service --task-definition`. Terraform sets the primary container but
  ignores drift on its image (the workflow owns the image). The
  `mmgis-<env>-admin` task def is still registered as the human-auditable
  source-of-truth the primary container mirrors; `mmgis-<env>-publish` is
  genuinely load-bearing (the Deployments backend `RunTask`s it by family name).
- **RDS forces SSL.** Both task defs set `DB_SSL=true` and `DB_SSL_CERT_BASE64`
  (base64 of the small **per-region** CA bundle from
  `truststore.pki.rds.amazonaws.com/<region>/<region>-bundle.pem` — the global
  bundle exceeds the ECS env-var size limit). Supply it as `rds_ca_bundle_base64`.
- **Two secrets for the database, on purpose.** `manage_master_user_password`
  makes RDS generate and rotate the master password in its own managed secret
  (nothing in Terraform state). Its `{username,password}` shape does **not**
  match what the app reads, so the separate app-shaped `mmgis/<env>/db` secret
  (`DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASS`) exists too, set out-of-band.
- **Two roles per task.** The *execution* role is what ECS uses (image pull,
  logs, `secrets[]` injection); the *task* role is what the container code's SDK
  calls use. The admin task role holds `iam:PassRole` on both publish role ARNs
  — without it `RunTask` fails with an opaque AccessDenied that never mentions
  PassRole.
- **CloudFront origin details are load-bearing.** The admin origin `DomainName`
  must be the on.aws endpoint (it satisfies the ALB cert's SNI and its
  host-header rule; the raw ALB DNS name would miss it), with the
  **AllViewerExceptHostHeader** origin-request policy and **CachingDisabled**
  cache policy so login, Postgres-backed sessions, and WebSocket upgrades work.
  `/assets/*` serves the shared bucket with **CachingOptimized**. The recipe's
  `MinimumProtocolVersion` is intentionally omitted — the provider forbids
  setting it alongside the default certificate.
- **CI deploy role, hard-won facts** (encoded in the module):
  `ecs:DescribeServices` on the admin service ARN (the workflow resolves
  name→ARN); the ExpressGatewayService actions' `Resource` includes **both** the
  `express-gateway-service/*` shape **and** the `service/<cluster>/<service>`
  ARN (the API authorizes Update/Describe against the service ARN); and the CLI
  rejects `--cluster` on `update-express-gateway-service` (ARN-only) — the
  workflow already resolves the ARN first.

## Placeholders in the recipe JSON

The recipe files still use `<ACCOUNT_ID>`, `<REGION>`, `<ECR_REPOSITORY_NAME>`,
`<ECS_CLUSTER_NAME>`, `<SUBNET_IDS>`, `<SECURITY_GROUP_IDS>`,
`<ASSET_BUCKET_NAME>`, the `<*_SECRET_ARN>` set, `<EXPRESS_ONAWS_ENDPOINT>`,
`<VPC_ORIGIN_ID>`, `<ASSET_BUCKET_OAC_ID>`, and `<ADMIN_DISTRIBUTION_ID>`. In
the Terraform module these are resolved from `data.aws_caller_identity`, the
`region` variable, resource attributes, and the two-phase CloudFront inputs —
you do not fill them in by hand anymore.

## Deploy pipeline

`.github/workflows/deploy-lean.yml` runs on push to `development` (and via
`workflow_dispatch`): it builds theme assets (`npm run build:themes`), builds
and pushes the image to ECR, registers new `ADMIN_TASK_FAMILY` **and**
`PUBLISH_TASK_FAMILY` task-def revisions pointing at the new image, and rolls
the Express Mode service by updating its primary container. It defines no
ALB/target-group/scaling resources (Express Mode owns those). See the
[Workflow variables](#workflow-variables) table for its configuration.
