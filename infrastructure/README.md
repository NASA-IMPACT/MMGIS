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
│       └── production/                # thin root (applied by #195)
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
(+ policy); the CloudFront distribution + VPC origin; and the task/exec/infra
IAM roles.

### The recipe JSON files are provenance, not applied

`ecs/*.json`, `iam/*.json`, `cloudfront-admin.json`, and `s3-asset-bucket.json`
are the June recipes the Terraform module was translated from — every attribute
value in them is production-tested. They are **kept in place**: they document
where each Terraform value came from and are referenced by #195 discussions.
`cloudfront-function.js` is still load-bearing as the canonical reference the
publish generator (`scripts/lib/cfn-template.js`) is kept in sync with (see
`tests/unit/infrastructure.spec.js`). Nothing here is applied directly anymore.
One deliberate divergence: the recipes inject all five `DB_*` keys from an
app-shaped DB secret (`<DB_SECRET_ARN>`) that the module has since retired —
`DB_PASS` now comes straight from the RDS-managed master secret, and
host/port/user/name ride as plain environment values.

## Prerequisites (operator-provided, not created by Terraform)

- **VPC + private subnets.** The account is limited to existing shared VPCs and
  **cannot create any**, so `vpc_id` and `private_subnet_ids` are required
  inputs (uncommitted, via tfvars). Use **at least two** private subnets in
  different AZs (ECS Express Mode requires two) with **NAT egress** — a private
  task needs it or webhooks and AWS-API calls hang silently. Private subnets
  make the admin reachable only through CloudFront.
- **A per-environment Terraform state bucket**, bootstrapped once. The CLI
  recipe below is the interim path that #245's bootstrap root replaces;
  development's bucket was created with it, production's arrives with #195.
- **The IAM permissions-boundary policy**, created by the bootstrap root. Its
  ARN is a required input (`permissions_boundary`, via tfvars — it carries the
  account id): every role this module creates carries the boundary, because the
  CI apply role is only allowed to create boundaried roles. An unboundaried
  role fails on the very first apply. The **bootstrap root is #245's
  deliverable** (state buckets plus all GitHub-facing AWS identity, the CI
  deploy role included) and lives outside this directory until it lands —
  apply it first. On a cutover from an environment whose deploy role was
  module-created, repoint the `AWS_DEPLOY_ROLE_ARN` secret at the
  bootstrap-created role **before** applying this root: this apply deletes
  the old role.
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
cp terraform.tfvars.example terraform.tfvars   # vpc_id, subnets, boundary ARN, CA bundle
cp backend.hcl.example backend.hcl             # fill in the state bucket

terraform init -backend-config=backend.hcl
```

### Phase 1 — everything except CloudFront

With `express_internal_alb_arn` / `express_onaws_endpoint` left empty:

```sh
terraform apply
```

This creates the cluster, Express service (which provisions its own internal
ALB), task defs, RDS, secrets shells, ECR, asset bucket + OAC, and the IAM
roles.

### Set the secret values out-of-band

Terraform created empty secret shells; give them values (nothing here touches
Terraform state). **Nothing DB-related is hand-set.** The database password
exists in exactly one place — the RDS-managed master secret — and the
containers reference that secret's `password` key directly at task start; host,
port, user, and database name are not secrets and ride as plain environment
values on both task definitions.

```sh
aws secretsmanager put-secret-value --secret-id mmgis/development/session-secret       --secret-string '<random-session-secret>'
aws secretsmanager put-secret-value --secret-id mmgis/development/superadmin-username   --secret-string '<superadmin-username>'
aws secretsmanager put-secret-value --secret-id mmgis/development/superadmin-password   --secret-string '<superadmin-password>'
aws secretsmanager put-secret-value --secret-id mmgis/development/dashboards-password   --secret-string '<dashboards-password>'
aws secretsmanager put-secret-value --secret-id mmgis/development/mapbox-token          --secret-string '<mapbox-token>'
```

The Mapbox token is an **external credential**: hand-set once per environment
and deliberately excluded from CI secret generation (CI can generate the
session, seed, and dashboards values; it can never invent a Mapbox token). It
is injected as `MAPBOX_TOKEN` on the admin task only.

The DB master **username must be `postgres`** (`scripts/init-db.js`'s bootstrap
connection defaults the maintenance DB name to the username, and a fresh RDS
instance only has the `postgres` database). That is enforced in the module.

Secrets Manager keeps **deleted secret names for 30 days** by default, so a
destroy/re-apply cycle would collide on all five names. Both environments
therefore set `secret_recovery_window_days = 0` (immediate deletion) — a
deleted name frees at once and a rebuild never trips over a ghost. Production
included: the one nuance it accepts is that the superadmin seed password seeds
the account at first boot only, so regenerating that secret afterwards desyncs
it from the real login password (the full note lives in
`environments/production/main.tf`).

### First image deploy — before CloudFront

A from-scratch phase 1 runs with `deployed_image` unset, so the service points
at a **placeholder image that does not exist in ECR** (CI pushes commit-SHA
tags only) and the tasks crash-loop until a real image arrives. Push one
through the pipeline now:

1. Set the environment's GitHub Actions variables from
   `terraform output -json workflow_variables` — one call returns all six
   (region, ECR repo, cluster, service, both task families), keyed by the
   variable names. The `AWS_DEPLOY_ROLE_ARN` secret comes from the **bootstrap
   root's** outputs, not from here: the CI deploy role is created there, with
   GitHub-Environment-scoped trust.
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

`terraform output -json workflow_variables` prints the exact values in one
object whose keys **are** the variable names. Set them as the environment's
GitHub Actions variables (the one secret comes from elsewhere):

| Variable | Source | Notes |
|---|---|---|
| `AWS_REGION` | `workflow_variables.AWS_REGION` | |
| `ECR_REPOSITORY` | `workflow_variables.ECR_REPOSITORY` | per-environment repo |
| `ECS_CLUSTER` | `workflow_variables.ECS_CLUSTER` | |
| `ECS_SERVICE` | `workflow_variables.ECS_SERVICE` | |
| `ADMIN_TASK_FAMILY` | `workflow_variables.ADMIN_TASK_FAMILY` | `mmgis-<env>-admin` — **new**; the workflow now reads this (falls back to `mmgis-admin`) |
| `PUBLISH_TASK_FAMILY` | `workflow_variables.PUBLISH_TASK_FAMILY` | `mmgis-<env>-publish` — **new** (falls back to `mmgis-publish`) |
| `AWS_DEPLOY_ROLE_ARN` (secret) | the bootstrap root | OIDC-assumable; no long-lived keys |

The two `*_TASK_FAMILY` variables are the one required change to
`deploy-lean.yml`: families are region-global, so per-environment names stop a
production deploy from registering a revision development's publish-by-family
flow would silently pick up. Everything else the workflow needs already came
from Actions variables. The deploy role itself is **not** created here — the
bootstrap root creates it, with GitHub-Environment-scoped trust, so this module
holds nothing that grants CI access to the account.

## Operational notes (still true, now in the Terraform world)

- **Terraform never decides which image runs — CI does.** Every pipeline apply
  hands the module the currently deployed image (`deployed_image`), so a
  re-registered task-def revision points at the real image rather than at a
  stale placeholder. The nonexistent-`:latest` fallback exists for exactly one
  case: the first apply of a brand-new environment, where no image is in ECR
  yet (CI pushes commit-SHA tags only) and the tasks crash-loop until the app
  deploy later in the same run supplies one. A hand-run `apply` with
  `deployed_image` unset lands in that same fallback, so follow it with
  `deploy-lean.yml` before Publish (`RunTask` on the family's latest revision)
  is used.
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
- **One secret for the database.** `manage_master_user_password` makes RDS
  generate and rotate the master password in its own managed secret (nothing in
  Terraform state), and both task defs read `DB_PASS` straight out of it with
  the `:password::` JSON-key selector on the `secrets[]` entry. No app-shaped
  copy exists, so there is no second place the password can drift or leak from;
  `DB_HOST/DB_PORT/DB_USER/DB_NAME` are plain environment values.
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
- **CI deploy role, hard-won facts.** The role lives in the **bootstrap root**,
  not in this module; these empirically-established facts remain the spec its
  policy implements. `ecs:DescribeServices` on the admin service ARN (the
  workflow resolves name→ARN); the ExpressGatewayService actions' `Resource`
  includes **both** the `express-gateway-service/*` shape **and** the
  `service/<cluster>/<service>` ARN (the API authorizes Update/Describe against
  the service ARN); and the CLI rejects `--cluster` on
  `update-express-gateway-service` (ARN-only) — the workflow already resolves
  the ARN first.

## Placeholders in the recipe JSON

The recipe files still use `<ACCOUNT_ID>`, `<REGION>`, `<ECR_REPOSITORY_NAME>`,
`<ECS_CLUSTER_NAME>`, `<SUBNET_IDS>`, `<SECURITY_GROUP_IDS>`,
`<ASSET_BUCKET_NAME>`, the `<*_SECRET_ARN>` set (of which `<DB_SECRET_ARN>` is
superseded by the managed master secret — see the provenance note above),
`<EXPRESS_ONAWS_ENDPOINT>`,
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
