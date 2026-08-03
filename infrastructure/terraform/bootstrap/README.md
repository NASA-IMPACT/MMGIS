# Bootstrap Terraform root

Applied **by a human**, rarely, under operator credentials. Everything else in `infrastructure/terraform/` is applied by CI — this root exists so that CI never owns the things that would let it grant itself more.

## 1. What this root owns and why

CI cannot be allowed to create its own credentials or its own state home. The Terraform apply role that CI assumes **creates IAM roles** as part of building an environment, and a role that can create roles can, unchecked, create a better one. Two structural answers, applied together:

- **Nothing GitHub can assume lives where an automated apply can edit it.** The apply role's IAM grants are scoped to `mmgis-<env>-*`, and every OIDC-trusted identity in the account is deliberately named outside that namespace (`mmgis-terraform-apply-<env>`, `mmgis-terraform-plan`) or, where the name has to stay inside it for contract reasons (`mmgis-<env>-github-deploy`), is fenced off explicitly.
- **The fence is an explicit `Deny`, not a permissions boundary.** A permissions boundary caps what a role *can do*; it does **not** constrain edits to a role's *trust policy*. Since the whole risk here is "CI rewrites who may assume the deploy role", a boundary cannot express the rule. So `iam_apply.tf` carries a `Deny` + `NotAction` statement naming all five OIDC-trusted roles, which overrides every `Allow` above it.

The permissions boundary still matters — it caps what a *CI-created runtime role* can do, and `iam:CreateRole` is conditioned on it so a boundary-less role cannot be created at all. Boundary and fence solve different halves of the same problem.

| Resource | Name | Trusted by |
| --- | --- | --- |
| State bucket (dev) | `mmgis-development-tfstate-<ACCOUNT_ID>` | — |
| State bucket (prod) | `mmgis-production-tfstate-<ACCOUNT_ID>` | — |
| State bucket (this root) | `mmgis-bootstrap-tfstate-<ACCOUNT_ID>` | — (no CI role has any access) |
| Permissions boundary | `mmgis-ci-role-boundary` | — (attached to CI-created roles) |
| Apply role (dev) | `mmgis-terraform-apply-development` | `repo:NASA-IMPACT/MMGIS:environment:development` + account root |
| Apply role (prod) | `mmgis-terraform-apply-production` | `repo:NASA-IMPACT/MMGIS:environment:production` + account root |
| Plan role | `mmgis-terraform-plan` | `repo:NASA-IMPACT/MMGIS:pull_request` |
| Deploy role (dev) | `mmgis-development-github-deploy` | `repo:NASA-IMPACT/MMGIS:environment:development` |
| Deploy role (prod) | `mmgis-production-github-deploy` | `repo:NASA-IMPACT/MMGIS:environment:production` |

## 2. Prerequisites

- Operator credentials in the target AWS account with enough privilege to create S3 buckets, IAM roles and an IAM policy (admin-ish; this is the one place that needs it).
- **The GitHub OIDC provider must already exist** in the account (`token.actions.githubusercontent.com`). This root only *references* it via a data source and will fail fast if it is absent — creating it here would make the provider's lifecycle a Terraform concern shared with everything else in the account.
- Terraform >= 1.11 (S3-native state locking, `use_lockfile`).
- Region: `us-west-2` by default (`var.region`).

## 3. Day-one apply (the one chicken-and-egg)

This root's state belongs in a bucket this root creates, so the very first apply has nowhere to put its state. Resolve it in two steps and do not stop after the first.

```bash
cd infrastructure/terraform/bootstrap

# 1. First apply runs on LOCAL state: the bucket that will hold this
#    root's state is created by this very apply. backend_override.tf is
#    git-ignored and lives for minutes.
cat > backend_override.tf <<'EOF'
terraform {
  backend "local" {}
}
EOF
terraform init
terraform apply

# 2. Migrate the state into the bucket just created, then delete the
#    local file. Not optional: a laptop-resident state file is exactly
#    the locked-up knowledge this repo bans.
rm backend_override.tf
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
terraform init -migrate-state \
  -backend-config="bucket=mmgis-bootstrap-tfstate-${ACCOUNT_ID}" \
  -backend-config="region=us-west-2"
rm terraform.tfstate terraform.tfstate.backup
```

Every later edit to this root: same `terraform init -backend-config=...` (both values derive from `aws sts get-caller-identity` and the committed naming pattern, so there is no uncommitted config file to lose), then `terraform plan` / `terraform apply`.

## 4. Disaster-recovery posture

State here holds **no secret values**. The environment module creates secret *shells* whose values are set out-of-band, and the database's master password is RDS-managed (RDS creates and rotates it under its own service principal, and Terraform never sees it). A leaked state file is an inventory, not a credential.

Losing state entirely is survivable but tedious: the worst case is re-importing the long-lived resources (three buckets, five roles, one policy) with `terraform import`. Bucket versioning makes even that unlikely — every state revision stays recoverable, so a truncated or clobbered write is a rollback rather than an outage.

All three state buckets carry versioning, SSE (AES256), a full public-access block, and `prevent_destroy`. Removing that guard is a deliberate two-step: edit the `lifecycle` block, then destroy.

## 5. Per-service scoping: which is which

Least privilege is only honest if you say where it stops. Three patterns are in play, and the choice per service is forced by what AWS actually supports.

| Pattern | Where it is used |
| --- | --- |
| Name prefix `mmgis-<env>*` | ECR repositories, ECS clusters and services, CloudWatch log groups, IAM role names, RDS instances and DB subnet groups, asset buckets, and state-bucket object keys |
| `Resource: "*"` + an exact action allowlist (plus the boundary as backstop on CI-created roles) | CloudFront distributions / VPC origins / origin access controls (AWS-generated ids), security groups (AWS-generated ids, and the VPC id is an uncommitted input), `ecs:RegisterTaskDefinition` and `ecs:DescribeTaskDefinition` (no resource-level authorization), `ecr:GetAuthorizationToken`, and the `ec2:Describe*` / `elasticloadbalancing:Describe*` read surface |
| Path style `mmgis/<env>*` | Secrets Manager only — a **different** convention from the `mmgis-<env>-*` resource prefix, which the policy must carry explicitly or every secret operation fails |

Two deliberate asymmetries in the secret grants: `secretsmanager:PutSecretValue` is present on the apply roles for the CI secret bootstrap (#248), which generates a value into a freshly created empty shell; `secretsmanager:GetSecretValue` is **absent from every CI role**, because neither plan nor apply ever needs to read a secret value and neither should be able to exfiltrate one.

**Scratch allowance.** The development patterns deliberately also match `mmgis-development-scratch-*` and `mmgis/development-scratch/*`, so the scratch verification in §7 runs under the *real* dev apply role rather than a specially-privileged one. That is why the wildcards have no separator before them (`mmgis-development*`, not `mmgis-development-*`), and why the assets-bucket grant needs two patterns: no single pattern matches both `mmgis-development-assets-<ACCOUNT_ID>` and `mmgis-development-scratch-assets-<ACCOUNT_ID>`. Neither pattern matches a `-tfstate-` bucket — state access is *only* the dedicated state statement (object operations under the allowed key prefix, plus `ListBucket`), never bucket-configuration writes.

## 6. Trust subjects

| Role | Subject | Why |
| --- | --- | --- |
| `mmgis-terraform-apply-<env>` | `repo:NASA-IMPACT/MMGIS:environment:<env>` | The apply job binds a GitHub Environment, which is what gates production behind reviewers. An environment-bound job presents the `environment:` subject form; the GitHub Environment names must keep matching `development` / `production` exactly, because renaming one breaks every assume here. |
| `mmgis-<env>-github-deploy` | `repo:NASA-IMPACT/MMGIS:environment:<env>` | Same reason — the app deploy engine binds `environment:` at job level. |
| `mmgis-terraform-plan` | `repo:NASA-IMPACT/MMGIS:pull_request` | Joint decision with #246: the plan job must **not** bind an Environment, because doing so would flip the subject to the environment form and park a mere PR check at production's required-reviewer gate. Unbound pull_request jobs present this subject. |

The apply roles additionally trust the **account root** (`sts:AssumeRole`) so an operator can run the scratch verification and break-glass applies. Account-root trust only delegates to per-principal IAM — an operator still needs their own `sts:AssumeRole` allow on the role ARN — so it adds no external surface. The plan and deploy roles deliberately do not carry it: nothing requires a human to hold them.

**Fork PRs get no preview.** GitHub issues no OIDC token to a workflow running from a fork on a public repository, so an outside contributor's infrastructure PR cannot assume the plan role. Accepted; the plan workflow says so with a neutral notice rather than failing.

## 7. Verified at apply time

Run these right after the first apply, and before the real environment build is scheduled. Each one proves a specific claim above; a failure here is fixed in **this** root, not worked around downstream.

### a. The plan role is read-only (mutation denied)

The plan role trusts only its OIDC subject, so the denial check runs from a workflow rather than a shell. Simplest documented form: run #246's plan workflow on a PR, and in the same job, after the plan step, attempt a write:

```bash
aws s3api put-object --bucket mmgis-development-tfstate-<ACCOUNT_ID> --key deny-test --body /dev/null
# → AccessDenied
```

Equally valid: temporarily add an operator trust statement to the plan role, run the check from a shell, remove it again.

### b. Boundary-less role creation is denied

```bash
aws sts assume-role --role-arn arn:aws:iam::<ACCOUNT_ID>:role/mmgis-terraform-apply-development --role-session-name deny-test
# (export the returned credentials)

aws iam create-role --role-name mmgis-development-deny-test \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}'
# → AccessDenied (no permissions boundary supplied)

# rerun with the boundary → succeeds
aws iam create-role --role-name mmgis-development-deny-test \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --permissions-boundary arn:aws:iam::<ACCOUNT_ID>:policy/mmgis-ci-role-boundary

aws iam delete-role --role-name mmgis-development-deny-test
```

### c. The escalation fence holds (trust-policy edit denied)

```bash
# still under the dev apply role's credentials
aws iam update-assume-role-policy --role-name mmgis-development-github-deploy --policy-document file://any.json
# → AccessDenied, from an explicit deny
```

### d. Scratch apply + destroy of the full environment module under the dev apply role

This is the one that actually proves the apply-role policy against the module's real resource set, rather than against a reading of it.

- Prerequisite: the environment-module amendments (#199) must be present on their branch (the `permissions_boundary` variable threaded through), otherwise the run correctly fails at the first `iam:CreateRole`.
- Copy `infrastructure/terraform/environments/development/` to an **uncommitted** scratch directory and edit the module call: `environment = "development-scratch"`, `db_skip_final_snapshot = true`, `secret_recovery_window_days = 0`, and set `permissions_boundary` to this root's `permissions_boundary_arn` output.
- Initialize against the dev state bucket under the scratch key: `terraform init -backend-config="bucket=mmgis-development-tfstate-<ACCOUNT_ID>" -backend-config="region=us-west-2" -backend-config="key=mmgis/development-scratch/terraform.tfstate"`.
- Apply phase 1, then phase 2, per the module's README; then `terraform destroy`.
- All of it under the assumed dev apply role's credentials. A clean end-to-end run is the proof; any `AccessDenied` found here is a missing grant in this root.

### e. The deploy roles work from an environment-bound job

Nothing meaningful to pre-verify locally beyond `aws iam simulate-principal-policy`. The first run of the app deploy engine (#247) against development is the proof.

## 8. Consumers

| Issue | What it consumes |
| --- | --- |
| #199 (environment-module amendments) | Threads `permissions_boundary_arn` into the module and deletes the module's in-tree deploy role, leaving this root's as the only `mmgis-<env>-github-deploy` |
| #246 (PR plan previews) | Assumes `plan_role_arn`; reads state from `state_bucket_names` |
| #247 (apply + deploy engine) | Assumes `apply_role_arns` and `deploy_role_arns`; initializes against `state_bucket_names` |
| #248 (CI secret bootstrap) | Rides the apply role's `secretsmanager:PutSecretValue` grant on the `mmgis/<env>*` path |
| #252 (GitHub Environments setup) | Copies every output above into the matching GitHub Environment's variables |
