# Proposal: Add User Provisioning

## Intent

The platform has no sign-up flow. Users must be created by an operator (admin) and notified of their credentials by email. Today there is no tooling to do this: `src/features/auth/index.ts` is an empty stub and the justfile has no provisioning recipes. This blocks any end-to-end testing and onboarding of real users.

## Scope

### In Scope

- `src/features/auth/password.ts` — cryptographically strong password generator (Web Crypto, unambiguous charset, rejection sampling, all-class guarantee)
- `src/features/auth/user-provisioning.ts` — idempotent `provisionUser` service (create-or-reset) with injected deps (`admin` client, `sendEmail`)
- `src/features/auth/templates.ts` — `credentialEmail` template (subject, html, text; Spanish; security warning)
- Colocated unit tests for all three modules (`*.test.ts`); 100% coverage
- `scripts/_env.ts` — shared `loadDevVars(envName?)` helper; refactor existing `scripts/send-test-email.ts` to reuse it
- `scripts/provision-user.ts` — CLI: `[EMAIL] [PASSWORD] [--env <name>]`; falls back to `BOOTSTRAP_ADMIN_*` vars
- `scripts/get-token.ts` — CLI: prints `access_token` for a user; falls back to bootstrap creds
- Justfile recipes: `create-first-user`, `create-user EMAIL PASSWORD=""`, `token EMAIL="" PASSWORD=""`
- `.dev.vars.example` and `.dev.vars.staging.example` — add `BOOTSTRAP_ADMIN_EMAIL=` and `BOOTSTRAP_ADMIN_PASSWORD=`
- `docs/auth.md` — auth model, provisioning flow, commands, security rationale, invite-link migration path

### Out of Scope

- UI for user management (deferred)
- Invite-link flow (`admin.generateLink` / `inviteUserByEmail`) — architecture is prepared but branch is NOT shipped (would be dead code and break coverage gate)
- Bulk CSV import (O(n) `listUsers` pagination is acceptable for admin tooling; throttling for bulk import is a separate change)
- Adding `BOOTSTRAP_ADMIN_*` to `src/types/env.ts` (Workers never read them; scripts-only vars)
- Any new HTTP route (provisioning is operators-only via CLI)

## Capabilities

### New Capabilities

- `user-provisioning`: Idempotent creation and reset of Supabase Auth users with credential delivery via email; includes password generation, email templating, and CLI tooling.

### Modified Capabilities

- None

## Approach

Reuse existing infrastructure without new external dependencies:

1. **Password generation** uses `crypto.getRandomValues` (available in Workers and Bun). No library needed.
2. **User management** uses `createSupabaseAdminClient(env)` already in `src/lib/supabase.ts`. Supabase JS v2 `admin.auth.admin.createUser` + `updateUserById` cover both the create and reset paths. `listUsers` is paginated to find users by email (the API has no filter-by-email on admin endpoints).
3. **Email delivery** reuses `sendEmail` from `src/lib/resend.ts` directly.
4. **Dependency injection** on `provisionUser` keeps the service testable without any mocking framework; deps are plain objects with the same shape as the real clients.
5. **Scripts** are thin CLI wrappers that wire real env vars to the service; they are explicitly excluded from the coverage gate.
6. **Security hybrid decision** (approved): ship password-by-email with high-entropy generation and `must_reset_password` metadata now. Document the exact migration path to invite-links for when a set-password page exists. No invite-link code ships today.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/features/auth/` | New | `password.ts`, `user-provisioning.ts`, `templates.ts` + 3 test files |
| `src/features/auth/index.ts` | Modified | Stub → re-exports provisioning service |
| `scripts/` | New | `_env.ts`, `provision-user.ts`, `get-token.ts` |
| `scripts/send-test-email.ts` | Modified | Refactored to use shared `_env.ts` |
| `justfile` | Modified | 3 new recipes |
| `.dev.vars.example` | Modified | 2 new bootstrap vars |
| `.dev.vars.staging.example` | Modified | 2 new bootstrap vars |
| `docs/auth.md` | New | Auth model + provisioning guide |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `listUsers` O(n) slow for large user sets | Low | Acceptable for admin tooling; document throttling note in `docs/auth.md` |
| Password exposed in logs/output | Med | Explicit rule: never print password; only `userId`/`created`/`emailId` in CLI output |
| Supabase admin API rate limits hit during reset loop | Low | Single-user operation per CLI call; no bulk loop |
| `email_confirm: true` skipped, user blocked | Low | Enforced in `createUser` call; covered by unit test |
| Invite-link branch accidentally shipped | Low | Branch stays in `docs/auth.md` only; no code path; coverage gate enforces it |

## Rollback Plan

All new files are additive. `src/features/auth/index.ts` is currently an empty stub — reverting means restoring it to empty. Justfile recipes can be deleted. No database schema changes, no migrations. Rollback = `git revert` on the commit range.

## Dependencies

- `@supabase/supabase-js` v2.108 (already installed)
- Resend integration (already installed and wired in `src/lib/resend.ts`)
- Supabase local stack (`just supabase-start`) for end-to-end verification

## Success Criteria

- [ ] `just create-first-user` creates the bootstrap user in Supabase Auth (email confirmed) and sends a credential email
- [ ] Re-running `just create-first-user` returns `created: false` (idempotent reset) and sends a new email
- [ ] `just create-user test@example.com` provisions a new user with a generated password delivered by email
- [ ] `just token` prints a valid JWT; decoded `sub` matches the bootstrap user's `userId`
- [ ] `bun test src tests --coverage` is green with 100% coverage on all new `src/features/auth/` files
- [ ] `just lint` (Biome + tsc) passes with no errors
- [ ] No password or JWT appears in any log or CLI output
