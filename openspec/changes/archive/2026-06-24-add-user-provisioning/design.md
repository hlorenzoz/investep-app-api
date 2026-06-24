# Design: Add User Provisioning

> Change: `add-user-provisioning`
> Status: approved
> Date: 2026-06-24

---

## 1. Architectural Approach

### 1.1 Layer Separation (Why `src/features/auth/` vs `scripts/`)

The codebase applies **screaming architecture**: every business concern lives under `src/features/{domain}/`, co-located with its unit tests, and protected by the coverage gate (`bun test src tests --coverage`, 95–100% threshold). Scripts under `scripts/` are explicitly excluded from that gate because they are thin CLI wrappers with no testable logic beyond I/O.

This separation is not cosmetic — it enforces a structural contract:

| Concern | Location | Coverage | Reason |
|---------|----------|----------|--------|
| Password generation | `src/features/auth/password.ts` | Required | Pure logic, deterministic property tests |
| Provisioning service | `src/features/auth/user-provisioning.ts` | Required | Domain logic with injected deps (admin, sendEmail) |
| Email templates | `src/features/auth/templates.ts` | Required | Pure function, output assertions |
| CLI wiring | `scripts/provision-user.ts`, `scripts/get-token.ts` | Excluded | Side-effectful (network, env, stdout), not domain |
| Env loading helper | `scripts/_env.ts` | Excluded | Infrastructure glue |

The coverage gate acts as an architectural enforcer: any logic that must survive refactoring goes into `src/`; anything that can be re-written trivially (env loading, arg parsing, print) stays in `scripts/`.

### 1.2 Screaming Architecture Alignment

The change populates `src/features/auth/` with provisioning capabilities, keeping the domain name (`auth`) as the primary organizer. The `authRouter` stub in `index.ts` remains unchanged by this change (no HTTP routes are added); `index.ts` will be updated to re-export the provisioning service so consumers can import from the feature boundary.

---

## 2. Public Signatures

### 2.1 `src/features/auth/password.ts`

```ts
/**
 * Generates a cryptographically strong password using Web Crypto.
 * Charset excludes visually ambiguous characters (O/0, I/l/1).
 * Guarantees at least one character from each class (uppercase, lowercase,
 * digit, symbol). Uses rejection sampling to eliminate modulo bias.
 *
 * @param length - Total length of the generated password. Default: 24.
 * @returns A password string of exactly `length` characters.
 */
export function generatePassword(length?: number): string;
```

Implementation notes (no code shipped here):
- Default length: 24.
- Character classes: uppercase (`A-Z` minus `I`, `O`), lowercase (`a-z` minus `l`), digits (`2-9`, excluding `0/1`), symbols (a small safe set, e.g. `!@#$%^&*`).
- Rejection sampling: draw bytes in a loop, discard values that fall in the bias tail of `256 % charsetLength`.
- After building the candidate array, perform an in-place shuffle to remove positional predictability of the class-guarantee characters.

### 2.2 `src/features/auth/user-provisioning.ts`

```ts
import type { AppSupabaseClient } from "../../lib/supabase";
import type { SendEmailParams, SendEmailResult } from "../../lib/resend";

/** Dependencies injected into `provisionUser`. Modeled as plain objects for testability. */
export interface ProvisionUserDeps {
  /** Supabase client initialized with service-role key. */
  admin: AppSupabaseClient;
  /** Email sender; signature matches `sendEmail` from `src/lib/resend`. */
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>;
}

/** Input accepted by `provisionUser`. */
export interface ProvisionUserInput {
  /** Target user's email address. */
  email: string;
  /**
   * Optional explicit password. When omitted, `generatePassword()` is called.
   * Scripts may pass a user-supplied password; tests may pass a fixed one.
   */
  password?: string;
}

/** Resolved result after provisioning completes. */
export interface ProvisionUserResult {
  /** Supabase Auth user UUID. */
  userId: string;
  /** Normalized email of the provisioned user. */
  email: string;
  /**
   * `true` if the user was created; `false` if they already existed and were
   * reset (idempotent path).
   */
  created: boolean;
  /** Resend email delivery ID for audit trail. */
  emailId: string;
}

/**
 * Idempotently creates or resets a Supabase Auth user and delivers credentials
 * by email. Never logs the password.
 *
 * @throws {AppError} on Supabase API errors or email delivery failure.
 */
export async function provisionUser(
  deps: ProvisionUserDeps,
  input: ProvisionUserInput,
): Promise<ProvisionUserResult>;

/**
 * Paginates `admin.auth.admin.listUsers` to find a user by email address.
 * The Supabase Admin API has no native filter-by-email on `listUsers`; this
 * helper performs a full paginated scan and matches client-side.
 *
 * Internal helper — not exported from the feature boundary.
 */
async function findUserByEmail(
  admin: AppSupabaseClient,
  email: string,
): Promise<{ id: string } | null>;
```

### 2.3 `src/features/auth/templates.ts`

```ts
export interface CredentialEmailInput {
  /** Recipient email address (used in salutation and for display). */
  email: string;
  /** The plaintext password to include in the email body. */
  password: string;
}

export interface CredentialEmailOutput {
  /** Email subject line. */
  subject: string;
  /** HTML body. */
  html: string;
  /** Plaintext fallback body. */
  text: string;
}

/**
 * Builds the credential delivery email for a provisioned user.
 * Language: Spanish. Includes a security warning to change the password
 * after first login.
 *
 * Pure function — no side effects, fully testable.
 */
export function credentialEmail(input: CredentialEmailInput): CredentialEmailOutput;
```

### 2.4 `src/features/auth/index.ts` (modification)

The existing router stub is preserved. The file gains re-exports for the provisioning service so external callers (scripts) import from the feature boundary, not internal paths:

```ts
// Existing: authRouter stays as-is
export { provisionUser } from "./user-provisioning";
export type { ProvisionUserDeps, ProvisionUserInput, ProvisionUserResult } from "./user-provisioning";
export { generatePassword } from "./password";
export { credentialEmail } from "./templates";
```

---

## 3. Idempotence Decision (ADR-1)

**Decision**: `createUser → detect "already registered" → findUserByEmail → updateUserById`

**Rationale**: The Supabase Admin API (`admin.auth.admin.createUser`) returns an error with a recognizable message when the email is already registered. The idempotent path must:

1. Attempt `createUser` first (optimistic path — fast for the common case of a new user).
2. Detect the "already registered" condition by checking the error message from Supabase.
3. Call `findUserByEmail` (paginated `listUsers`, client-side filter) to recover the existing user's UUID.
4. Call `updateUserById` with the new password and reset metadata.

**Always set on createUser**:
- `email_confirm: true` — the admin is creating the account; the user should not need to verify their email.
- `user_metadata: { must_reset_password: true }` — signals downstream (UI, middleware) that the user must change credentials after first login.

**On the update path**: `updateUserById` receives the same `user_metadata` to ensure the flag is set even when resetting.

**Rejected alternative**: Calling `listUsers` first to check existence before `createUser`. Rejected because it adds an extra API call on the hot path (new user creation) and `listUsers` is O(n) — the optimistic `createUser` approach is both faster and avoids the pagination cost for new users.

---

## 4. Password Generation Decision (ADR-2)

**Decision**: Web Crypto `getRandomValues` + rejection sampling, no external library.

**Rationale**:
- `crypto.getRandomValues` is available in both Cloudflare Workers and Bun (the two runtimes used in this project). No polyfill needed.
- Rejection sampling eliminates modulo bias: when `256 % charsetLength !== 0`, uniformly distributed byte values have a slight bias toward lower indices. Discarding values in the tail (values `>= charsetLength * floor(256 / charsetLength)`) corrects this.
- The unambiguous charset avoids support overhead: users reading passwords aloud or typing them manually cannot confuse `O` with `0`, `I` with `l` or `1`.
- Class guarantee (at least one of each class) followed by an in-place Fisher-Yates shuffle ensures no positional leakage of the guarantee structure.

**Rejected alternative**: `uuid` or `nanoid`. Both lack the class-guarantee property needed for passwords (a UUID is not a valid password policy-wise; `nanoid` does not guarantee mixed character classes). Using them would require post-processing logic equivalent to building the generator from scratch.

---

## 5. Token Acquisition Decision (ADR-3)

**Decision**: `signInWithPassword` with the publishable key (`sb_publishable_` prefix), returns `data.session.access_token`.

**Rationale**: The publishable key is the correct key for client-originated auth flows, including CLI tooling acting on behalf of a user. Using the service-role key for `signInWithPassword` is incorrect (the admin client does not use `signInWithPassword`). The `get-token.ts` script creates a standard (non-admin) Supabase client with the publishable key and calls `auth.signInWithPassword({ email, password })`, then prints `data.session.access_token`. The JWT is never stored anywhere; it is printed once and consumed by the caller.

**Security constraint**: the printed JWT is printed to stdout only. It is never logged with `console.error` or `console.warn`, and scripts must not capture it into variables that persist beyond the CLI invocation.

---

## 6. Security Hybrid Decision (ADR-4)

**Decision**: Ship password-by-email now. Document invite-link migration path. Do not ship any invite-link code.

**Current approach — password-by-email**:
- High entropy (24+ chars, mixed classes, Web Crypto).
- `email_confirm: true` prevents locked-out users.
- `user_metadata.must_reset_password: true` flags the account for post-login reset.
- Resend delivers over TLS; the credential email includes a security warning.
- The password is never printed to stdout, never logged server-side.

**Mitigations in place**:
| Threat | Mitigation |
|--------|-----------|
| Email interception | High-entropy password reduces value of interception; security warning in email |
| Password reuse | `must_reset_password` flag enforces change on first login |
| Accidental log exposure | Explicit "never log password" rule enforced by test (`password never logged` case) |
| Insider replay | Single-use credential: once changed, the emailed password is invalid |

**Future migration path to invite-links (NOT shipped)**:
When a set-password page exists:
1. Replace `createUser` with `admin.auth.admin.generateLink({ type: 'invite', email })` or `admin.auth.admin.inviteUserByEmail(email)`.
2. Send the returned `action_link` (or the magic link URL) via Resend instead of the plaintext password.
3. The user clicks the link, lands on the set-password page, and sets their own password.
4. Remove `generatePassword` from the provisioning path (it remains available for the reset sub-flow).

**Why not shipped now**: would be dead code (no set-password page exists), and dead code branches break the coverage gate. The migration path lives in `docs/auth.md` only.

---

## 7. Environment Variables Decision (ADR-5)

**Decision**: `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` live exclusively in `.dev.vars*` files. They are NOT added to `src/types/env.ts`.

**Rationale**: `src/types/env.ts` defines the `Env` interface that represents Cloudflare Worker bindings — what the Worker runtime injects into every request handler. The Worker never calls `provisionUser` or `signInWithPassword` directly; provisioning is an operator-only CLI operation. Adding these vars to `Env` would:
1. Imply they need to be configured as Wrangler secrets or vars for deployment (they don't).
2. Make them visible to all Worker bindings, violating the principle of least privilege.
3. Require TypeScript stubs in every `Env` mock in tests, polluting test setup.

Scripts read `.dev.vars` directly via `scripts/_env.ts` (`loadDevVars`), not through the Worker runtime. This is consistent with how `scripts/send-test-email.ts` already reads `RESEND_API_KEY` and `RESEND_FROM` without relying on `Env`.

---

## 8. `scripts/_env.ts` Design

The `loadDevVars` function extracted from `scripts/send-test-email.ts` will be centralized in `scripts/_env.ts` with an extended signature:

```ts
/**
 * Parses a `.dev.vars`-formatted file (dotenv KEY=VALUE, optional quotes).
 *
 * @param envName - Optional environment name. Maps:
 *   - `"staging"`    → `.dev.vars.staging`
 *   - `"production"` → `.dev.vars.production`
 *   - `undefined`    → `.dev.vars`
 * @returns Parsed key/value pairs. Returns `{}` if the file does not exist.
 */
export function loadDevVars(envName?: string): Record<string, string>;
```

`scripts/send-test-email.ts` is refactored to import and call `loadDevVars()` from `_env.ts`, removing the inline duplicate.

CLI scripts (`provision-user.ts`, `get-token.ts`) parse `--env <name>` from `process.argv` and pass the name to `loadDevVars(envName)`.

---

## 9. Data Flow

```
Operator CLI invocation
  │
  ▼
scripts/provision-user.ts
  ├─ loadDevVars(envName)           → reads .dev.vars*
  ├─ createSupabaseAdminClient(env) → src/lib/supabase.ts
  ├─ sendEmail bound to env         → src/lib/resend.ts
  └─ provisionUser(deps, input)     → src/features/auth/user-provisioning.ts
       ├─ generatePassword()           → src/features/auth/password.ts
       ├─ admin.createUser(...)        → Supabase Admin API
       │    └─ on "already registered":
       │         ├─ findUserByEmail(admin, email)  [paginate listUsers]
       │         └─ admin.updateUserById(id, ...)
       ├─ credentialEmail({email,password}) → src/features/auth/templates.ts
       └─ sendEmail({to,subject,html,text})  → Resend API
  │
  └─ prints: { userId, created, emailId }   [never prints password or JWT]

scripts/get-token.ts
  ├─ loadDevVars(envName)
  ├─ createSupabaseClient(env)      → uses SUPABASE_ANON_KEY (publishable)
  └─ auth.signInWithPassword({email,password})
       └─ prints: data.session.access_token
```

---

## 10. Testing Architecture

Tests live co-located with source files. Pattern follows `health.test.ts` (bun:test, plain mocks via object literals, no mock framework).

### `password.test.ts` — property tests
- Output length equals requested length.
- Every character belongs to the defined charset.
- No ambiguous character (`O`, `0`, `I`, `l`, `1`) appears.
- At least one character from each class (uppercase, lowercase, digit, symbol).
- 1000 calls produce at least 990 distinct values (statistical uniqueness).

### `user-provisioning.test.ts` — behavior tests with plain object mocks
Admin mock shape (matches `AppSupabaseClient.auth.admin` surface used by `provisionUser`):

```ts
const makeAdmin = (overrides?) => ({
  auth: {
    admin: {
      createUser: mock(async () => ({ data: { user: { id: "uid-1" } }, error: null })),
      listUsers: mock(async () => ({ data: { users: [] }, error: null })),
      updateUserById: mock(async () => ({ data: { user: { id: "uid-1" } }, error: null })),
    },
  },
  ...overrides,
});
```

Test cases:
1. New user: `createUser` succeeds → returns `{ created: true }`.
2. Existing user: `createUser` returns "already registered" error → `listUsers` returns user → `updateUserById` called → returns `{ created: false }`.
3. Explicit password respected: `input.password` is used, `generatePassword` not called.
4. Generated password used when `input.password` is absent.
5. Email delivery failure propagates as `AppError`.
6. Password never logged: spy on `console.error` / `console.warn` / `console.log`; assert no call receives a string matching the generated password.
7. `email_confirm: true` passed to `createUser`.
8. `must_reset_password` present in `user_metadata` on both create and update paths.

### `templates.test.ts` — output assertions
- `subject` is a non-empty string.
- `html` contains the password string.
- `text` contains the password string.
- Both `html` and `text` contain a security warning phrase.

---

## 11. Risks and Unresolved Decisions

| Risk | Likelihood | Notes |
|------|------------|-------|
| `listUsers` O(n) without email filter | Low | Acceptable for admin tooling (small user base). Document throttling note in `docs/auth.md` for future CSV bulk import. |
| Supabase "already registered" error message changes across SDK versions | Low-Med | Pin the error detection to the specific SDK version in use (v2.108). Add a test that verifies the detection logic against a hardcoded error string. |
| Supabase Admin API rate limits on reset loop | Low | Each CLI call provisions one user. No loop in this change. |
| New Supabase API key system (`sb_publishable_` prefix) | Known | `get-token.ts` must use the anon/publishable key, not the service-role key. Documented explicitly in ADR-3. The `createSupabaseClient` factory already uses `SUPABASE_ANON_KEY`. |
| `email_confirm: true` silently ignored | Low | Covered by unit test (assertion on `createUser` call args). |
| Coverage gate broken by scripts being counted | Known-resolved | `wrangler.test.ts` / `biome` config and `bun test src tests` path scope already exclude `scripts/`. Verify scope in `bunfig.toml` or test config before implementation. |
| Invite-link branch accidentally introduced | Low | No code path added. Coverage gate would fail on dead `if` branches. |

---

## 12. File Index (Design Boundaries)

| File | Type | Covered | Description |
|------|------|---------|-------------|
| `src/features/auth/password.ts` | New | Yes | `generatePassword` |
| `src/features/auth/password.test.ts` | New | Yes | Property tests |
| `src/features/auth/user-provisioning.ts` | New | Yes | `provisionUser`, `findUserByEmail` |
| `src/features/auth/user-provisioning.test.ts` | New | Yes | Behavior tests |
| `src/features/auth/templates.ts` | New | Yes | `credentialEmail` |
| `src/features/auth/templates.test.ts` | New | Yes | Output assertions |
| `src/features/auth/index.ts` | Modified | Yes | Re-exports provisioning surface |
| `scripts/_env.ts` | New | No | `loadDevVars(envName?)` |
| `scripts/provision-user.ts` | New | No | CLI: create/reset user |
| `scripts/get-token.ts` | New | No | CLI: print JWT |
| `scripts/send-test-email.ts` | Modified | No | Refactor to import from `_env.ts` |
| `justfile` | Modified | No | 3 new recipes |
| `.dev.vars.example` | Modified | No | Add bootstrap vars |
| `.dev.vars.staging.example` | Modified | No | Add bootstrap vars |
| `docs/auth.md` | New | No | Auth model + provisioning guide |
