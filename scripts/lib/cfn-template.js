/**
 * cfn-template.js
 * Renders the CloudFormation template for a single published dashboard:
 * a private S3 bucket fronted by a CloudFront distribution whose
 * viewer-request CloudFront Function enforces a shared password
 * (HTTP Basic auth).
 *
 * The shared password is baked into the Function source as a base64
 * constant. It is deliberately NOT a CloudFormation Parameter — parameters
 * surface in DescribeStacks output, which the Deployments list reads.
 */

// Basic-auth username paired with the shared password.
const BASIC_AUTH_USER = "mmgis";

// Mirrors the environment validation in
// infrastructure/terraform/modules/mmgis-environment/variables.tf.
const ENVIRONMENT_PATTERN = /^[a-z][a-z0-9-]*$/;

// 11 = the S3 bucket-name budget for CFN-generated dashboard bucket names;
// see the length validation in
// infrastructure/terraform/modules/mmgis-environment/variables.tf.
const MAX_ENVIRONMENT_LENGTH = 11;

/**
 * The stack-name prefix for this runtime. MMGIS_ENVIRONMENT is the
 * environment name (e.g. "development"), which the Terraform module injects
 * into every lean runtime; dashboards are namespaced per environment:
 * "mmgis-<env>-dashboard-".
 * LOCKSTEP: the composed shape must match the IAM patterns in
 * infrastructure/terraform/modules/mmgis-environment/iam.tf. A value the
 * module's own validation would reject is rejected here too, so a malformed
 * name fails loudly instead of as an AccessDenied at publish time.
 */
function stackNamePrefix() {
  const env = process.env.MMGIS_ENVIRONMENT;
  if (env == null || env === "")
    throw new Error(
      "MMGIS_ENVIRONMENT is required and must be set to the environment " +
        "name (the Terraform module injects it); there is no shared default " +
        "dashboard prefix"
    );
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
 * stackNameForDeployment(12) === "mmgis-development-dashboard-12" when
 * MMGIS_ENVIRONMENT=development.
 */
function stackNameForDeployment(deploymentId) {
  if (deploymentId == null || `${deploymentId}`.length === 0)
    throw new Error("stackNameForDeployment requires a deployment id");
  return `${stackNamePrefix()}${deploymentId}`;
}

/**
 * The viewer-request CloudFront Function source. The expected
 * "Basic <base64>" Authorization value is baked in as a constant.
 */
function renderAuthFunctionCode(password) {
  const expected = Buffer.from(`${BASIC_AUTH_USER}:${password}`).toString(
    "base64"
  );
  return [
    "function handler(event) {",
    "    var request = event.request;",
    `    var EXPECTED = 'Basic ${expected}';`,
    "    var headers = request.headers;",
    "    var auth =",
    "        headers.authorization && headers.authorization.value;",
    "    if (auth !== EXPECTED) {",
    "        return {",
    "            statusCode: 401,",
    "            statusDescription: 'Unauthorized',",
    "            headers: {",
    "                'www-authenticate': {",
    "                    value: 'Basic realm=\"MMGIS Dashboard\"'",
    "                }",
    "            }",
    "        };",
    "    }",
    "    return request;",
    "}",
  ].join("\n");
}

/**
 * Renders the full CloudFormation template body (JSON string) for one
 * dashboard. No Parameters block — everything is baked.
 *
 * Outputs: BucketName, DistributionId, DistributionDomainName.
 */
function renderCfnTemplate({ password } = {}) {
  if (password == null || password === "")
    throw new Error(
      "renderCfnTemplate requires the shared dashboards password (MMGIS_DASHBOARDS_PASSWORD)"
    );

  const template = {
    AWSTemplateFormatVersion: "2010-09-09",
    Description:
      "MMGIS published dashboard: private S3 bucket + CloudFront distribution with a shared-password viewer-request Function. Managed by the MMGIS Deployments feature.",
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
            Comment: "Shared-password (Basic auth) gate for the dashboard",
            Runtime: "cloudfront-js-1.0",
          },
          FunctionCode: renderAuthFunctionCode(password),
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
  BASIC_AUTH_USER,
  stackNamePrefix,
  stackNameForDeployment,
  renderAuthFunctionCode,
  renderCfnTemplate,
};
