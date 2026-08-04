## 1. Test Harness

- [x] 1.1 Add a Node.js test command and mocked-global-fetch test harness that
  exercises the CommonJS public API without real network calls.
- [x] 1.2 Capture regression tests for existing `send(request)` Promise,
  callback, login queue, DSA-error, and network-error behavior.

## 2. Request Options Implementation

- [x] 2.1 Extend `send` to accept an optional second RequestInit-compatible
  options argument while preserving the one-argument call path.
- [x] 2.2 Build a library-owned internal request record so default fields,
  queue state, and Promise handlers do not mutate the caller's request object.
- [x] 2.3 Shallow-copy caller options, normalize every supported HeadersInit
  shape into library-owned headers, and merge defaults case-insensitively with
  caller headers taking precedence.
- [x] 2.4 Forward supported Fetch options to the service-call fetch while
  forcing the DSA-generated POST method and XML body.
- [x] 2.5 Route invalid header/options and Fetch failures through the existing
  structured network-error callback, OnError, and Promise rejection contracts.

## 3. Behavioral Verification

- [x] 3.1 Test omitted options, record headers, Headers instances, header-pair
  sequences, case-insensitive default override, and multiple trace headers.
- [x] 3.2 Test that caller method/body values cannot replace the DSA POST and
  XML envelope, while representative supported options such as `signal` and
  `redirect` reach fetch.
- [x] 3.3 Test that success and every error path leave the request, options, and
  header inputs unchanged, including requests queued during login.
- [x] 3.4 Test invalid HeadersInit input, native Fetch rejection, and non-zero
  DSA responses for the specified error classifications and notifications.

## 4. Documentation and Handoff

- [x] 4.1 Document `send(request, options?)`, supported header shapes,
  precedence, protected protocol fields, immutability, and a trace-header
  example in README and release notes.
- [x] 4.2 Run the automated test suite and `npm run spec:validate` before the
  change is considered implementation-complete.
- [x] 4.3 Record the downstream handoff: after a separately approved nodedsa
  release, `1campus.imdb.service` must upgrade and pass trace headers as
  `conn.send(request, { headers: traceHeaders })`; do not modify or publish that
  downstream project as part of this change.
