## ADDED Requirements

### Requirement: Distinguish XML attribute values from element character data

When validating PKI XML responses, the client SHALL accept a literal `]]>` in an otherwise valid attribute value, while rejecting an unescaped `]]>` in ordinary element character data. Escaped element text SHALL continue to decode normally. Existing character, entity, duplicate-attribute and structural validation SHALL remain enforced.

#### Scenario: A PKI response contains the sequence in an attribute

- **WHEN** a successful encrypted DSA response contains `label="]]>"` or the equivalent single-quoted attribute
- **THEN** the Promise resolves and the result callback receives the normal parsed body without OnError notification

#### Scenario: An element contains the unescaped sequence

- **WHEN** an encrypted response contains an unescaped `]]>` in ordinary element text, including an element named `attribute`
- **THEN** the Promise rejects with `networkError.type` equal to `pki_error`, and result and OnError receive that same failure

#### Scenario: Element text uses an entity

- **WHEN** an encrypted response represents the text using `]]&gt;`
- **THEN** the parsed body contains the original `]]>` text

#### Scenario: Other invalid attribute syntax remains invalid

- **WHEN** an encrypted response attribute contains an invalid entity, an illegal XML character or a duplicate attribute name
- **THEN** the client rejects the response through its existing PKI error contract
