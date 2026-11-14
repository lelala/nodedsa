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

### Requirement: 回應錯誤附有 HTTP 診斷

PKI 交換在讀完 HTTP 本文後拋出的錯誤、解析 PKI 信封時的 `xml_error` 與共用 `http_error` SHALL 附有四欄。數值 `httpStatus` 取自 HTTP 狀態，`contentType` 取自 Content-Type 標頭且缺少時為 `undefined`，數值 `bodyLength` 是完整 HTTP 回應文字的 UTF-8 位元組數，字串 `responseSample` 預設是原始 HTTP 回應文字的前 4096 個 Unicode 碼點。若已知的請求憑證、SecretKey、CryptoToken、X-Api-Key 或請求本文以原文或 XML 跳脫形式回顯，且與樣本範圍重疊，`responseSample` MUST 為空字串並保留其餘三欄。請求資料 MUST NOT 附加至錯誤物件。既有分類、訊息、成功結果與重試行為 SHALL 維持。

#### Scenario: 回應回顯請求資料

- **WHEN** 回應本文在前 4096 個 Unicode 碼點內開始回顯已知的請求憑證、加密請求欄位或請求本文
- **THEN** 即使回顯跨過樣本界線，`responseSample` SHALL 為空字串，HTTP 狀態、Content-Type 與完整長度 SHALL 照常回報

#### Scenario: HTTP 200 攔截頁

- **WHEN** PKI 交換收到 HTTP 200 的 text/html 攔截頁
- **THEN** SHALL 以原有 `pki_error` 回報，並在 Promise 及 callback 的服務 `networkError` 上帶有 HTTP 200、標頭、完整長度與本文前綴

#### Scenario: 非法 XML 或 Cipher 無法解密

- **WHEN** PKI 外層 XML 無效、Cipher 解密失敗，或解密後信封解析出現 `xml_error`
- **THEN** 解析處 SHALL 附加回應診斷，交換對外 SHALL 維持 `pki_error` 及原訊息，診斷 SHALL 使用解密前的 HTTP 本文

#### Scenario: 非 2xx 且無有效 DSA 錯誤

- **WHEN** 回應依既有規則判為 `http_error`
- **THEN** SHALL 保留原訊息並附四欄，本文為空時長度為零且樣本為空字串

#### Scenario: HTTP 5xx 的有效 DSA 錯誤

- **WHEN** PKI 交換收到 HTTP 5xx 且信封有效、DSA status 非零
- **THEN** SHALL 維持既有 DSA 分類與訊息，服務的 Promise 及 callback 在 `dsaError` 收到四欄，登入錯誤在 `loginError` 收到四欄

#### Scenario: 連線失敗或本文未讀完

- **WHEN** 請求沒有取得完整回應本文
- **THEN** SHALL 維持既有錯誤及重試語意，不新增診斷欄位
