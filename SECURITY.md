# Security policy

## Supported versions

Only the latest tagged preview release receives security fixes. Before the first stable release, compatibility and stored-data migrations may change between minor versions and will be documented in the changelog.

## Report a vulnerability privately

Do not open a public issue for a credential leak, token bypass, unsafe path operation, command injection, unintended file overwrite, redaction bypass containing real secrets, or exploit against the local service.

Use the repository's private [security advisory form](https://github.com/rrrrrredy/runtime-evolution-workbench/security/advisories/new). Include the affected commit/version, Windows and Codex versions, impact, minimal reproduction with synthetic data, and whether local Run data may have been exposed. Remove real credentials and private repository content.

Reports are handled on a best-effort basis; no response-time SLA is promised during the technical preview. A fix will preserve evidence of the security boundary without publishing exploit details before users can update.

## Threat-model limits

The 0.1 product protects against network exposure, unauthenticated browser/API access, common secret patterns, accidental Agent publication, stale-file overwrite, and unsafe experiment-path construction. It does not claim to defend against malware or another process already running as the same Windows user, an untrusted verifier intentionally executed by the user, or every possible secret format.
