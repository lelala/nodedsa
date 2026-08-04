## ADDED Requirements

### Requirement: Accept optional Fetch-compatible request options

The client SHALL accept service calls as `send(request, options?)`, where
`options` is a Fetch-compatible `RequestInit` object and `options.headers` is a
Fetch-compatible `HeadersInit`: a `Headers` instance, a sequence of header-name
and header-value pairs, or a record of header names to string values.

The client SHALL continue to accept `send(request)` with no behavior change.
Transport controls belong to the second argument; properties such as `headers`
on the first request object SHALL NOT override transport options.

#### Scenario: Existing call omits options

- **WHEN** a caller invokes `send(request)` without a second argument
- **THEN** the client sends the same DSA request and preserves the existing
  callback, Promise, queueing, and error behavior

#### Scenario: Caller supplies record headers

- **WHEN** a caller invokes `send(request, { headers: { traceparent: value } })`
- **THEN** the actual outbound service-call HTTP request contains the supplied
  `traceparent` header

#### Scenario: Caller supplies another HeadersInit form

- **WHEN** a caller supplies headers as a `Headers` instance or a sequence of
  name-value pairs
- **THEN** the actual outbound service-call HTTP request contains the
  normalized supplied headers

### Requirement: Merge service-call fetch options deterministically

The client SHALL merge service-call fetch configuration without changing DSA
protocol ownership of the HTTP method and serialized XML body. It SHALL apply
library defaults first, then apply caller headers case-insensitively so caller
headers replace same-name defaults. The client SHALL forward other supported
Fetch `RequestInit` properties, but SHALL ignore caller-provided `method` and
`body` values and use the DSA-generated `POST` method and XML body.

#### Scenario: Caller adds headers alongside the default content type

- **WHEN** caller headers do not contain `Content-Type`
- **THEN** the outbound request contains both `Content-Type: application/xml`
  and all caller headers

#### Scenario: Caller overrides a default header

- **WHEN** caller headers contain a name matching a library default regardless
  of casing
- **THEN** the caller's value is used once for that header name

#### Scenario: Caller supplies method or body options

- **WHEN** `options` contains `method` or `body`
- **THEN** the outbound request still uses `POST` and the XML envelope generated
  from `request.service`, `request.body`, and the active security token

#### Scenario: Caller supplies another supported fetch option

- **WHEN** `options` contains a runtime-supported RequestInit property such as
  `signal` or `redirect`
- **THEN** that property is forwarded to the service-call fetch invocation

### Requirement: Preserve caller-owned inputs

The client SHALL NOT add, delete, or replace properties on the caller's
`request`, `options`, or headers input. Internal request state and normalized
headers SHALL be stored in library-owned values.

#### Scenario: Service call completes

- **WHEN** a call with request options resolves or rejects
- **THEN** the caller's request object, options object, and headers input remain
  structurally unchanged by the client

#### Scenario: Service call waits in the login queue

- **WHEN** a call is queued while login is in progress
- **THEN** queue bookkeeping and Promise handlers are attached only to an
  internal request record and not to either caller-owned object

### Requirement: Report request-option failures through existing errors

The client SHALL preserve the existing callback, Promise, and `OnError`
contracts when Fetch rejects an option or header value. Such failures SHALL be
reported as structured `networkError` values and SHALL NOT be reclassified as
login or DSA service errors.

#### Scenario: Runtime rejects request options

- **WHEN** header normalization or the service-call fetch rejects an invalid or
  unsupported option
- **THEN** the result callback receives the structured `networkError`, the
  returned Promise rejects with it, and registered `OnError` handlers run

#### Scenario: DSA response is unsuccessful when options are present

- **WHEN** a request using options receives a non-zero DSA status
- **THEN** existing `dsaError` callback, Promise rejection, and `OnError`
  behavior is preserved
