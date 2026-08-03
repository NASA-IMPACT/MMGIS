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
directory. The **lean** deployment is this directory plus the workflows that
deploy it — the composed pipeline below, and `deploy-lean.yml` until the
staging environment is cut over to it. The same image serves both;
`MMGIS_DEPLOYMENT_MODE` is a runtime ECS environment variable, never a Docker
build-arg (the `Dockerfile` is shared and unmodified).

## Layout

```
infrastructure/
├── terraform/
│   ├── modules/mmgis-environment/     # one complete environment, parameterized
│   └── environments/
│       ├── development/               # thin root: module call + backend + tfvars
│       └── production/                # thin root (same shape as development)
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
where each Terraform value came from.
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
- **A per-environment Terraform state bucket**, bootstrapped once. The
  bootstrap root (`terraform/bootstrap`) owns state-bucket creation; the CLI
  recipe below is the manual equivalent, and is how development's bucket was
  originally created.
- **The IAM permissions-boundary policy**, created by the bootstrap root. Its
  ARN is a required input (`permissions_boundary`, via tfvars — it carries the
  account id): every role this module creates carries the boundary, because the
  CI apply role is only allowed to create boundaried roles. An unboundaried
  role fails on the very first apply. The **bootstrap root**
  (`terraform/bootstrap`) creates the boundary, the state buckets, and all
  GitHub-facing AWS identity, the CI deploy role included — apply it first.
  On a cutover from an environment whose deploy role was
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

Record the bucket name; init receives it via `-backend-config` flags. Nothing
is shared between environments — applying one can never touch another's state.

## Apply flow

The Express Mode service does not expose its internal ALB ARN or on.aws
endpoint as Terraform attributes (only `service_arn` and `ingress_paths` are
exported), and the CloudFront VPC origin needs the ALB ARN. So the front door
is built in a **second apply**.

This section describes the flow run **by hand**. For an environment wired to
[CI-driven deploys](#ci-driven-deploys-the-composed-pipeline) the pipeline does
all of it — both phases, the discovery between them, and the image — on every
merge; a hand apply is then the break-glass path, not the normal one.

From `terraform/environments/development/` (production is analogous):

```sh
cp terraform.tfvars.example terraform.tfvars   # vpc_id, subnets, boundary ARN, CA bundle

terraform init -backend-config="bucket=<state-bucket>" -backend-config="region=<region>"
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

A from-scratch phase 1 runs with `greenfield = true` and `deployed_image`
empty, so the service points at a **placeholder image that does not exist in
ECR** (CI pushes commit-SHA tags only) and the tasks crash-loop until a real
image arrives. Push one through the pipeline now:

1. Set the environment's GitHub Actions variables from
   `terraform output -json workflow_variables` — one call returns all six
   (region, ECR repo, cluster, service, both task families), keyed by the
   variable names. The `AWS_DEPLOY_ROLE_ARN` secret comes from the **bootstrap
   root's** outputs, not from here: the CI deploy role is created there, with
   GitHub-Environment-scoped trust.
2. Run `deploy-lean.yml` (manual dispatch) and wait for the rollout to
   converge — the run summary shows the deployed image.

Both steps are for hand-built environments only. A CI-built environment sets
none of those variables and dispatches nothing: the composed pipeline reads the
six names from state at run time and its app phase pushes the first real image
in the same run as the first apply.

Only then move on: phase 2's inputs are read from the now-healthy service, and
Publish depends on the task families pointing at a real image.

### Phase 2 — CloudFront front door

Read **three values** from the running service: the internal ALB ARN, the
on.aws endpoint host, and the ECS-managed ALB's **security-group id**. It takes
**two calls** — the describe that names the service's active configuration
carries no load-balancer information at all, and the load balancer only appears
on the service *revision* that configuration points at:

```sh
SERVICE_ARN=$(terraform output -raw express_service_arn)

# 1. Newest active configuration -> the serving image and its revision ARN.
#    Old and new configurations are listed side by side while a rollout
#    drains, so take the newest by createdAt rather than the first entry.
REV_ARN=$(aws ecs describe-express-gateway-service --service-arn "$SERVICE_ARN" \
  | jq -r '[.service.activeConfigurations[]] | sort_by(.createdAt) | last.serviceRevisionArn')

# 2. That revision's ECS-managed ingress paths -> the endpoint, the ALB ARN,
#    and the ALB's security groups. Pick the path that actually carries a load
#    balancer; the others have none.
aws ecs describe-service-revisions --service-revision-arns "$REV_ARN" \
  | jq -r '.serviceRevisions[0].ecsManagedResources.ingressPaths[]
           | select(.loadBalancer.arn != null)
           | {endpoint, alb: .loadBalancer.arn, sg: .loadBalancer.securityGroupIds[0]}'
```

The endpoint host is also visible via `terraform output express_ingress_paths`.
Prefer `.loadBalancer.securityGroupIds` over the sibling
`.loadBalancerSecurityGroups[]`, whose entries carry only an `.arn`; if a CLI
version omits it, `aws elbv2 describe-load-balancers --load-balancer-arns` has
the same id. Set the three values in `terraform.tfvars` and re-apply:

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

**The composed pipeline does not need any of these set** — it reads the same
object out of state at run time. This table is for the legacy `deploy-lean.yml`
pipeline and for hand-run deploys, which have no other way to learn the names.

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
  deploy later in the same run supplies one. An apply with `deployed_image`
  empty is refused unless `greenfield = true` — the placeholder fallback exists
  only for the first build, where the app phase of the same CI run supplies the
  real image.
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

## CI-driven deploys (the composed pipeline)

An environment is deployed by **one composed run**: a thin per-environment
trigger calls two shared, reusable engines. There is one implementation of
"converge the infrastructure" and one of "ship the app"; a new environment adds
a trigger, not a pipeline.

```
.github/workflows/deploy-development.yml   trigger — when, and in which mode
├── .github/workflows/iac-deploy.yml       infrastructure engine (always runs)
└── .github/workflows/app-deploy.yml       app engine (every merge)
```

The trigger runs on every push to `development`, and on manual dispatch with an
optional **plan-only** box. It first decides a *mode* from the pushed diff, then
calls the engines:

| Mode | When | Infrastructure engine | App engine |
|---|---|---|---|
| `apply` | the push touched `infrastructure/terraform/**` or one of the three pipeline files; any dispatch that is not plan-only; any push whose diff is unknowable (new branch, force push) | two-phase converge | runs |
| `read` | every other push — the app-only merges, which are most of them | init and read the state outputs; describes nothing, changes nothing | runs |
| `plan` | plan-only dispatch | plan, published to the run summary | skipped |

**The infrastructure job always runs**, in one mode or another. Skipping it on
app-only merges is the obvious design and it does not work: a skipped job emits
no outputs on GitHub, so the app job would receive six empty names on exactly
the merges that touch no infrastructure. Path-awareness gates the mode, never
the job.

One concurrency group (`deploy-development`) spans the whole composed run and
**queues** rather than cancels — an interrupted apply leaves state locked and
infrastructure half-converged. Neither engine carries a group of its own so
that this one can cover both. GitHub keeps at most one *pending* run per group
and supersedes an older pending run, so a middle merge in a rapid burst can be
dropped; that is safe, because a later push to `development` contains the
earlier one's commits. What can never happen is two runs converging the same
environment at once.

Plan-only is how an environment is reviewed before its first real apply: expect
an ~80-resource all-creates listing, which is the whole environment being
proposed rather than a problem.

### Configuration contract

All five values are **GitHub Environment-scoped** (on the `development`
Environment, not the repository), which is what lets one engine serve every
environment without suffixed names. Populated per #252.

| Name | Kind | Where it comes from |
|---|---|---|
| `IAC_APPLY_ROLE_ARN` | secret | bootstrap root — the `mmgis-terraform-apply-<env>` role |
| `IAC_DEPLOY_ROLE_ARN` | secret | bootstrap root — the `mmgis-<env>-github-deploy` role |
| `IAC_AWS_REGION` | variable | account fact; the backend region, the credential default, and the root's `region` |
| `IAC_TFSTATE_BUCKET` | variable | the environment's own state bucket (the backend's `key`/`encrypt`/`use_lockfile` are committed) |
| `IAC_TFVARS` | variable | JSON object of the root's required no-default inputs: `vpc_id`, `private_subnet_ids`, `rds_ca_bundle_base64`, `permissions_boundary` |

Both engines bind `environment:` on their job, which is load-bearing twice
over: it is what makes GitHub mint the environment-form OIDC subject the two
roles' trust policies accept, and it is what makes the Environment-scoped
values above resolve. A caller cannot supply it, so triggers pass
`secrets: inherit` and name no value themselves. That also makes the
Environment's **deployment-branch policy** load-bearing security rather than
hygiene: any workflow on any branch in the repository could otherwise call
these engines with `environment: development` and mint the trusted OIDC
subject, so restricting which branches may deploy to the Environment is #252's
half of this contract.

Missing configuration fails the run **red**, listing every missing name at
once. A deploy that cannot configure itself is broken, not pending.

### Nothing is written back into GitHub

No workflow in this pipeline writes a GitHub variable or secret. The six
runtime names (region, ECR repository, cluster, service, both task families)
are read out of terraform state at run time with
`terraform output -json workflow_variables` and handed from the infrastructure
engine to the app engine as workflow outputs. Writing them back would mean
minting and hand-rotating a PAT — `GITHUB_TOKEN` has no variables scope — and
would leave a second copy of the truth free to drift from state.

### The image sandwich, and greenfield

Terraform never decides which image runs, but it does decide which image the
two task-definition **families** get registered with, and the backend starts
publish jobs with `RunTask` on the bare family name. So an infra apply must
never feed the families a tag that is not in ECR.

In steady state the run is a sandwich: the infrastructure engine discovers the
image the service is already serving and applies with it, then the app engine
builds the new image and rolls the service exactly once. Infra never moves the
image forward; it only avoids moving it backwards. If a live service exists but
no image can be resolved for it, the engine **refuses to apply** rather than
silently pin the families to the nonexistent placeholder. It refuses on the
same grounds when state says CloudFront already exists but the Express trio
(ALB ARN, on.aws endpoint, ALB security group) could not be discovered:
applying then would tear the distribution and its VPC origin down, and a
recreate comes back on a new `cloudfront.net` domain.

On greenfield there is nothing to discover: the first apply registers the
families against the module's `:latest` placeholder, which does not exist in
ECR, and the service crash-loops for a few minutes. This is expected and
self-healing — the app phase of the *same run* pushes a real image and rolls
the service, and ECS's launch retry picks it up. The RDS-managed master secret
appears roughly ten minutes into that first apply. Nothing here needs a human.

CloudFront is the one part that may not finish on the first run: it is only
built once the Express service's ECS-managed ALB exists, so the engine
re-discovers after applying and waits up to five minutes for the load balancer
to surface. If it does not, the phase-2 apply is skipped and any later
infrastructure run completes the front door; the environment is reachable on
its on.aws endpoint meanwhile.

### Database content is sacred

An infrastructure apply never touches, replaces, or reseeds database content.
The module manages the RDS **instance** — engine, size, subnet group, its
managed master secret — and nothing inside it; no workflow in the pipeline runs
a migration, a seed, or a restore. The superadmin seed values only seed an
account at first boot. This is verified rather than assumed: create content
through the app, merge a change that touches `infrastructure/terraform/**` so
the run applies, and confirm the content is still there afterwards. That
check is part of proving a new environment.

### Rollback and break-glass

**App rollback — re-run the last green composed run** from the Actions UI. Its
image is already built and tagged with that commit's short SHA in ECR, so the
re-run re-registers both task-definition families against exactly that image
and re-rolls the service onto it. No hand-built image, no tag juggling. Those
two app halves *are* the rollback: a re-run replays the original push event and
the mode that run decided, so a run that decided `read` re-runs the
infrastructure engine in `read` mode and applies nothing. Rolling the
infrastructure back to that commit's configuration is a separate act — a manual
dispatch on the reverted code, or the revert merge below.

**Infrastructure rollback** is a revert commit merged to `development`: the
next composed run applies it. Terraform state is versioned in the state bucket,
but rolling state back by hand is not a rollback — it is a way to lose track of
what exists.

**Break-glass** is for when CI itself is the thing that is broken. An operator
assumes `mmgis-terraform-apply-<env>` with short-lived credentials (the role
carries an operator-assume statement for exactly this) and runs the hand-apply
flow above. It is an escape hatch and never the mechanism: anything applied by
hand is drift until the same change is committed and a CI run converges on it.

## Legacy deploy pipeline (staging)

`.github/workflows/deploy-lean.yml` is the **pre-composition** pipeline. It
still deploys the existing staging environment, is deliberately left untouched
by the rebuild, and keeps running until that environment is cut over to the
composed pipeline above — retiring it is an explicit later step, never a side
effect.

It runs on push to `development` (and via `workflow_dispatch`): it builds theme
assets (`npm run build:themes`), builds and pushes the image to ECR, registers
new `ADMIN_TASK_FAMILY` **and** `PUBLISH_TASK_FAMILY` task-def revisions
pointing at the new image, and rolls the Express Mode service by updating its
primary container. It defines no ALB/target-group/scaling resources (Express
Mode owns those). See the [Workflow variables](#workflow-variables) table for
its configuration — hand-set repository variables, disjoint from the composed
pipeline's Environment-scoped `IAC_*` values, so neither pipeline can drive the
other's environment.
