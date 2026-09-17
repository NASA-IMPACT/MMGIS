/**
 * The per-dashboard path-prefix handler, with a password gate in front of
 * it that runs only where the environment asks for one. This file IS what
 * gets deployed, and what stands here is the gated shape: real ES5 that
 * parses on its own, with REQUIRE_AUTH already true and only the credential
 * left as a placeholder inside its string. renderAuthFunctionCode() in
 * scripts/lib/cfn-template.js reads it at publish time, strips this header
 * comment, flips REQUIRE_AUTH to false for an ungated environment, and
 * substitutes <BASE64_BASIC_CREDENTIALS> with base64("mmgis:" +
 * MMGIS_DASHBOARDS_PASSWORD) when gated, an empty string when not. The
 * password lives in the function body and never in a CloudFormation
 * Parameter, because parameters show up in DescribeStacks — which the
 * admin's Deployments list reads on every load.
 *
 * The password gate is per-environment: REQUIRE_AUTH carries that
 * environment's answer (Terraform's dashboards_require_auth, reaching the
 * publish task as MMGIS_DASHBOARDS_REQUIRE_AUTH), and the gate runs only
 * when it is true. The whole handler ships either way — same Function, same
 * viewer-request association, in every dashboard stack — so an ungated
 * dashboard carries the 401 branch as unreachable code and no credential
 * for it to match against.
 *
 * What the handler does, in order:
 *   1. password gate — wrong or missing Authorization → 401, or a bare 403
 *      for a framework prefetch; nothing else runs. Skipped entirely when
 *      REQUIRE_AUTH is false
 *   2. read and validate X-Forwarded-Prefix (see trust model below);
 *      a missing or malformed header means: change nothing
 *   3. bare-prefix entry URL → 302 to the trailing-slash form, query
 *      string carried along (unsafe characters escaped, see below)
 *   4. prefixed request → strip the prefix so the S3 lookup is prefix-blind
 *
 * Trust model: the header is unauthenticated input. Anyone who can reach
 * this distribution can send it straight here, bypassing any fronting
 * CloudFront — so validating it is load-bearing, not hygiene.
 *
 * Stay ES5: the cloudfront-js-1.0 runtime has no let/const (use var), and
 * unit tests parse both this file and the rendered body with espree at ES5
 * to keep it that way.
 *
 * Encoding: CloudFront hands querystring values over still percent-encoded.
 * That is undocumented in prose, but AWS's own normalize-query-string-parameters
 * example rebuilds a query string by raw concatenation of .value — correct
 * only for wire-form values — and the restrictions doc's encoding section
 * agrees. The redirect doesn't rest on it for delimiter safety: rebuilding
 * the Location, it escapes any character that would corrupt the reassembly,
 * so a decoded "&" or "#" becomes %26 or %23 rather than forging a param
 * break or fragment. It does still rest on it for percent-ambiguity: "%" is
 * left alone so encoded values survive byte-identical, which means a value
 * delivered decoded and carrying a literal "%" reassembles ambiguously.
 */
function handler(event) {
    var request = event.request;
    var headers = request.headers;
    var REQUIRE_AUTH = true;
    var EXPECTED = 'Basic <BASE64_BASIC_CREDENTIALS>';
    var auth =
        headers.authorization && headers.authorization.value;
    if (REQUIRE_AUTH && auth !== EXPECTED) {
        // A prefetch — a request carrying Next-Router-Prefetch, RSC,
        // Sec-Purpose or Purpose (CloudFront lowercases header names before
        // the function sees them) — gets a bare 403, so no browser login
        // dialog appears on the page that issued it. The framework then
        // falls back to a full navigation, which is challenged normally.
        // The refusal carries no-store, so a fronting edge never caches
        // it and replays it to a later real visit.
        if (
            headers['next-router-prefetch'] ||
            headers['rsc'] ||
            headers['sec-purpose'] ||
            headers['purpose']
        ) {
            return {
                statusCode: 403,
                statusDescription: 'Forbidden',
                headers: {
                    'cache-control': { value: 'no-store' }
                }
            };
        }
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
            // a control character) is escaped into its %XX form here, so
            // the pair survives instead of being dropped. '%' is inside
            // the safe set, so an already-encoded value passes through
            // byte-identical rather than double-encoding. The match is an
            // unanchored run of disallowed characters — a run, so a
            // surrogate pair encodes as the one character it is — which
            // means it never leans on how '$' treats a trailing newline.
            // A lone surrogate cannot be encoded at all and makes
            // encodeURIComponent throw; that pair alone is dropped.
            var UNSAFE_KEY_G = /[^A-Za-z0-9%\-_.~!$'()*+,;:@\/?]+/g;
            var UNSAFE_VALUE_G = /[^A-Za-z0-9%\-_.~!$'()*+,;=:@\/?]+/g;
            var escapeRun = function (run) {
                return encodeURIComponent(run);
            };
            var parts = [];
            for (var key in qs) {
                var safeKey;
                try {
                    safeKey = key.replace(UNSAFE_KEY_G, escapeRun);
                } catch (keyErr) {
                    continue;
                }
                var param = qs[key];
                var values =
                    param.multiValue && param.multiValue.length > 0
                        ? param.multiValue
                        : [param];
                for (var i = 0; i < values.length; i++) {
                    var safeVal;
                    try {
                        safeVal = values[i].value.replace(
                            UNSAFE_VALUE_G,
                            escapeRun
                        );
                    } catch (valErr) {
                        continue;
                    }
                    parts.push(
                        safeVal === '' ? safeKey : safeKey + '=' + safeVal
                    );
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
