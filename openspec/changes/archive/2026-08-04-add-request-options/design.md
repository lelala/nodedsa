## Context

`connection.send` currently accepts one mutable request object. It fills in
defaults and attaches internal Promise handlers to that object before queueing
it. `SendRequest` then calls the runtime-global `fetch` with hard-coded
`method`, `Content-Type`, and XML `body`; there is no supported transport-option
input.

A narrow transport inventory of `app.js` found three HTTP call sites, all using
the runtime-global Fetch API:

- DSNS lookup (`fetch(dsnsEndpoint, ...)`)
- DSA login (`fetch(accessPoint, ...)`)
- DSA service call (`fetch(accessPoint, ...)`)

There is no Axios, Node `http`/`https`, `node-fetch`, XMLHttpRequest, or other
HTTP transport dependency. The `XMLHttpRequest` labels in callback/error
objects are legacy property names whose values are Fetch `Response` objects or
errors; they do not indicate a second transport.

This change applies request options only to DSA service calls made by `send`.
It does not alter DSNS lookup or login transport behavior.

## Goals / Non-Goals

**Goals:**

- Add the backward-compatible `send(request, options?)` API.
- Accept the Fetch `RequestInit` model and every standard `HeadersInit` shape
  available in the runtime.
- Put caller headers on the actual service-call Fetch request.
- Preserve DSA ownership of method and XML body.
- Avoid mutating any caller-owned request, options, or headers value.
- Preserve callback, Promise, queueing, login-error, DSA-error, and
  network-error contracts.

**Non-Goals:**

- Applying options to DSNS lookup or `DS.Base.Connect` login calls.
- Supporting transport options inside the first `request` argument.
- Changing DSA XML serialization, authentication, retry behavior, or response
  parsing.
- Modifying `1campus.imdb.service` or publishing either package.

## Decisions

### 1. Use a second Fetch-shaped options argument

The public shape is `send(request, options?)`. `options` follows the runtime's
`RequestInit` contract; `options.headers` accepts `Headers`, an iterable/array
of `[name, value]` pairs, or a record of string values.

This separates DSA request semantics (`service`, `body`, callbacks) from HTTP
transport concerns. It also provides a familiar extension point for `signal`,
`redirect`, and other Fetch options.

Alternative considered: `request.headers`. This matches the direction noted in
the downstream IMDB design, but mixes protocol and transport concerns and is
not the selected Fetch-style API.

### 2. Merge options with protocol fields protected

Implementation will create a library-owned Fetch options object in this order:

1. Shallow-copy enumerable caller options other than `headers`.
2. Force `method: 'POST'`.
3. Generate `body` from the DSA request and active security token.
4. Build a new `Headers` value starting with
   `Content-Type: application/xml`, then apply caller headers.

Header matching is case-insensitive, as defined by `Headers`. A caller header
with the same name replaces the default; unrelated headers are retained.
Caller-supplied `method` and `body` are deliberately ignored so transport
options cannot corrupt the DSA envelope. Other runtime-supported RequestInit
properties are forwarded to the service-call Fetch invocation.

The first request argument remains authoritative for `service`, DSA `body`,
`result`, and existing request-level fields. A `headers`, `method`, or transport
property placed on that first object has no transport precedence and remains
ignored unless it already has separate legacy semantics.

### 3. Queue a library-owned request record

`send` will shallow-copy the first request into an internal record before
applying defaults or attaching Promise resolve/reject handlers. It will also
shallow-copy the options object and normalize headers into a new `Headers`
instance owned by the library. Normalization occurs inside a guarded path after
the return Promise is created, so invalid HeadersInit input is reported through
that Promise rather than escaping as an unrelated synchronous exception.
Queueing and completion mutate only these internal values.

The request body itself is not deep-cloned; this preserves current object-body
serialization semantics. `AbortSignal` and other Fetch platform objects remain
referenced rather than cloned because their identity and live state are part of
their contract.

### 4. Keep error classification stable

Header normalization and Fetch invocation will use a shared service-call error
delivery path. A native Fetch or header-validation exception is converted to
the existing structured `networkError`, delivered to `OnError` handlers and the
result callback, and used to reject the returned Promise.
Non-zero DSA statuses continue to produce `dsaError`; login failures continue
to produce `loginError`.

No new retry behavior is introduced. Existing login retry logic and the unused
`autoRetry` request default remain unchanged.

## Risks / Trade-offs

- **Caller overrides `Content-Type` with a value the DSA endpoint cannot
  process** → Document that caller headers win; tests prove deterministic
  behavior, while resulting HTTP/DSA failures use existing error paths.
- **Forwarded RequestInit fields behave differently across Node versions** →
  Declare support relative to the active runtime Fetch implementation and test
  representative standard fields rather than inventing a parallel schema.
- **Shallow copies do not isolate nested request-body mutation by callers** →
  Preserve existing behavior and avoid expensive or lossy deep cloning.
- **Downstream assumes `request.headers` is supported** → Document the exact
  second-argument migration and do not silently support both shapes.

## Migration Plan

1. Implement and test `send(request, options?)` in `nodedsa`.
2. Update its README and release notes, then publish through a separately
   approved release process.
3. After that version is available, update `1campus.imdb.service` from its
   current one-object call to
   `conn.send(request, { headers: traceHeaders })` and upgrade its dependency.
4. Verify outgoing `traceparent` and `X-Cloud-Trace-Context` headers in that
   downstream project.

Steps 3 and 4 are downstream work and are not implemented by this change.
Rollback consists of keeping downstream callers on `send(request)` and, if
necessary, reverting the unpublished nodedsa implementation before release.

## Open Questions

None. The public argument shape and precedence rules are decided by the user.
