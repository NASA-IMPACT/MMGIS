# Bootstrap Terraform root

Applied **by a human**, rarely, under operator credentials. Everything else in `infrastructure/terraform/` is applied by CI — this root exists so that CI never owns the things that would let it grant itself more: the CI roles themselves, the permissions boundaries that cap CI-created roles, and the state buckets.

This README is operational: how to apply this root and verify it. The conceptual layer — the two-root model, the identity and trust-subject design, the boundary + escalation-fence containment story, and the per-service scoping honesty table — lives in [docs/infrastructure/identity.md](../../../docs/infrastructure/identity.md), part of the [infrastructure reference hub](../../../docs/infrastructure/README.md).

## 1. Prerequisites

- Operator credentials in the target AWS account with enough privilege to create S3 buckets, IAM roles and an IAM policy (admin-ish; this is the one place that needs it).
- **The GitHub OIDC provider must already exist** in the account (`token.actions.githubusercontent.com`). This root only *references* it via a data source and will fail fast if it is absent — creating it here would make the provider's lifecycle a Terraform concern shared with everything else in the account.
- Terraform >= 1.11 (S3-native state locking, `use_lockfile`).
- Region: `us-west-2` by default (`var.region`).

## 2. Day-one apply (the one chicken-and-egg)

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

State loss and recovery posture are covered in [docs/infrastructure/identity.md](../../../docs/infrastructure/identity.md); the short version is that state holds no secret values, versioning makes any single bad write a rollback, and worst case is re-importing the long-lived resources with `terraform import`. The state buckets carry `prevent_destroy` — removing that guard is a deliberate two-step (edit the `lifecycle` block, then destroy).

## 3. Verified at apply time

Run these right after the first apply, and before the real environment build is scheduled. Each one proves a specific design claim from [docs/infrastructure/identity.md](../../../docs/infrastructure/identity.md); a failure here is fixed in **this** root, not worked around downstream.

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

# rerun with this environment's boundary → succeeds
# (the production boundary is denied here too: the condition is an exact match)
aws iam create-role --role-name mmgis-development-deny-test \
  --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"ecs-tasks.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
  --permissions-boundary arn:aws:iam::<ACCOUNT_ID>:policy/mmgis-ci-role-boundary-development

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
- Copy `infrastructure/terraform/environments/development/` to an **uncommitted** scratch directory and edit the module call: `environment = "development-scratch"`, `db_skip_final_snapshot = true`, `secret_recovery_window_days = 0`, and set `permissions_boundary` to this root's `permissions_boundary_arns["development"]` output.
- Initialize against the dev state bucket under the scratch key: `terraform init -backend-config="bucket=mmgis-development-tfstate-<ACCOUNT_ID>" -backend-config="region=us-west-2" -backend-config="key=mmgis/development-scratch/terraform.tfstate"`.
- Apply phase 1, then phase 2, per the module's README; then `terraform destroy`.
- All of it under the assumed dev apply role's credentials. A clean end-to-end run is the proof; any `AccessDenied` found here is a missing grant in this root.

This run is also what proves the two grants that cannot be reasoned out offline: the ECS tagging surface (provider `default_tags` ride every create call, and ECS authorizes `ecs:TagResource` against the resource being created), and the `aws:rds:primaryDBInstanceArn` tag condition the boundary uses to scope the RDS-managed master secret. If the run reaches a healthy service and destroys cleanly, both hold.

### e. The deploy roles work from an environment-bound job

Nothing meaningful to pre-verify locally beyond `aws iam simulate-principal-policy`. The first run of the app deploy engine (#247) against development is the proof.

## 4. Consumers

| Issue | What it consumes |
| --- | --- |
| #199 (environment-module amendments) | Threads the matching entry of the `permissions_boundary_arns` map (one ARN per environment) into the module, deletes the module's in-tree deploy role — leaving this root's as the only `mmgis-<env>-github-deploy` — and deletes the module's OIDC-provider data source (this root grants the read either way, so plans and applies work on both sides of that change) |
| #246 (PR plan previews) | Assumes `plan_role_arn`; reads state from `state_bucket_names` |
| #247 (apply + deploy engine) | Assumes `apply_role_arns` and `deploy_role_arns`; initializes against `state_bucket_names` |
| #248 (CI secret bootstrap) | Rides the apply role's `secretsmanager:PutSecretValue` grant on the `mmgis/<env>*` path |
| #252 (GitHub Environments setup) | Copies every output above into the matching GitHub Environment's variables |
