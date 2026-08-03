# Identity & containment — why the calls are permitted

Part of the [infrastructure reference](iac.md). How to actually apply and verify the bootstrap root lives in [its README](../infrastructure/terraform/bootstrap/README.md); this page owns the *why*.

## The two-root model

Everything in `infrastructure/terraform/` is applied by CI, except one root: **bootstrap**, applied by a human, rarely. The split exists because CI cannot be allowed to own the things that would let it grant itself more — its own credentials (the CI roles) or its own state home (the buckets that record what those roles are). The apply role CI assumes creates IAM roles as part of building an environment, and a role that can create roles can, unchecked, create a better one. Bootstrap holds the identities and the fences; the environment roots hold everything else.

### State

One state bucket per environment and nothing shared: no CI role's policy names any bucket but its own, so applying one environment can never touch another's state. The bootstrap root's own state sits in a third bucket that no CI role can touch at all, because that state describes the CI roles themselves.

Day one has a chicken-and-egg: the bootstrap root's state belongs in a bucket that root creates. The first apply therefore runs on local state and is immediately migrated into the new bucket with `terraform init -migrate-state` — the migration is mandatory, because a laptop-resident state file is exactly the locked-up knowledge this repo bans. Procedure in the [bootstrap README](../infrastructure/terraform/bootstrap/README.md).

**Disaster-recovery posture.** State holds no secret values — the environment module creates secret *shells* whose values are set out-of-band, and the RDS master password is created and rotated by RDS itself, never seen by Terraform. A leaked state file is an inventory, not a credential. Total state loss is survivable but tedious (re-import the long-lived resources); bucket versioning makes it unlikely, since every state revision stays recoverable and a clobbered write is a rollback rather than an outage. All state buckets carry versioning, SSE, a full public-access block, and `prevent_destroy`.

## The identity model

Five OIDC-trusted identities, all owned by the bootstrap root. There are no stored AWS keys anywhere — every workflow authenticates by presenting a short-lived GitHub-signed token to STS:

```mermaid
sequenceDiagram
    participant J as Workflow job
    participant O as GitHub OIDC provider
    participant S as AWS STS

    J->>O: request identity token
    O-->>J: signed JWT — subject encodes repo + environment or pull_request
    J->>S: AssumeRoleWithWebIdentity(role ARN, JWT)
    S->>S: match subject against the role's trust policy
    S-->>J: temporary credentials — nothing stored, nothing to rotate
```

| Role | Purpose | Trusted by |
| --- | --- | --- |
| `mmgis-terraform-apply-development` | Infrastructure apply, dev | `repo:NASA-IMPACT/MMGIS:environment:development` + account root |
| `mmgis-terraform-apply-production` | Infrastructure apply, prod | `repo:NASA-IMPACT/MMGIS:environment:production` + account root |
| `mmgis-terraform-plan` | Read-only PR plan previews (both envs) | `repo:NASA-IMPACT/MMGIS:pull_request` |
| `mmgis-development-github-deploy` | Image roll only, dev | `repo:NASA-IMPACT/MMGIS:environment:development` |
| `mmgis-production-github-deploy` | Image roll only, prod | `repo:NASA-IMPACT/MMGIS:environment:production` |

Bootstrap also owns the three state buckets and the two permissions boundaries (`mmgis-ci-role-boundary-<env>`, attached to every CI-created role).

### OIDC subjects: environment vs pull_request

A GitHub Actions job's OIDC subject depends on whether the job binds a GitHub Environment:

- **Environment-bound** jobs present `repo:<owner/name>:environment:<env>`. The apply and deploy workflows bind `environment:` at job level — that binding is what gates production behind required reviewers — so their roles trust the environment-form subject. Renaming a GitHub Environment breaks every assume.
- **Unbound** jobs present `repo:<owner/name>:pull_request`. The plan job deliberately stays unbound: binding an environment would flip its subject to the environment form and park a mere PR check behind production's reviewer gate. Fork PRs on a public repo receive no OIDC token at all, so outside contributors get no plan preview — accepted, and the workflow says so with a neutral notice.

The apply roles additionally trust the **account root** (`sts:AssumeRole`) so an operator can run scratch verification and break-glass applies. Account-root trust only delegates to per-principal IAM — the operator still needs their own `sts:AssumeRole` allow — so it adds no external surface. The plan and deploy roles do not carry it; nothing requires a human to hold them.

## The containment story

Two mechanisms, solving different halves of "CI creates roles safely":

**The permissions boundary caps what CI-created roles can do.** The apply role's `iam:CreateRole` is conditioned on supplying exactly its environment's boundary, so a boundary-less (or wrong-boundary) role cannot be created at all. A boundary is a cap, not a grant: a capped role's effective permissions are the intersection of its own policy with the boundary, mined from what the five runtime roles legitimately do. There is one boundary **per environment** because a shared one would cap every role at the *union* of both environments' needs — the dev apply role could then mint a role whose inline policy reads production secrets, passes production runtime roles, and pulls production images, and the cap would permit all of it. Per-environment boundaries make the development blast radius development-only.

**The escalation fence stops CI from editing the identities GitHub assumes.** A boundary cannot express this rule, because boundaries constrain what a role *does*, not edits to a role's *trust policy* — and the risk is precisely "CI rewrites who may assume the deploy role". So the fence is an explicit `Deny` in the apply role's policy, which overrides every `Allow`: all IAM writes are denied against the five OIDC-trusted roles (only reads survive, for incident response), the boundary policies themselves cannot be edited or re-versioned by either apply role, and stripping a boundary off any role in the account is denied.

Defense in depth backs the fence: every OIDC-trusted identity is named *outside* the `mmgis-<env>-*` namespace the apply roles hold IAM writes over (or, for the deploy roles whose name must stay inside it for contract reasons, is covered by the fence explicitly).

## Per-service scoping: which is which

Least privilege is only honest if you say where it stops. Three patterns are in play, forced by what AWS actually supports:

| Pattern | Where and why |
| --- | --- |
| Name prefix `mmgis-<env>*` | ECR repositories, ECS clusters/services, log groups, IAM role names, RDS instances and subnet groups, asset buckets, state-object keys — everything AWS lets you name |
| `Resource: "*"` + exact action allowlist | CloudFront distributions / VPC origins / origin access controls (AWS-generated ids), security groups (AWS-generated ids; the VPC id is an uncommitted input), `ecs:RegisterTaskDefinition` / `ecs:DescribeTaskDefinition` / `ecs:DeregisterTaskDefinition` (no resource-level authorization), `ecr:GetAuthorizationToken`, and the `Describe*` read surface. The boundary backstops CI-created roles |
| Path style `mmgis/<env>*` | Secrets Manager only — a **different** convention from the `mmgis-<env>-*` resource prefix, which every policy must carry explicitly or all secret operations fail |

Notable deliberate edges:

- **Secret value asymmetry.** `secretsmanager:PutSecretValue` exists on the apply roles for the CI secret bootstrap (#248), which writes a generated value into a freshly created shell. `GetSecretValue` is absent from *every* CI role: neither plan nor apply ever needs to read a secret value, and neither should be able to exfiltrate one.
- **RDS-managed master secret.** RDS names it `rds!db-<id>` — nothing environment-distinguishing — so the runtime boundary scopes it by the `aws:rds:primaryDBInstanceArn` tag RDS sets, the only per-environment handle. If that condition fails at scratch verification, try `StringLike` before falling back to the bare `rds!*` pattern plus a documented residual — decided then, not silently.
- **No object-level delete on asset buckets.** The apply roles manage asset-bucket *configuration* only, so destroying an environment that has served uploads requires emptying its bucket out-of-band first. That friction is the point: deleting user data stays a deliberate human act.
- **Scratch allowance.** Development patterns deliberately also match `mmgis-development-scratch-*` / `mmgis/development-scratch/*`, so the scratch verification runs under the *real* dev apply role. That is why wildcards have no separator before them, and why asset-bucket grants need two patterns. No pattern anywhere matches a `-tfstate-` bucket name, so state stays structurally out of reach.
- **Dashboard resources are environment-namespaced in lockstep with the app.** Dashboards are published by the application at runtime (a CloudFormation stack per dashboard) under the `mmgis-<env>-dashboard-` prefix; the IAM patterns pin to that exact string, and the [environments page](environments.md#dashboard-stacks-app-created-environment-namespaced) covers the lockstep and the 11-character environment-name cap it forces.
