# DSNS Resolution Specification

## Purpose

Define how callers resolve an iSchool DSNS name to a DSA doorway URL.

## Requirements

### Requirement: Resolve a DSNS name

The library SHALL expose `dsnsLookup(name, callback)` and query the configured
DSNS endpoints until a successful doorway URL is returned or all endpoints
have failed.

#### Scenario: A DSNS endpoint returns a doorway URL

- **WHEN** a DSNS endpoint returns a successful response containing a secured
  or plain doorway URL
- **THEN** the callback receives the resolved URL

#### Scenario: All DSNS endpoints fail

- **WHEN** every configured DSNS endpoint fails or returns no doorway URL
- **THEN** the callback receives the original DSNS name as the fallback result

### Requirement: Reuse recent resolution results

The library SHALL cache successful DSNS resolutions for five minutes.

#### Scenario: The same name is resolved within the cache lifetime

- **WHEN** a previously resolved DSNS name is requested again within five
  minutes
- **THEN** the cached URL is returned without another network lookup

#### Scenario: A cached result has expired

- **WHEN** a DSNS name is requested after its cached result has expired
- **THEN** the library performs a new DSNS lookup

### Requirement: Support late completion handlers

The lookup result SHALL expose `complite(fn)` for compatibility with existing
consumers.

#### Scenario: A completion handler is added after resolution

- **WHEN** `complite(fn)` is called after the lookup has completed
- **THEN** the handler is invoked with the resolved or fallback value
