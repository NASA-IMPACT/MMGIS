/**
 * cfn-template.js
 * Renders the CloudFormation template for a single published dashboard:
 * a private S3 bucket fronted by a CloudFront distribution with a
 * viewer-request CloudFront Function. The Function handles path prefixes
 * always, and — where the environment asks for it — enforces a shared
 * password (HTTP Basic auth).
 *
 * The shared password is baked into the Function source as a base64
 * constant. It is deliberately NOT a CloudFormation Parameter — parameters
 * surface in DescribeStacks output, which the Deployments list reads.
 *
 * Whether dashboards are gated is a per-environment choice
 * (Terraform's dashboards_require_auth, reaching the publish task as
 * MMGIS_DASHBOARDS_REQUIRE_AUTH). Ungated, the Function ships without its
 * auth block; everything else about the stack is identical.
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

// The marked span of infrastructure/cloudfront-function.js holding the
// Basic-auth gate — matched whole (marker lines included) so an ungated
// render drops it and keeps the rest of the handler byte-for-byte. No `g`
// flag on purpose: the replace below cuts the first marked span only, and
// the source carries exactly one.
const AUTH_GATE_BLOCK =
  /^[ \t]*\/\/ MMGIS:AUTH-GATE-START[\s\S]*?^[ \t]*\/\/ MMGIS:AUTH-GATE-END[ \t]*\r?\n/m;

// Basic-auth username paired with the shared password.
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
 * When gated, the <BASE64_BASIC_CREDENTIALS> placeholder is substituted with
 * base64("mmgis:" + password). Ungated, the marked auth-gate block is cut out
 * and the password is never read; the prefix handling that is the rest of the
 * function ships unchanged.
 *
 * Only requireAuth === false ungates. Every other value — undefined, null, 0,
 * "" — gates and so demands the password, because a caller that mangles the
 * flag must fail toward the gate, never away from it.
 */
function renderAuthFunctionCode(password, requireAuth = true) {
  const source = fs.readFileSync(AUTH_FUNCTION_SOURCE_PATH, "utf8");

  const body = source.replace(/^\/\*[\s\S]*?\*\/\s*/, "").trimEnd();

  if (requireAuth === false) {
    if (!AUTH_GATE_BLOCK.test(body))
      throw new Error(
        `renderAuthFunctionCode: ${AUTH_FUNCTION_SOURCE_PATH} is missing the ` +
          "MMGIS:AUTH-GATE-START/END markers — cannot render the function " +
          "without its auth gate."
      );
    const ungated = body.replace(AUTH_GATE_BLOCK, "");
    // The placeholder lives inside the gate; surviving it means the markers
    // no longer bracket the whole gate, and the credentials line would ship
    // un-substituted.
    if (ungated.indexOf(BASIC_AUTH_CREDENTIALS_PLACEHOLDER) !== -1)
      throw new Error(
        `renderAuthFunctionCode: ${BASIC_AUTH_CREDENTIALS_PLACEHOLDER} ` +
          "survives outside the MMGIS:AUTH-GATE markers — the markers do not " +
          "bracket the whole auth gate."
      );
    return ungated;
  }

  if (password == null || password === "")
    throw new Error(
      "renderAuthFunctionCode requires the shared dashboards password (MMGIS_DASHBOARDS_PASSWORD)"
    );

  if (body.indexOf(BASIC_AUTH_CREDENTIALS_PLACEHOLDER) === -1)
    throw new Error(
      `renderAuthFunctionCode: ${AUTH_FUNCTION_SOURCE_PATH} is missing the ` +
        `${BASIC_AUTH_CREDENTIALS_PLACEHOLDER} placeholder — cannot bake in ` +
        "the shared password."
    );

  const expected = Buffer.from(`${BASIC_AUTH_USER}:${password}`).toString(
    "base64"
  );
  return body.replace(BASIC_AUTH_CREDENTIALS_PLACEHOLDER, expected);
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
function renderCfnTemplate({ password, requireAuth = true } = {}) {
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
          FunctionCode: renderAuthFunctionCode(password, gated),
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
