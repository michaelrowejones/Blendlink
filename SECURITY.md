# Security policy

## Supported versions

Blendlink has not published an npm package or approved Blender Extension yet.
Until the first public release, security fixes are made on the current `main`
development line only.

| Release line | Security status |
| --- | --- |
| Unreleased `main` | Receiving fixes |
| Public npm releases | None yet |
| Public Blender Extension releases | None yet |

This table will be updated before each release. A version not listed as
supported should be upgraded before a security report is evaluated against it.

## Reporting a vulnerability

Please do not open a public issue containing vulnerability details.

1. If the repository's Security page offers **Report a vulnerability**, use
   that private GitHub channel.
2. Otherwise, email `michaelrowejones@gmail.com` with the subject
   `Blendlink security report`.

Include the affected Blendlink, Node, Blender, Three.js, and browser versions;
the operating system; reproduction steps; impact; and any suggested mitigation.
Remove private scene content, credentials, and personal data from the report.

The maintainer aims to acknowledge a report within five business days. That is
a response goal, not a guaranteed remediation deadline. Please allow time for
triage and a coordinated fix before public disclosure.

## Scope

Security-sensitive surfaces include the Node CLI and its subprocess execution,
the Blender Extension, manifest and generated-code readers, published runtime
assets and decoders, application integration helpers, and the release archives.
Ordinary rendering defects, unsupported-version behavior, and performance
reports without a security impact belong in the public issue tracker.
