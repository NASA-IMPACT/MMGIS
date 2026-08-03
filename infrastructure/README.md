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
Terraform's applies here are the bootstrap root's one-time apply (state buckets
and CI identity — `terraform/bootstrap`), the secret **values**, and the
runtime-created per-dashboard CloudFormation stacks (application behavior,
explicitly staying CloudFormation).

**Dual-deployment posture:** the **full** deployment is the upstream MMGIS
default (docker-compose, bundled sidecar services) and uses **none** of this
directory. The **lean** deployment is this directory plus the composed pipeline
below. The same image serves both; `MMGIS_DEPLOYMENT_MODE` is a runtime ECS
environment variable, never a Docker build-arg (the `Dockerfile` is shared and
unmodified).

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
are the recipe JSONs the Terraform module was translated from — every attribute
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
- **A per-environment Terraform state bucket** and **the IAM
  permissions-boundary policy**, both created by the bootstrap root
  (`terraform/bootstrap`) — apply it first. The boundary ARN is a required
  input (`permissions_boundary`, uncommitted: it carries the account id); every
  role this module creates carries the boundary because the CI apply role may
  only create boundaried roles.
- **Secret values**, set after the apply ([below](#secret-values)). Terraform
  defines the secrets' existence and names only.
- **The RDS regional CA bundle**, supplied as `rds_ca_bundle_base64` (below).
- **No custom domain.** Bare-CloudFront posture: viewers use the default
  `*.cloudfront.net` certificate; the distribution carries no aliases.
- **linux/amd64 images only.** The task defs pin `X86_64`; a local build on
  Apple Silicon must use `docker buildx build --platform linux/amd64`. The
  GitHub-hosted CI runners are amd64, so the pipeline's plain build is fine.

## Hand applies (break-glass)

CI is the way this infrastructure changes: merge, and the composed pipeline
([below](#ci-driven-deploys-the-composed-pipeline)) discovers the live facts,
applies both phases, and deploys the app in one run. Run Terraform by hand only
when the pipeline itself is broken — and treat everything applied by hand as
drift until the same change merges and a CI run converges on it.

The environment module refuses to apply without four facts about the live
environment: the serving image (`deployed_image`) and the Express trio
(`express_internal_alb_arn`, `express_onaws_endpoint`,
`express_alb_security_group_id`). Their empty defaults are only legal under
`greenfield = true`, which is CI's mechanism for first builds — never set it by
hand against a live environment. The CloudFront distribution additionally
carries `prevent_destroy`, so a plan that would destroy it fails instead;
intentional teardown means editing that flag off in a working copy of the
module's `cloudfront.tf` (never committed).

From `terraform/environments/<environment>/`:

1. **Assume the environment's apply role**, `mmgis-terraform-apply-<env>`
   (bootstrap root; it carries an operator-assume statement for exactly this),
   with short-lived credentials.
2. **Fetch the uncommittable inputs** from the GitHub Environment (repository
   Settings → Environments → `<env>`). From `IAC_TFVARS`: `vpc_id`,
   `private_subnet_ids`, `rds_ca_bundle_base64`, `permissions_boundary` — that
   variable is the authoritative copy; do not reconstruct these from memory or
   an old tfvars file. It carries those four keys (plus an optional `region`
   override) and nothing else: never add `greenfield` or the live facts below
   to it (CI writes the object to an auto-tfvars file, which would override its
   per-run discovery and disable the module's guards). Also note
   `IAC_AWS_REGION` and `IAC_TFSTATE_BUCKET`.
   Write the four values — plus `region = "<IAC_AWS_REGION>"` if the account
   is not in the default `us-west-2`; the provider reads `var.region`, not
   your CLI configuration — to an uncommitted `terraform.tfvars` here.
3. **Init.** The backend commits `key`/`encrypt`/`use_lockfile`; bucket and
   region are the two Environment values from step 2:

   ```sh
   terraform init -backend-config="bucket=<IAC_TFSTATE_BUCKET>" -backend-config="region=<IAC_AWS_REGION>"
   ```

4. **Discover the four live facts** (needs the initialized backend — the first
   command reads a terraform output). Re-run this before every hand apply —
   the trio goes stale whenever ECS replaces the service's ALB, and the
   serving image moves on every deploy:

   ```sh
   SERVICE_ARN=$(terraform output -raw express_service_arn)

   # 1. Newest active configuration -> the serving image (deployed_image) and
   #    its revision ARN. Old and new configurations are listed side by side
   #    while a rollout drains, so take the newest by createdAt rather than
   #    the first entry.
   # --output json on both calls: a CLI profile defaulting to text/table breaks jq.
   EGS_JSON=$(aws ecs describe-express-gateway-service --service-arn "$SERVICE_ARN" --output json)
   printf '%s' "$EGS_JSON" \
     | jq -r '[.service.activeConfigurations[]] | sort_by(.createdAt) | last.primaryContainer.image'
   REV_ARN=$(printf '%s' "$EGS_JSON" \
     | jq -r '[.service.activeConfigurations[]] | sort_by(.createdAt) | last.serviceRevisionArn')

   # 2. That revision's ECS-managed ingress paths -> the endpoint, the ALB ARN,
   #    and the ALB's security groups. Pick the path that actually carries a
   #    load balancer; the others have none.
   aws ecs describe-service-revisions --service-revision-arns "$REV_ARN" --output json \
     | jq -r '.serviceRevisions[0].ecsManagedResources.ingressPaths[]
              | select(.loadBalancer.arn != null)
              | {endpoint, alb: .loadBalancer.arn, sg: .loadBalancer.securityGroupIds[0]}'
   ```

   The endpoint host is also visible via
   `terraform output express_ingress_paths`. Prefer
   `.loadBalancer.securityGroupIds` over the sibling
   `.loadBalancerSecurityGroups[]`, whose entries carry only an `.arn`; if a
   CLI version omits it, `aws elbv2 describe-load-balancers
   --load-balancer-arns` has the same id. Strip any scheme from the endpoint —
   the module wants a bare host. Set all four live facts in `terraform.tfvars`.
5. **Plan, then apply:**

   ```sh
   terraform plan
   terraform apply
   ```

Read the plan before approving it: with the four facts current, a hand apply
should propose only the change you came to make.

The ALB security group itself is created and owned by ECS Express Mode — the
module only adds the one ingress rule to it, so no hand-executed mutation
remains anywhere in the flow.

VPC origins **cannot be updated while status=Deploying** and deploy cycles run
~6–10 minutes — be patient between changes.

## Secret values

The apply creates the five secrets as empty shells — Terraform defines their
existence and names only (`modules/mmgis-environment/secrets.tf`); a value in
the configuration would be a value in the state file. Set each value once:

```sh
aws secretsmanager put-secret-value --secret-id mmgis/<env>/mapbox-token --secret-string '<mapbox-token>'
```

The same command sets any of the five slots. Nothing DB-related is ever set
this way: the database password lives only in the RDS-managed master secret,
which the task definitions reference directly.

## Operational notes

- **Terraform never decides which image runs — CI does.** Every pipeline apply
  hands the module the currently deployed image (`deployed_image`), so a
  re-registered task-def revision points at the real image rather than at a
  stale placeholder. The nonexistent-`:latest` fallback exists for exactly one
  case: the first apply of a brand-new environment, where no image is in ECR
  yet (CI pushes commit-SHA tags only) and the tasks crash-loop until the app
  deploy later in the same run supplies one. An apply with `deployed_image`
  empty is refused unless `greenfield = true`.
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
- **CI deploy role facts.** The role lives in the **bootstrap root**, not in
  this module; these empirically-established facts remain the spec its policy
  implements. `ecs:DescribeServices` on the admin service ARN (the
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
.github/workflows/deploy-development.yml   trigger — push to `development`
.github/workflows/deploy-production.yml    trigger — push to `production`, gated
└── both call, in order:
    ├── .github/workflows/iac-deploy.yml   infrastructure engine (always runs)
    └── .github/workflows/app-deploy.yml   app engine (every merge)
```

A trigger runs on every push to its own branch, and on manual dispatch with an
optional **plan-only** box. It first decides a *mode* from the pushed diff, then
calls the engines:

| Mode | When | Infrastructure engine | App engine |
|---|---|---|---|
| `apply` | the push touched `infrastructure/terraform/**` or one of its three pipeline files (the two engines or the trigger itself); any dispatch that is not plan-only; any push whose diff is unknowable (new branch, force push) | two-phase converge | runs |
| `read` | every other push — the app-only merges, which are most of them | init and read the state outputs; describes nothing, changes nothing | runs |
| `plan` | plan-only dispatch | plan, published to the run summary | skipped |

**The infrastructure job always runs**, in one mode or another. Skipping it on
app-only merges is the obvious design and it does not work: a skipped job emits
no outputs on GitHub, so the app job would receive six empty names on exactly
the merges that touch no infrastructure. Path-awareness gates the mode, never
the job.

One concurrency group per trigger (`deploy-development`, `deploy-production`)
spans that trigger's whole composed run and **queues** rather than cancels — an
interrupted apply leaves state locked and infrastructure half-converged. Neither
engine carries a group of its own so that this one can cover both. GitHub keeps
at most one *pending* run per group and supersedes an older pending run, so a
middle merge in a rapid burst can be dropped; that is safe, because a later push
to the branch contains the earlier one's commits. On development, which has no
gate, that means two runs never converge the environment at once. The gated
production trigger carries a caveat — a run parked at the approval gate is
outside the group — described in [its own section](#production-the-gated-trigger).

Plan-only is how an environment is reviewed before its first real apply: expect
an ~80-resource all-creates listing, which is the whole environment being
proposed rather than a problem.

### Production: the gated trigger

Merging to `production` expresses intent; it does not deploy. The push starts a
run that **parks** at GitHub's native required-reviewers gate on the
`production` Environment (configured by #252), with **zero AWS activity behind
it**. The only job that runs ungated is the mode decider — pure git and pure
bash, no credentials, no `environment:` key — which also writes the approver's
notes into the run summary, so the commit being deployed, its expected image
tag, the run's mode, and the rules below are on the run page at the moment the
decision is made. A run
that is rejected, or simply never approved, deploys nothing at all.

The gate lives in the **engines**, not in the trigger: both engine jobs bind
`environment: production`, and binding the Environment is what asks for
approval. That is what makes it unbypassable — there is no path through this
trigger that reaches AWS without first passing it.

**Two approval clicks per run, and that is expected.** Required-reviewer
approval is per *job*, not per run. The `needs:`-chained app job reaches the
gate only after the infrastructure job has finished, so a second request
appears mid-run, minutes after the first. It is deliberately not "fixed" by
weakening the environment binding or by fronting a single unbound gate job: the
binding is what makes GitHub mint the environment-form OIDC subject the
production roles' trust policies accept, and what makes the Environment-scoped
values resolve. A click is cheaper than either.

**Approve the newest run only.** Successive merges park successive runs, and
approving an older parked run deploys an older commit over a newer one.
Auto-cancel cannot be relied on to tidy the rest up — a run waiting at an
approval gate counts as "waiting", not "in progress" — so stale parked runs
accumulate outside the concurrency group entirely. Releasing two approvals in
quick succession therefore leans on the group catching the second run once it
starts executing, on terraform's state lock as the infrastructure backstop, and
above all on this rule. That is why the trigger writes it into every run's
summary rather than delegating it to concurrency settings.

**Image provenance.** Production builds its own image, from the
production-branch commit, into production's own ECR repository, tagged with
that commit's short SHA. Images built for development are never promoted across
environments — not by a workflow, not by hand. Every environment's registry
holds only images built from that environment's branch.

**Manual dispatch is gated identically**, because the gate is in the engines
rather than in any one entry point. Plan-only previews the converge without
applying or deploying anything. The `deployed_image` dispatch input is the
escape hatch for the infrastructure engine's refusal guard — a live service
whose serving image cannot be discovered — and nothing more. It pins nothing
durably: on any run that is not plan-only, the app job builds the dispatched
commit and re-registers both task-definition families against that fresh image
minutes later, and a plan-only run applies nothing at all. The URI must point
at an image in that environment's own ECR registry; another environment's image
would be cross-environment promotion, which the provenance rule above forbids.

**Dormant until #252.** The `production` branch, its Environment (required
reviewers plus the deployment-branch policy), and its configuration values do
not exist yet, so the trigger never fires: there is no branch to push to and no
Environment to dispatch against. The first gated run is #254's one-time
greenfield standup.

### Configuration contract

All five values are **GitHub Environment-scoped** — each Environment carries
its own copy of the five, on the Environment rather than the repository — which
is what lets one engine serve every environment without suffixed names.
Populated per #252.

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
subject, so restricting which branches may deploy to the Environment is the
Environment configuration's half of this contract.

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
The apply passes the module an explicit `greenfield = true` on these runs —
Terraform refuses empty live facts without it, so a hand apply can never wander
into the placeholder-and-no-CloudFront shape by accident.

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

**App rollback — re-run the last green composed run** from the Actions UI. The
app engine rebuilds that commit from source and re-pushes the image under the
same short-SHA tag, then re-registers both task-definition families against it
and re-rolls the service onto it. Same source is not the same bits: the rebuild
re-resolves dependencies within their declared version ranges. Those two app
halves *are* the rollback: a re-run replays the original push event and the
mode that run decided, so a run that decided `read` re-runs the infrastructure
engine in `read` mode and applies nothing. Rolling the infrastructure back to
that commit's configuration is a separate act — a manual dispatch on the
reverted code, or the revert merge below.

**Infrastructure rollback** is a revert commit merged to the environment's own
branch: the next composed run applies it. Terraform state is versioned in the
state bucket, but rolling state back by hand is not a rollback — it is a way to
lose track of what exists.

On production every one of these paths — the re-run, the revert merge, the
manual dispatch — parks at the same approval gate as any other run.

**Break-glass** is for when CI itself is the thing that is broken. An operator
assumes `mmgis-terraform-apply-<env>` with short-lived credentials (the role
carries an operator-assume statement for exactly this) and runs the hand-apply
flow above. On a live, CI-built environment there is no local `terraform.tfvars`
to start from — set `deployed_image` **and the three `express_*` phase-2
values** in tfvars before applying (discover them the same way the engine
does — the recipe is in [Hand applies
(break-glass)](#hand-applies-break-glass)); the module refuses to plan without
them. It is an escape hatch and never the mechanism: anything applied
by hand is drift until the same change is committed and a CI run converges on
it.
