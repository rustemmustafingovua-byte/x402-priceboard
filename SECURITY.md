# Security policy

## Reporting a vulnerability

Use **Security → Report a vulnerability** on GitHub. Please do not open a public
issue for a suspected flaw in the security-relevant code.

## What this tool handles

This tool reads local files or calls public APIs. It does not execute the content it reads.

- no credentials are written to disk by the tool
- keys come from the environment and are forwarded to the service that needs them
- output from fetched pages is untrusted data, never instructions

## Supported versions

| Version | Supported |
|---|---|
| 0.1.x | ✅ |
