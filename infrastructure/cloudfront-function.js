/**
 * Source of the per-dashboard password-gate CloudFront Function
 * (viewer-request, cloudfront-js-1.0 runtime). This file IS what gets
 * deployed — renderAuthFunctionCode() in scripts/lib/cfn-template.js reads
 * it at publish time, strips this header comment, and substitutes
 * <BASE64_BASIC_CREDENTIALS> with base64("mmgis:" + MMGIS_DASHBOARDS_PASSWORD)
 * before inlining the result into each mmgis-dashboard-* CloudFormation
 * stack. The password is baked into the Function body, never a
 * CloudFormation Parameter (parameters surface in DescribeStacks output,
 * which the Deployments list reads).
 *
 * The function body below is kept ES5. The cloudfront-js-1.0 runtime is
 * ES5.1-based and has no let/const (use var), and a unit test parses this
 * body with espree at ES5 to keep it that way.
 *
 * Trust model: the X-Forwarded-Prefix header honored below is not
 * authenticated on its own — anyone holding the shared password can send it
 * directly to this distribution, bypassing any fronting CloudFront
 * entirely. Validating it is load-bearing, not just hygiene.
 *
 * CloudFront appears to hand querystring values to the function still
 * percent-encoded (observed behavior; not documented by AWS either way),
 * but the redirect below does not rest on that: when it rebuilds the
 * Location it drops any pair whose key or value carries a character that
 * would corrupt the reassembly. A value that arrived decoded with a "&"
 * or "#" in it is left out rather than emitting a spurious param break or
 * fragment.
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
