## Why

Downstream services need to propagate trace headers through DSA calls, but
`conn.send(request)` currently constructs its fetch options internally and
offers no supported way to add outbound HTTP headers. Adding an optional,
Fetch-compatible options argument enables tracing and future request-level
controls without breaking existing callers.

## What Changes

- Extend the public API to `send(request, options)`, where `options` is optional
  and follows the Fetch `RequestInit` shape supported by the current runtime.
- Initially support caller-provided Fetch-compatible `headers` and merge them
  into the actual outbound HTTP request.
- Preserve existing `send(request)` callback and Promise behavior.
- Define deterministic precedence for library defaults, legacy request fields,
  and the new options argument without mutating caller-owned values.
- Add automated coverage for header forms, precedence, immutability, success,
  DSA failure, and network failure behavior.
- Document the downstream migration required by `1campus.imdb.service` after a
  compatible `nodedsa` version is released.

No breaking API change is intended.

### Non-goals

- Modifying or publishing `1campus.imdb.service`.
- Publishing a new `nodedsa` package version as part of this change.
- Promising support for Fetch options that conflict with the DSA protocol,
  including overriding the HTTP method or serialized request body.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `dsa-client`: Extend service calls with optional Fetch-compatible request
  options, beginning with custom outbound headers.

## Impact

- Public API: `connection.send(request, options?)` in `app.js`.
- Runtime behavior: outbound service-call fetch options and header merging.
- Tests: new mocked-fetch tests for request options and existing behavior.
- Documentation: README usage example and downstream migration note.
- Downstream: `1campus.imdb.service` currently calls `conn.send` with one
  request object. After a supporting package version is published and adopted,
  it must pass its trace headers through the second argument, for example
  `conn.send(request, { headers: traceHeaders })`. That migration is outside
  this change.
