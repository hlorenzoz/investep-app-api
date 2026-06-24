# Auth Model & User Provisioning

> Change: `add-user-provisioning` | Status: implemented | Date: 2026-06-24

---

## 1. Auth Model

### Supabase Auth

Authentication is delegated entirely to Supabase Auth. The Worker runtime never handles raw passwords or generates JWTs directly.

Two client types are used, each with distinct privileges:

| Client | Key | Purpose |
|--------|-----|---------|
| Admin client (`createSupabaseAdminClient`) | `SUPABASE_SERVICE_ROLE_KEY` | Server-side provisioning, user management. Bypasses RLS. |
| Standard client (`createSupabaseClient`) | `SUPABASE_ANON_KEY` (publishable) | Client-initiated auth flows: `signInWithPassword`, session-based queries. |

The `service-role` key MUST NOT be used for `signInWithPassword` — that flow requires the publishable key. The admin client is never exposed to the browser or to CLI consumers of JWTs.

### The `must_reset_password` Flag

Every provisioned user gets `user_metadata.must_reset_password: true` set at creation (and reset). This flag signals to the frontend or any middleware that the user must change their credentials after the first login. The flag lifecycle:

1. **Set**: by `provisionUser` on `createUser` and `updateUserById`.
2. **Cleared**: by the frontend after the user completes the password-change flow (via `auth.updateUser`).
3. **Enforcement**: up to the frontend/middleware — the API does not block requests based on this flag, it only sets it.

---

## 2. Provisioning Flow

### Data Flow

```
Operator CLI invocation
  │
  ▼
scripts/provision-user.ts
  ├─ loadDevVars(envName)            → reads .dev.vars*
  ├─ createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  ├─ sendEmail bound to RESEND config
  └─ provisionUser(deps, { email, password? })
       ├─ generatePassword()             → src/features/auth/password.ts (if no password supplied)
       ├─ admin.auth.admin.createUser({email, password, email_confirm: true, user_metadata: {must_reset_password: true}})
       │    └─ on "already registered":
       │         ├─ findUserByEmail(admin, email)  [paginate listUsers, client-side match]
       │         └─ admin.auth.admin.updateUserById(id, {password, user_metadata: {must_reset_password: true}})
       ├─ credentialEmail({email, password}) → src/features/auth/templates.ts
       └─ sendEmail({to, subject, html, text})  → Resend API
  │
  └─ prints: { userId, created, emailId }   [never prints password]
```

### Idempotence Contract

`provisionUser` is idempotent: calling it twice with the same email does not fail. The second call resets the user's password and resends the credential email, returning `created: false`.

Implementation strategy (ADR-1):

1. **Optimistic path**: attempt `admin.auth.admin.createUser` first. Fast for new users, no extra API call.
2. **Detection**: if Supabase returns an error whose `.message` includes `"already registered"`, trigger the reset path.
3. **Locate**: call `findUserByEmail` — paginates `listUsers` in pages of 50, matches client-side by email address.
4. **Reset**: call `admin.auth.admin.updateUserById(id, { password, user_metadata: { must_reset_password: true } })`.

**Error detection is tied to Supabase JS SDK v2.108** (see §6, Gotchas). If the error string changes, the detection logic in `user-provisioning.ts` must be updated.

### `findUserByEmail` — Pagination

`listUsers` does not support filtering by email. `findUserByEmail` paginates all users (50 per page) and matches client-side. This is O(n) in the number of users — acceptable for admin tooling on a small user base. For future bulk import scenarios, throttle the provisioning loop to avoid hitting rate limits (see §5, Migration Path note).

---

## 3. CLI Commands

### `just create-first-user`

Provisions the bootstrap admin user using credentials from `.dev.vars` (or a selected env file).

```sh
just create-first-user
# Reads BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD from .dev.vars
# Prints: { "userId": "...", "created": true, "emailId": "..." }
```

Requires `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, and `RESEND_FROM` to be set in `.dev.vars`.

### `just create-user EMAIL PASSWORD=""`

Provisions or resets a specific user. `PASSWORD` is optional — when omitted, the server generates a 24-character password.

```sh
just create-user user@example.com          # generated password
just create-user user@example.com MyP@ss   # caller-supplied password
```

Prints: `{ "userId": "...", "created": true|false, "emailId": "..." }`. Never prints the password.

### `just token EMAIL="" PASSWORD=""`

Signs in with `signInWithPassword` and prints only the `access_token` JWT to stdout.

```sh
just token                                   # uses BOOTSTRAP_ADMIN_* from .dev.vars
just token user@example.com MyP@ss          # explicit credentials
```

The JWT is printed to stdout only. It is never logged via `console.error` or `console.warn`. Use output capture (`$(just token)`) for piping into other tools.

### Environment Selection via `--env`

All scripts accept `--env <name>` to select an alternate env file:

```sh
bun run scripts/provision-user.ts --env staging   # reads .dev.vars.staging
bun run scripts/get-token.ts --env production     # reads .dev.vars.production
```

The `loadDevVars` helper in `scripts/_env.ts` maps:
- `undefined` → `.dev.vars`
- `"staging"` → `.dev.vars.staging`
- `"production"` → `.dev.vars.production`

---

## 4. Security Model

### Current Approach: Password-by-Email (ADR-4)

The provisioning system delivers a high-entropy temporary password via Resend transactional email, over TLS. The user is expected to change it on first login.

**What the system does**:
- Generates a 24-character password using Web Crypto (`crypto.getRandomValues`), drawn from an unambiguous charset (no O, 0, I, l, 1).
- Sets `email_confirm: true` to skip the verification email step.
- Sets `user_metadata.must_reset_password: true` to flag mandatory rotation.
- Sends the credential email in Spanish with a bold security warning.

**Threat model and mitigations**:

| Threat | Mitigation |
|--------|-----------|
| Email interception | High-entropy (24+ chars, mixed classes, Web Crypto) reduces value of interception; TLS delivery; security warning in email instructs immediate change |
| Password reuse after compromise | `must_reset_password` flag enforces change on first login; once changed, the emailed password is invalid |
| Accidental log exposure | Explicit "never log password" rule enforced by unit test (`5.10`); no `console.*` call in `user-provisioning.ts` |
| Insider replay | Single-use credential: once the user changes their password, the emailed credential is invalid |
| Credential delivery to wrong address | Operator controls the email address at provisioning time; no self-service signup |

---

## 5. Migration Path to Invite-Links

The current password-by-email approach is intentionally temporary. The migration to invite-links (magic-link flow) should be done when a set-password page exists in the frontend. The steps:

1. **Replace** `admin.auth.admin.createUser({ email, password, ... })` with `admin.auth.admin.generateLink({ type: 'invite', email })` or `admin.auth.admin.inviteUserByEmail(email)`.
2. **Send** the returned `action_link` (the magic link URL) via Resend instead of the plaintext password.
3. **User flow**: the user clicks the link, lands on the set-password page, and sets their own password. No temporary credential is ever transmitted.
4. **Remove** `generatePassword` from the provisioning path (the function remains in `src/features/auth/password.ts` for the password reset sub-flow, but it is no longer called by `provisionUser`).

**Why not shipped now**: there is no set-password page in the frontend. Shipping invite-link code without the corresponding UI would create dead code branches that break the coverage gate.

**`listUsers` O(n) note for future bulk import**: if provisioning needs to scale to hundreds of users (e.g., bulk CSV import), the `findUserByEmail` pagination scan will become expensive. Throttle the provisioning loop to one user per 200–500 ms and consider implementing a cache or a dedicated lookup before this path is used for bulk operations.

---

## 6. Gotchas

### "already registered" error string is SDK-version-specific

The idempotence detection in `provisionUser` checks `createError.message.includes("already registered")`. This string is specific to Supabase JS SDK v2.108. If the SDK is upgraded and the error message changes, the detection will silently fall through to the "unexpected error" branch, breaking the idempotent reset path. Pin this behavior and add a regression test if the SDK is upgraded.

### Publishable key required for `signInWithPassword`

`get-token.ts` uses `SUPABASE_ANON_KEY` (the publishable key, with the `sb_publishable_` prefix in newer Supabase projects). The service-role key does NOT work for `signInWithPassword`. The admin client is for admin API operations only. Using the wrong key returns an auth error that is difficult to debug.

### Scripts are excluded from the coverage gate

`scripts/` files are NOT included in `bun test src tests`. The coverage gate applies only to `src/`. Script logic (arg parsing, env loading, stdout printing) is intentionally left untested — it is thin wiring that would require process-level mocking to test and provides low return on investment.

### BOOTSTRAP_ADMIN_* never belong in `src/types/env.ts`

`BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are operator-only secrets used exclusively by CLI scripts. They must NOT be added to the `Env` interface in `src/types/env.ts` because:
- They are not Cloudflare Worker bindings — the Worker never reads them.
- Adding them would require configuring them as Wrangler secrets in all environments.
- They would pollute every `Env` mock in tests.

These vars live exclusively in `.dev.vars*` files, read by `scripts/_env.ts`.
