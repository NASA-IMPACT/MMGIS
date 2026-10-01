/**
 * cfn-template.js
 * Renders the CloudFormation template for a single published dashboard:
 * a private S3 bucket fronted by a CloudFront distribution with a
 * viewer-request CloudFront Function. The Function handles path prefixes
 * always, and — where gated — enforces the dashboard's own credential,
 * else the shared password (HTTP Basic auth).
 *
 * The credential is baked into the Function source as a base64
 * constant. It is deliberately NOT a CloudFormation Parameter — parameters
 * surface in DescribeStacks output, which the Deployments list reads.
 *
 * A dashboard with its own credential is always gated; otherwise the gate is
 * the environment's choice (Terraform's dashboards_require_auth, reaching the
 * publish task as MMGIS_DASHBOARDS_REQUIRE_AUTH). The Function itself is the
 * same either way — a boolean baked into its body at publish decides whether
 * the password check runs — and so is everything else about the stack.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_STACK_NAME_PREFIX = "mmgis-dashboard-";

// The readable source of the viewer-request CloudFront Function, resolved
// from this module's own location so it works regardless of the process's
// cwd. See renderAuthFunctionCode's read error for the packaging
// requirement this implies.
const AUTH_FUNCTION_SOURCE_PATH = path.join(
  __dirname,
  "..",
  "..",
  "infrastructure",
  "cloudfront-function.js"
);

const BASIC_AUTH_CREDENTIALS_PLACEHOLDER = "<BASE64_BASIC_CREDENTIALS>";

// The source file is the deployable GATED shape — valid ES5 on its own —
// so its gate boolean already reads true. An ungated render swaps this one
// line for its false form and changes nothing else.
const REQUIRE_AUTH_GATED_LINE = "var REQUIRE_AUTH = true;";
const REQUIRE_AUTH_UNGATED_LINE = "var REQUIRE_AUTH = false;";

// Default Basic-auth username, paired with the shared password.
const BASIC_AUTH_USER = "mmgis";

/**
 * Whether the dashboards this runtime publishes carry the password gate,
 * decided from the raw MMGIS_DASHBOARDS_REQUIRE_AUTH value. Only the exact
 * string "false" ungates them; every other value — unset, empty, "False",
 * "0", " false" — gates them, so a missing or garbled variable fails closed.
 *
 * FromEnv because the argument is the raw variable, not a decision already
 * made: a boolean `false` here is not the string "false", so it GATES —
 * the opposite of what requireAuth: false means to renderCfnTemplate.
 */
function dashboardsAuthRequiredFromEnv(value) {
  return value !== "false";
}

// Mirrors the environment validation in
// infrastructure/terraform/modules/mmgis-environment/variables.tf.
const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9-]*$/;

// 11 = the S3 bucket-name budget for CFN-generated dashboard bucket names;
// see the length validation in
// infrastructure/terraform/modules/mmgis-environment/variables.tf.
const MAX_ENVIRONMENT_LENGTH = 11;

/**
 * The stack-name prefix for this runtime. When MMGIS_ENVIRONMENT is set
 * (the Terraform module sets it to the environment name, e.g. "development"),
 * dashboards are namespaced per environment: "mmgis-<env>-dashboard-".
 * Unset/empty => the legacy shared prefix "mmgis-dashboard-" (the hand-built
 * environment never sets the variable and must keep today's names).
 * LOCKSTEP: the composed shape must match the IAM patterns in
 * infrastructure/terraform/modules/mmgis-environment/iam.tf. A value the
 * module's own validation would reject is rejected here too, so a malformed
 * name fails loudly instead of as an AccessDenied at publish time.
 */
function stackNamePrefix() {
  const env = process.env.MMGIS_ENVIRONMENT;
  if (env == null || env === "") return DEFAULT_STACK_NAME_PREFIX;
  if (!ENVIRONMENT_PATTERN.test(env))
    throw new Error(
      `MMGIS_ENVIRONMENT '${env}' must be lowercase alphanumeric/hyphen ` +
        "(matching the Terraform module's environment validation)"
    );
  if (env.length > MAX_ENVIRONMENT_LENGTH)
    throw new Error(
      `MMGIS_ENVIRONMENT '${env}' must be at most ${MAX_ENVIRONMENT_LENGTH} ` +
        "characters — longer names blow the 63-character S3 bucket-name " +
        "budget for CFN-generated dashboard buckets"
    );
  return `mmgis-${env}-dashboard-`;
}

/**
 * The deterministic stack name for a deployment row id, e.g.
 * stackNameForDeployment(12) === "mmgis-dashboard-12" by default, or
 * "mmgis-development-dashboard-12" when MMGIS_ENVIRONMENT=development.
 */
function stackNameForDeployment(deploymentId) {
  if (deploymentId == null || `${deploymentId}`.length === 0)
    throw new Error("stackNameForDeployment requires a deployment id");
  return `${stackNamePrefix()}${deploymentId}`;
}

/**
 * The viewer-request CloudFront Function source, read from
 * infrastructure/cloudfront-function.js (the single source of truth for the
 * function body) with its leading doc-comment header stripped. See that file
 * for what the function itself does (auth gate, X-Forwarded-Prefix handling).
 *
 * The source is already the gated shape, so gating only substitutes
 * <BASE64_BASIC_CREDENTIALS> with base64(username + ":" + password). Ungating
 * flips the source's `var REQUIRE_AUTH = true;` line to `false` — the value
 * the Function's own gate condition reads — and leaves the credential empty,
 * so an ungated dashboard ships nothing for its (unreachable) 401 branch to
 * match against and the password is never read.
 *
 * Only requireAuth === false ungates. Every other value — undefined, null, 0,
 * "" — gates and so demands the password, because a caller that mangles the
 * flag must fail toward the gate, never away from it.
 */
function renderAuthFunctionCode(
  password,
  requireAuth = true,
  username = BASIC_AUTH_USER
) {
  const source = fs.readFileSync(AUTH_FUNCTION_SOURCE_PATH, "utf8");

  const body = source.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trimEnd();

  for (const required of [
    REQUIRE_AUTH_GATED_LINE,
    BASIC_AUTH_CREDENTIALS_PLACEHOLDER,
  ])
    if (body.indexOf(required) === -1)
      throw new Error(
        `renderAuthFunctionCode: ${AUTH_FUNCTION_SOURCE_PATH} is missing ` +
          `'${required}' — cannot render the function.`
      );

  const gated = requireAuth !== false;

  if (gated && (password == null || password === ""))
    throw new Error(
      "renderAuthFunctionCode requires the shared dashboards password (MMGIS_DASHBOARDS_PASSWORD)"
    );

  const expected = gated
    ? Buffer.from(`${username}:${password}`).toString("base64")
    : "";

  const withGate = gated
    ? body
    : body.replace(REQUIRE_AUTH_GATED_LINE, REQUIRE_AUTH_UNGATED_LINE);

  return withGate.replace(BASIC_AUTH_CREDENTIALS_PLACEHOLDER, expected);
}

/**
 * Renders the full CloudFormation template body (JSON string) for one
 * dashboard. No Parameters block — everything is baked.
 *
 * Outputs: BucketName, DistributionId, DistributionDomainName.
 *
 * Only requireAuth === false ungates the dashboard; any other value gates it
 * and requires the password.
 */
function renderCfnTemplate({
  password,
  requireAuth = true,
  username = BASIC_AUTH_USER,
} = {}) {
  const gated = requireAuth !== false;

  if (gated && (password == null || password === ""))
    throw new Error(
      "renderCfnTemplate requires the shared dashboards password (MMGIS_DASHBOARDS_PASSWORD)"
    );

  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: gated
      ? "MMGIS published dashboard: private S3 bucket + CloudFront distribution with a shared-password viewer-request Function. Managed by the MMGIS Deployments feature."
      : "MMGIS published dashboard: private S3 bucket + CloudFront distribution with a path-prefix viewer-request Function and no password gate. Managed by the MMGIS Deployments feature.",
    Resources: {
      DashboardBucket: {
        Type: "AWS::S3::Bucket",
        Properties: {
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: [
              {
                ServerSideEncryptionByDefault: {
                  SSEAlgorithm: "AES256",
                },
              },
            ],
          },
        },
      },
      DashboardBucketPolicy: {
        Type: "AWS::S3::BucketPolicy",
        Properties: {
          Bucket: { Ref: "DashboardBucket" },
          PolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Sid: "AllowCloudFrontServicePrincipalReadOnly",
                Effect: "Allow",
                Principal: { Service: "cloudfront.amazonaws.com" },
                Action: "s3:GetObject",
                Resource: {
                  "Fn::Join": [
                    "",
                    [{ "Fn::GetAtt": ["DashboardBucket", "Arn"] }, "/*"],
                  ],
                },
                Condition: {
                  StringEquals: {
                    "AWS:SourceArn": {
                      "Fn::Join": [
                        "",
                        [
                          "arn:aws:cloudfront::",
                          { Ref: "AWS::AccountId" },
                          ":distribution/",
                          { Ref: "DashboardDistribution" },
                        ],
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      },
      DashboardOriginAccessControl: {
        Type: "AWS::CloudFront::OriginAccessControl",
        Properties: {
          OriginAccessControlConfig: {
            Name: { "Fn::Sub": "${AWS::StackName}-oac" },
            OriginAccessControlOriginType: "s3",
            SigningBehavior: "always",
            SigningProtocol: "sigv4",
          },
        },
      },
      DashboardAuthFunction: {
        Type: "AWS::CloudFront::Function",
        Properties: {
          Name: { "Fn::Sub": "${AWS::StackName}-auth" },
          AutoPublish: true,
          FunctionConfig: {
            Comment: gated
              ? "Shared-password (Basic auth) gate + path-prefix handler for the dashboard"
              : "Path-prefix handler for the dashboard",
            Runtime: "cloudfront-js-1.0",
          },
          FunctionCode: renderAuthFunctionCode(password, gated, username),
        },
      },
      DashboardDistribution: {
        Type: "AWS::CloudFront::Distribution",
        Properties: {
          DistributionConfig: {
            Comment: { "Fn::Sub": "MMGIS dashboard ${AWS::StackName}" },
            Enabled: true,
            DefaultRootObject: "index.html",
            HttpVersion: "http2",
            Origins: [
              {
                Id: "DashboardBucketOrigin",
                DomainName: {
                  "Fn::GetAtt": ["DashboardBucket", "RegionalDomainName"],
                },
                OriginAccessControlId: {
                  "Fn::GetAtt": ["DashboardOriginAccessControl", "Id"],
                },
                S3OriginConfig: { OriginAccessIdentity: "" },
              },
            ],
            DefaultCacheBehavior: {
              TargetOriginId: "DashboardBucketOrigin",
              ViewerProtocolPolicy: "redirect-to-https",
              // AWS managed policy: CachingOptimized
              CachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
              FunctionAssociations: [
                {
                  EventType: "viewer-request",
                  FunctionARN: {
                    "Fn::GetAtt": ["DashboardAuthFunction", "FunctionARN"],
                  },
                },
              ],
            },
            ViewerCertificate: { CloudFrontDefaultCertificate: true },
          },
        },
      },
    },
    Outputs: {
      BucketName: {
        Description: "The dashboard's S3 bucket",
        Value: { Ref: "DashboardBucket" },
      },
      DistributionId: {
        Description: "The dashboard's CloudFront distribution id",
        Value: { Ref: "DashboardDistribution" },
      },
      DistributionDomainName: {
        Description: "The dashboard's CloudFront domain name",
        Value: { "Fn::GetAtt": ["DashboardDistribution", "DomainName"] },
      },
    },
  };

  return JSON.stringify(template, null, 2);
}

module.exports = {
  DEFAULT_STACK_NAME_PREFIX,
  BASIC_AUTH_USER,
  dashboardsAuthRequiredFromEnv,
  stackNamePrefix,
  stackNameForDeployment,
  renderAuthFunctionCode,
  renderCfnTemplate,
};
