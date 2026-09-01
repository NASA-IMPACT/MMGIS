/**
 * The per-dashboard password gate + path-prefix handler. This file IS what
 * gets deployed: renderAuthFunctionCode() in scripts/lib/cfn-template.js
 * reads it at publish time, strips this header comment, and bakes
 * base64("mmgis:" + MMGIS_DASHBOARDS_PASSWORD) into the
 * <BASE64_BASIC_CREDENTIALS> placeholder. The password lives in the
 * function body and never in a CloudFormation Parameter, because
 * parameters show up in DescribeStacks — which the admin's Deployments
 * list reads on every load.
 *
 * What the handler does, in order:
 *   1. password gate — wrong or missing Authorization → 401, nothing else runs
 *   2. read and validate X-Forwarded-Prefix (see trust model below);
 *      a missing or malformed header means: change nothing
 *   3. bare-prefix entry URL → 302 to the trailing-slash form, query
 *      string carried along (unsafe pairs dropped, see below)
 *   4. prefixed request → strip the prefix so the S3 lookup is prefix-blind
 *
 * Trust model: the header is unauthenticated input. Anyone holding the
 * shared password can send it straight to this distribution, bypassing any
 * fronting CloudFront — so validating it is load-bearing, not hygiene.
 *
 * Stay ES5: the cloudfront-js-1.0 runtime has no let/const (use var), and
 * a unit test parses this body with espree at ES5 to keep it that way.
 *
 * Encoding: CloudFront appears to hand querystring values over still
 * percent-encoded (observed, undocumented). The redirect doesn't rest on
 * that: rebuilding the Location, it drops any pair whose key or value
 * carries a character that would corrupt the reassembly — a decoded "&"
 * or "#" loses its pair instead of forging a param break or fragment.
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
    var prefix = null;
    var encodedPrefix = null;
    var declared =
        headers['x-forwarded-prefix'] && headers['x-forwarded-prefix'].value;
    if (declared) {
        // Stripping every trailing slash also disqualifies '/' and '//':
        // both reduce to '' and fail the leading-slash test below.
        declared = declared.replace(/\/+$/, '');
        if (
            declared.charAt(0) === '/' &&
            declared.indexOf('//') === -1 &&
            declared.indexOf(':') === -1 &&
            declared.indexOf('\\') === -1 &&
            ('/' + declared + '/').indexOf('/../') === -1
        ) {
            // request.uri arrives percent-encoded; the header value does
            // not, so a percent-encoded match candidate is derived here.
            // A lone surrogate in the header makes encodeURI() throw —
            // treat that as an absent/malformed header rather than
            // crashing the function.
            try {
                encodedPrefix = encodeURI(declared);
                prefix = declared;
            } catch (e) {
                prefix = null;
                encodedPrefix = null;
            }
        }
    }
    if (prefix !== null) {
        var uri = request.uri;
        if (uri === prefix || uri === encodedPrefix) {
            var qs = request.querystring || {};
            // Keys and values go into the Location raw, which reassembles
            // correctly only for characters percent-encoding would have
            // covered; anything else ('&', '#', an '=' in a key, a space,
            // a control character) is dropped with its pair instead. The
            // test is an unanchored search for a disallowed character, so
            // it never leans on how '$' treats a trailing newline.
            var UNSAFE_KEY = /[^A-Za-z0-9%\-_.~!$'()*+,;:@\/?]/;
            var UNSAFE_VALUE = /[^A-Za-z0-9%\-_.~!$'()*+,;=:@\/?]/;
            var parts = [];
            for (var key in qs) {
                if (UNSAFE_KEY.test(key)) continue;
                var param = qs[key];
                var values =
                    param.multiValue && param.multiValue.length > 0
                        ? param.multiValue
                        : [param];
                for (var i = 0; i < values.length; i++) {
                    var val = values[i].value;
                    if (UNSAFE_VALUE.test(val)) continue;
                    parts.push(val === '' ? key : key + '=' + val);
                }
            }
            var location = uri + '/';
            if (parts.length > 0) {
                location = location + '?' + parts.join('&');
            }
            return {
                // 302, not 301: this Location embeds the visitor's query
                // string, so the mapping is request-dependent and nothing
                // about it is permanent. Browsers cache a 301 persistently
                // even with no Cache-Control at all.
                statusCode: 302,
                statusDescription: 'Found',
                headers: {
                    location: { value: location },
                    // no-store: this Location carries one visitor's query
                    // string; a fronting edge cache must never replay it.
                    'cache-control': { value: 'no-store' }
                }
            };
        }
        var matched = null;
        if (uri.indexOf(prefix + '/') === 0) matched = prefix;
        else if (uri.indexOf(encodedPrefix + '/') === 0) matched = encodedPrefix;
        if (matched !== null) {
            var stripped = uri.slice(matched.length);
            request.uri = stripped === '/' ? '/index.html' : stripped;
        }
    }
    return request;
}
