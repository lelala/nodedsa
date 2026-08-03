# Changelog

## 2.1.0 - 2026-08-03

- Add optional Fetch-compatible request options to `connection.send`.
- Support custom outbound headers, including distributed trace headers.
- Preserve DSA-controlled HTTP method and XML body while forwarding other
  supported Fetch options.
- Stop mutating caller-owned request, options, and headers values.
- Add automated regression and request-options tests.
