# Security Reference

This document lists the current security mechanisms and boundaries used by ZenNotes.

It is a technical reference, not deployment advice. For deployment guidance, see [Secure Self-Hosting](../how-to/secure-self-hosting.md).

## Security scope

ZenNotes currently aims at:

- single-user desktop use
- single-user self-hosted browser use
- desktop clients connecting to a trusted ZenNotes server

It does not currently claim to be a fully hardened public multi-user SaaS platform.

## Browser/server auth model

### Bootstrap secret

The long-lived server bootstrap secret is:

- `ZENNOTES_AUTH_TOKEN`

When present:

- protected server routes require either a valid bearer token or a valid server session

### Browser session login

The browser login flow uses:

- `POST /api/session/login`
- `POST /api/session/logout`
- `GET /api/session`

Behavior:

- token is sent in the request body
- successful login creates a random session token
- the server sets a cookie:
  - `HttpOnly`
  - `SameSite=Strict`
  - `Path=/api`
- cookie is marked `Secure` when the request is effectively HTTPS

### Session lifetime

Current session TTL:

- 30 days

### Browser auth storage

The browser should not depend on:

- URL token query params
- local storage copies of the server auth token

The current intended browser model is:

- bootstrap token once
- then session cookie

## Protected server routes

The server currently protects its vault/file operations behind auth middleware.

Examples include:

- vault selection
- directory browsing
- note CRUD
- folder CRUD
- assets
- watcher WebSocket

Public/meta routes include:

- `/api/healthz`
- `/api/version`
- `/api/capabilities`
- `/api/platform`
- `/api/session`
- `/api/session/login`
- `/api/session/logout`

## Rate limiting

Current lightweight rate limiting exists for:

- login attempts
- unauthorized WebSocket attempts

This is intentionally simple, but it is still better than treating repeated failures as free.

## CORS and origin policy

The server validates request origins.

Current model:

- same-origin is allowed
- explicitly configured origins from `ZENNOTES_ALLOWED_ORIGINS` are allowed
- localhost/loopback origins are allowed in dev-like loopback scenarios

This is stricter than the previous permissive `*` model.

## Content security headers

The server sends browser security headers directly in HTTP responses.

Current headers include:

- `Content-Security-Policy`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: no-referrer`
- `Permissions-Policy`

Important current CSP constraints:

- `default-src 'self'`
- `object-src 'none'`
- `base-uri 'none'`
- `form-action 'none'`
- `frame-ancestors 'none'`

Important current CSP tradeoff:

- `script-src` still includes `unsafe-eval`
- `style-src` still includes `unsafe-inline`

That is an acknowledged hardening gap, not an accidental omission.

## Filesystem scope and browse roots

The server treats browse roots as a real access-control boundary.

Relevant config:

- `ZENNOTES_BROWSE_ROOTS`
- `ZENNOTES_ALLOW_UNSCOPED_BROWSE`

Current behavior:

- requested browse/select paths are normalized
- symlinks are resolved
- the resolved path must stay within an allowed root unless unscoped browse is explicitly enabled

If no browse roots are configured, the server falls back to:

- current vault root
- default vault path
- configured vault path

depending on what exists

## Host config vs vault config

ZenNotes now separates host/server config from vault config.

Host/server operational config:

- lives in the host config file
- default path resolves from `ZENNOTES_CONFIG_PATH` or the user config location

Vault config:

- belongs under `.zennotes/` in the vault only for vault behavior

Important rule:

- server secrets should not be stored in the vault

Host config file writes currently use mode:

- `0600`

Legacy behavior:

- `.zennotes/server.json` inside the vault is treated as a legacy path and should not be used as the active secret store

## Desktop credential storage

Desktop remote workspace credentials are kept out of renderer-visible config.

Current storage order:

1. OS secret store through `keytar`, when available
2. Electron `safeStorage` fallback

Important behavior:

- the fallback path stores encrypted values, not plaintext
- the app warns when secure storage is unavailable or when fallback storage is being used

## Electron renderer hardening

Current desktop hardening includes:

- `contextIsolation: true`
- `nodeIntegration: false`
- IPC sender validation against trusted renderer URLs
- remote server traffic handled in the main process

Current limitation:

- `sandbox: false`

That is a deliberate temporary tradeoff because the current preload path still depends on APIs that are not yet refactored for a fully sandboxed preload.

## Remote workspace credential exposure

Current design goal:

- renderer should not receive raw remote secrets as normal profile data

The desktop app keeps remote API calls in the main process and stores credentials through the secret-store layer.

## Docker defaults

Current Docker defaults include:

- loopback-only published port
- non-root runtime user
- read-only root filesystem
- `/tmp` as `tmpfs`
- `no-new-privileges`
- `cap_drop: ALL`
- generated auth token unless explicitly disabled

This is the default baseline for self-hosted browser/server deployment.

## Security-related environment variables

Important current variables:

- `ZENNOTES_AUTH_TOKEN`
- `ZENNOTES_CONFIG_PATH`
- `ZENNOTES_BIND`
- `ZENNOTES_ALLOWED_ORIGINS`
- `ZENNOTES_BROWSE_ROOTS`
- `ZENNOTES_VAULT_PATH`
- `ZENNOTES_DEFAULT_VAULT_PATH`
- `ZENNOTES_ALLOW_UNSCOPED_BROWSE`
- `ZENNOTES_ALLOW_INSECURE_NOAUTH`

Docker/make wrappers also use:

- `CONTENT_ROOT`
- `PORT`
- `ALLOW_INSECURE_NOAUTH`

## Related docs

- [Secure Self-Hosting](../how-to/secure-self-hosting.md)
- [Security Model](../explanation/security-model.md)
