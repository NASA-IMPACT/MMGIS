/**
 * Reference source for the per-dashboard password-gate CloudFront Function
 * (viewer-request, cloudfront-js-1.0 runtime).
 *
 * Canonical reference only — this file is never deployed directly. The
 * deployed copy is generated at publish time by renderAuthFunctionCode() in
 * scripts/lib/cfn-template.js, which inlines this exact body into each
 * mmgis-dashboard-* CloudFormation stack with <BASE64_BASIC_CREDENTIALS>
 * replaced by base64("mmgis:" + MMGIS_DASHBOARDS_PASSWORD). The password is
 * baked into the Function body, never a CloudFormation Parameter (parameters
 * surface in DescribeStacks output, which the Deployments list reads).
 *
 * tests/unit/infrastructure.spec.js asserts this reference stays in sync
 * with renderAuthFunctionCode(). If you change one, change both.
 */
function handler(event) {
    var request = event.request;
    var EXPECTED = 'Basic <BASE64_BASIC_CREDENTIALS>';
    var headers = request.headers;
    var auth =
        headers.authorization && headers.authorization.value;
    if (auth !== EXPECTED) {
        return {
            statusCode: 401,
            statusDescription: 'Unauthorized',
            headers: {
                'www-authenticate': {
                    value: 'Basic realm="MMGIS Dashboard"'
                }
            }
        };
    }
    return request;
}
