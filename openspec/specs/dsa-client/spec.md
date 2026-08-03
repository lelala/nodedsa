# DSA Client Specification

## Purpose

Define the observable connection, authentication, request, and error behavior
of the public DSA client.

## Requirements

### Requirement: Open a DSA connection

The library SHALL expose `open(accessPoint, token)` and reject an empty access
point.

#### Scenario: A full URL is provided

- **WHEN** the caller opens an `http` or `https` access point
- **THEN** the client attempts a `DS.Base.Connect` login at that URL

#### Scenario: A DSNS-relative access point is provided

- **WHEN** the access point does not contain a URL scheme
- **THEN** the client resolves its DSNS name before attempting login

### Requirement: Normalize authentication tokens

The client SHALL accept either a string access token or an object security
token.

#### Scenario: A string token is provided

- **WHEN** `open` or `reConnect` receives a string token
- **THEN** it is sent as a `PassportAccessToken` security token

#### Scenario: An object token is provided

- **WHEN** `open` or `reConnect` receives an object token
- **THEN** that security token object is sent without changing its shape

### Requirement: Queue requests until login completes

The client SHALL queue calls to `send(request)` while login is in progress and
dispatch them after a successful login.

#### Scenario: A service call succeeds

- **WHEN** a queued or immediate service call receives DSA status code `0`
- **THEN** its Promise resolves with the response body and its result callback
  receives that body

#### Scenario: A DSA service call fails

- **WHEN** a service call receives a non-zero DSA status
- **THEN** its Promise rejects and registered error handlers receive a
  structured `dsaError`

#### Scenario: A service call has a network failure

- **WHEN** the HTTP request or response processing throws an error
- **THEN** its Promise rejects and registered error handlers receive a
  structured `networkError`

### Requirement: Expose connection lifecycle hooks

The client SHALL expose `ready`, `OnLoginError`, `OnError`, `reConnect`,
`getUserInfo`, and `getAccessPoint`.

#### Scenario: A caller waits for readiness

- **WHEN** login completes successfully
- **THEN** registered ready callbacks run and the Promise returned by `ready()`
  resolves

#### Scenario: A caller reconnects with a new token

- **WHEN** `reConnect(token)` completes a new login successfully
- **THEN** its Promise resolves and the connection uses the new session
