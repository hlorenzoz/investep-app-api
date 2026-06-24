# Tasks: add-user-provisioning

> Strict TDD enabled. Every coded task follows test-first order:
> write failing test → implement → make green → move on.
> Scripts (`scripts/`) are excluded from the coverage gate and have no test tasks.

---

## 1. Password — tests

Sequential. Must complete before 2.

- [x] 1.1 Create `src/features/auth/password.test.ts`. Import `generatePassword` (path exists, function not yet). Write test: output length equals requested length (default 24).
- [x] 1.2 Add test: every character belongs to the defined unambiguous charset (no char outside the union of uppercase + lowercase + digit + symbol sets).
- [x] 1.3 Add test: no ambiguous character appears — none of `O`, `0`, `I`, `l`, `1` in 1000 consecutive outputs.
- [x] 1.4 Add test: at least one uppercase, one lowercase, one digit, one symbol (run 50 times, all pass).
- [x] 1.5 Add test: statistical uniqueness — 1000 calls produce at least 990 distinct values.
- [x] 1.6 Confirm all five tests fail (import resolves but function not implemented). `bun test src/features/auth/password.test.ts` → red.

---

## 2. Password — implementation

Sequential. Depends on 1.

- [x] 2.1 Create `src/features/auth/password.ts`. Define and export `generatePassword(length?: number): string` with TSDoc per design §2.1.
- [x] 2.2 Implement unambiguous charset: uppercase (`A-Z` minus `I`, `O`), lowercase (`a-z` minus `l`), digits (`2-9`), safe symbols.
- [x] 2.3 Implement rejection sampling loop using `crypto.getRandomValues` to eliminate modulo bias.
- [x] 2.4 Guarantee one character from each class; apply Fisher-Yates in-place shuffle.
- [x] 2.5 Run `bun test src/features/auth/password.test.ts` → all green.

---

## 3. Email template — tests

Sequential. Depends on 2 (password module must exist for import consistency). Independent of 4.

- [x] 3.1 Create `src/features/auth/templates.test.ts`. Import `credentialEmail`. Write test: returned object has non-empty `subject`, `html`, and `text` fields.
- [x] 3.2 Add test: both `html` and `text` contain the literal password string passed as input.
- [x] 3.3 Add test: both `html` and `text` contain a Spanish security warning phrase (e.g. "cambiar" or "inmediatamente" — exact phrase TBD at impl time, assert inclusion).
- [x] 3.4 Confirm tests fail. `bun test src/features/auth/templates.test.ts` → red.

---

## 4. Email template — implementation

Sequential. Depends on 3.

- [x] 4.1 Create `src/features/auth/templates.ts`. Define and export interfaces `CredentialEmailInput`, `CredentialEmailOutput`, and function `credentialEmail` per design §2.3.
- [x] 4.2 Implement HTML body: Spanish language, includes `input.email`, `input.password`, and a bold security warning instructing immediate password change.
- [x] 4.3 Implement plain-text fallback body with same content.
- [x] 4.4 Run `bun test src/features/auth/templates.test.ts` → all green.

---

## 5. Provisioning service — tests

Sequential. Depends on 2 and 4 (imports password and templates). Must complete before 6.

- [x] 5.1 Create `src/features/auth/user-provisioning.test.ts`. Define `makeAdmin` factory per design §10 (plain object mock with `auth.admin.{createUser, listUsers, updateUserById}` returning `{data, error}` shape).
- [x] 5.2 Add test: new user — `createUser` succeeds → result contains `{ created: true, userId, emailId }` and `sendEmail` called once.
- [x] 5.3 Add test: caller-supplied password respected — `input.password` is forwarded to `createUser`; `generatePassword` is NOT called (spy/assert on call count if needed via module mock or by injecting a flag).
- [x] 5.4 Add test: generated password used when `input.password` is absent — `createUser` receives a 24+-char string matching the unambiguous charset.
- [x] 5.5 Add test: existing user reset — `createUser` returns `{ error: { message: "already registered" } }` → `listUsers` returns the user → `updateUserById` called with new password and `user_metadata.must_reset_password: true` → result is `{ created: false, userId, emailId }`.
- [x] 5.6 Add test: existing user not found during pagination — `listUsers` returns empty pages → function throws `AppError`.
- [x] 5.7 Add test: email delivery failure → `sendEmail` rejects → function throws `AppError` whose message does NOT contain the password.
- [x] 5.8 Add test: `email_confirm: true` is passed to `createUser` (assert call args).
- [x] 5.9 Add test: `user_metadata.must_reset_password: true` present on both `createUser` and `updateUserById` paths.
- [x] 5.10 Add test: password never logged — spy on `console.log`, `console.error`, `console.warn`; after a successful call, assert no spy received a string matching the generated password.
- [x] 5.11 Confirm all tests fail. `bun test src/features/auth/user-provisioning.test.ts` → red.

---

## 6. Provisioning service — implementation

Sequential. Depends on 5.

- [x] 6.1 Create `src/features/auth/user-provisioning.ts`. Define and export interfaces `ProvisionUserDeps`, `ProvisionUserInput`, `ProvisionUserResult` per design §2.2.
- [x] 6.2 Implement internal `findUserByEmail(admin, email)`: paginate `admin.auth.admin.listUsers`, match client-side, return `{ id }` or `null`.
- [x] 6.3 Implement `provisionUser(deps, input)`: optimistic `createUser` path — generate password if absent, call `admin.auth.admin.createUser` with `email_confirm: true` and `user_metadata.must_reset_password: true`.
- [x] 6.4 Implement idempotent reset path: detect "already registered" error → call `findUserByEmail` → call `updateUserById` with new password and reset metadata. Throw `AppError` if user not found.
- [x] 6.5 Call `credentialEmail` and `deps.sendEmail`; propagate Resend errors as `AppError` without embedding the password in the message.
- [x] 6.6 Ensure no call to `console.*` anywhere in the function body.
- [x] 6.7 Run `bun test src/features/auth/user-provisioning.test.ts` → all green.

---

## 7. Feature boundary re-exports

Sequential. Depends on 6 (all source files exist).

- [x] 7.1 Modify `src/features/auth/index.ts`: add re-exports for `provisionUser` + types from `./user-provisioning`, `generatePassword` from `./password`, and `credentialEmail` from `./templates`. Preserve existing `authRouter` export unchanged.
- [x] 7.2 Run `bun test src tests --coverage` → all existing + new tests green, coverage gate passes.

---

## 8. `scripts/_env.ts` — env loading helper

Sequential. Depends on 7 (no code dependency, but run after coverage gate is green so scripts work won't break it). Independent of 9 and 10; 9 and 10 depend on this.

- [x] 8.1 Create `scripts/_env.ts`. Extract `unquote` and `loadDevVars` from `scripts/send-test-email.ts`. Extend `loadDevVars(envName?: string)` signature: maps `"staging"` → `.dev.vars.staging`, `"production"` → `.dev.vars.production`, `undefined` → `.dev.vars`. Export `loadDevVars`.
- [x] 8.2 Refactor `scripts/send-test-email.ts`: remove inline `unquote` and `loadDevVars` definitions; import `loadDevVars` from `./_env.ts`. Confirm `just email-test` still works (manual smoke test or just confirm no TS errors).

---

## 9. `scripts/provision-user.ts`

Sequential. Depends on 8.

- [x] 9.1 Create `scripts/provision-user.ts`. Parse `--env <name>` from `process.argv`. Parse positional args: `[EMAIL] [PASSWORD]`. Fall back to `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` from `loadDevVars(envName)` when EMAIL is absent.
- [x] 9.2 Instantiate Supabase admin client via `src/lib/supabase.ts` factory using loaded vars. Bind `sendEmail` from `src/lib/resend.ts`.
- [x] 9.3 Call `provisionUser(deps, { email, password })`. Print `{ userId, created, emailId }` to stdout. Do NOT print the password.
- [x] 9.4 Handle errors: catch `AppError` and any unexpected error, print a human-readable message to `stderr`, exit with code 1.

---

## 10. `scripts/get-token.ts`

Sequential. Depends on 8. Parallel with 9.

- [x] 10.1 Create `scripts/get-token.ts`. Parse `--env <name>` and positional `[EMAIL] [PASSWORD]`. Fall back to `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` from `loadDevVars(envName)` when no args supplied.
- [x] 10.2 Create a standard (non-admin) Supabase client using `SUPABASE_URL` and `SUPABASE_ANON_KEY` (publishable key). Call `auth.signInWithPassword({ email, password })`.
- [x] 10.3 Print `data.session.access_token` to stdout only. Do NOT print the password, the full session object, or the JWT via `console.error`/`console.warn`.
- [x] 10.4 Handle errors: print to `stderr`, exit 1.

---

## 11. Justfile recipes

Sequential. Depends on 9 and 10 (scripts must exist).

- [x] 11.1 Add recipe `create-first-user` to `justfile`: runs `bun run scripts/provision-user.ts` with no arguments.
- [x] 11.2 Add recipe `create-user EMAIL PASSWORD=""`: runs `bun run scripts/provision-user.ts {{EMAIL}} {{PASSWORD}}`. Empty PASSWORD triggers server-side generation.
- [x] 11.3 Add recipe `token EMAIL="" PASSWORD=""`: runs `bun run scripts/get-token.ts {{EMAIL}} {{PASSWORD}}`.
- [x] 11.4 Verify `just --list` shows the three new recipes without error.

---

## 12. Environment variable examples

Parallel with 11 (no dependencies). Can run after 7.

- [x] 12.1 Add `BOOTSTRAP_ADMIN_EMAIL=` and `BOOTSTRAP_ADMIN_PASSWORD=` (empty values, with a comment) to `.dev.vars.example`.
- [x] 12.2 Add the same two vars to `.dev.vars.staging.example`.
- [x] 12.3 Verify `src/types/env.ts` does NOT declare `BOOTSTRAP_ADMIN_EMAIL` or `BOOTSTRAP_ADMIN_PASSWORD` (read the file, assert absence).

---

## 13. Documentation

Parallel with 11 and 12. Can run after 7.

- [x] 13.1 Create `docs/auth.md`. Section: Auth model — Supabase Auth, service-role vs publishable key, `must_reset_password` flag lifecycle.
- [x] 13.2 Add section: Provisioning flow — data flow diagram (text), `provisionUser` idempotence contract, `createUser` → "already registered" → `findUserByEmail` → `updateUserById`.
- [x] 13.3 Add section: CLI commands — `just create-first-user`, `just create-user`, `just token`; env selection via `--env`; what each prints and what it never prints.
- [x] 13.4 Add section: Security model — credential-by-email rationale, mitigations table (interception, reuse, log exposure, insider replay), `must_reset_password` enforcement.
- [x] 13.5 Add section: Migration path to invite-links — steps 1-4 from ADR-4 (design §6). Document `listUsers` O(n) note and throttling consideration for future bulk import.
- [x] 13.6 Add section: Gotchas — "already registered" error string tied to Supabase SDK v2.108; publishable key required for `signInWithPassword` (not service-role); scripts excluded from coverage gate.

---

## 14. Final verification

Sequential. Depends on 7, 9, 10, 11, 12, 13.

- [x] 14.1 Run `bun test src tests --coverage` → all tests green; coverage gate (95%+) passes for `src/` scope.
- [x] 14.2 Run `just lint` (`bunx biome check .` + `bunx tsc --noEmit`) → zero errors.
- [x] 14.3 Confirm `src/types/env.ts` still does not declare `BOOTSTRAP_ADMIN_EMAIL` or `BOOTSTRAP_ADMIN_PASSWORD`.
- [x] 14.4 Confirm no `console.*` call in `src/features/auth/user-provisioning.ts` (grep for `console.`).
- [x] 14.5 Confirm `scripts/provision-user.ts` and `scripts/get-token.ts` contain no `console.log` call that outputs a password or JWT variable.

---

## Dependency Graph

```
1 (password tests) → 2 (password impl)
                       ↓
                    3 (template tests) → 4 (template impl)
                                           ↓
2 + 4 → 5 (provisioning tests) → 6 (provisioning impl)
                                     ↓
                                  7 (feature re-exports)
                                     ↓
                   ┌─────────────────┤
                   ↓                 ↓                  ↓
               8 (_env)         12 (env examples)  13 (docs)
               ↓       ↓
           9 (provision-user)  10 (get-token)
               └─────┬─────────────┘
                     ↓
                  11 (justfile)
                     ↓
                  14 (final verification)
```

Parallel opportunities:
- 9 and 10 can run in parallel (both depend on 8 only).
- 12 and 13 can run in parallel with each other and with 9/10/11.
- 3/4 (templates) run independently of the provisioning test/impl tasks but must precede 5.
