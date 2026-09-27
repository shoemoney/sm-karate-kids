# Security Policy 🔒

## Supported versions

This project is pre-1.0 and moving fast. Only the `main`/`master` branch (the latest commit) is
supported for security fixes — there are no maintained release branches yet.

| Version | Supported |
|---|---|
| `main` / `master` (latest) | ✅ |
| Anything else | ❌ |

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, email **jeremy@shoemoney.com** with:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, or a proof of concept if you have one.
- The commit SHA or version you tested against.

You should get an acknowledgment within a few days. This is a small open-source project without a
formal SLA or bug bounty program, but real reports get real attention and credit (if you want it)
once a fix ships.

## Scope

In scope:

- The game client (`apps/game`) and simulation (`packages/sim`, `packages/content`).
- CI/CD workflows under `.github/workflows/`.
- Anything that could leak a credential into a build artifact, log, or the public repository.

Out of scope:

- Third-party services this project depends on (report those upstream).
- Denial-of-service via basic browser resource exhaustion (this is a client-side game with no
  privileged backend in the current architecture).

## Handling of credentials

Per `CLAUDE.md`'s architecture rules: no AI provider or keystore credential may ever be present in
the browser bundle, logs, fixtures, screenshots, or committed source. CI runs a secret scan on
every push and pull request. If you find one anyway, that's exactly the kind of report this policy
wants — please report it privately first so it can be rotated before disclosure.
