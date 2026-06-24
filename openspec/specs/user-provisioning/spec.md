# User Provisioning Specification

## Purpose

Operators provision Supabase Auth users via CLI. There is no self-service sign-up. The system creates or resets a user's password and delivers the credential by email. All operations are idempotent and never expose secrets in logs or CLI output.

## Requirements

### Requirement: Password Generation

The system MUST generate cryptographically strong passwords using Web Crypto (`crypto.getRandomValues`). Generated passwords MUST be at least 24 characters long, drawn from an unambiguous charset (excluding `O`, `0`, `I`, `l`, `1`), and contain at least one character from each of the four classes: uppercase letters, lowercase letters, digits, and safe symbols. The generator MUST use rejection sampling to eliminate modulo bias.

#### Scenario: Generate password — all constraints satisfied

- GIVEN the password generator is called with no arguments
- WHEN `generatePassword()` executes
- THEN the returned string has length ≥ 24
- AND every character belongs to the unambiguous charset
- AND at least one character is uppercase
- AND at least one character is lowercase
- AND at least one character is a digit
- AND at least one character is a safe symbol

#### Scenario: Generate password — no ambiguous characters

- GIVEN a generated password
- WHEN each character is checked against the ambiguous set `{O, 0, I, l, 1}`
- THEN no match is found

#### Scenario: Consecutive calls produce distinct passwords

- GIVEN the generator is called twice in succession
- WHEN both results are compared
- THEN the two passwords are not equal (statistical uniqueness)

---

### Requirement: User Provisioning — Create New User

The system MUST create a new Supabase Auth user with `email_confirm: true` and `user_metadata.must_reset_password: true`. If no password is provided by the caller the system MUST generate one. The result MUST include `created: true`.

#### Scenario: Provision new user with generated password

- GIVEN a valid email that does not exist in Supabase Auth
- AND no password is supplied by the caller
- WHEN `provisionUser` is called
- THEN Supabase `admin.createUser` is called with `email_confirm: true` and `user_metadata.must_reset_password: true`
- AND a credential email is sent with the generated password
- AND the result contains `{ created: true, userId, emailId }`

#### Scenario: Provision new user with caller-supplied password

- GIVEN a valid email that does not exist in Supabase Auth
- AND a password string is supplied by the caller
- WHEN `provisionUser` is called
- THEN `admin.createUser` is called with the supplied password
- AND the result contains `{ created: true }`

#### Scenario: Email delivery failure on new user

- GIVEN a valid email that does not exist in Supabase Auth
- WHEN `provisionUser` is called and the email service returns an error
- THEN the function throws an `AppError` with a consistent error message
- AND no password is printed or logged at any point

---

### Requirement: User Provisioning — Idempotent Reset

The system MUST handle the case where the email already exists in Supabase Auth. It MUST find the existing user by paginating `listUsers`, reset their password via `updateUserById`, and resend the credential email. The result MUST include `created: false` to distinguish a reset from a creation.

#### Scenario: Provision existing user — reset password and resend email

- GIVEN an email that already exists in Supabase Auth
- WHEN `provisionUser` is called
- THEN `admin.createUser` returns an "already registered" error
- AND `listUsers` is called (paginating until the user is found)
- AND `admin.updateUserById` is called with the new password and `user_metadata.must_reset_password: true`
- AND a credential email is sent
- AND the result contains `{ created: false, userId, emailId }`

#### Scenario: Existing user not found during pagination

- GIVEN `admin.createUser` returns an "already registered" error
- AND `listUsers` exhausts all pages without finding a matching email
- WHEN `provisionUser` executes the reset path
- THEN the function throws an `AppError`

---

### Requirement: Credential Email Template

The system MUST produce a credential email with a subject, HTML body, and plain-text body. The email MUST be written in Spanish, include the user's email address and password, and display a clear security warning instructing the user to change their password immediately.

#### Scenario: Template contains required fields

- GIVEN a valid email and password are passed to `credentialEmail`
- WHEN the template is rendered
- THEN the returned object contains non-empty `subject`, `html`, and `text` fields
- AND both `html` and `text` include the literal password
- AND both `html` and `text` include a security warning

---

### Requirement: Security — No Secret Exposure

The system MUST NEVER log, print, or include passwords or JWTs in any log output, CLI stdout/stderr, or structured log field, at any point in the provisioning or token-retrieval flow. Errors wrapping Supabase or Resend failures MUST use `AppError` and MUST NOT embed the raw credential in the error message.

#### Scenario: Password never appears in logs during provisioning

- GIVEN a `provisionUser` call that succeeds
- WHEN all side-effectful calls (createUser, updateUserById, sendEmail) complete
- THEN no call to `console.log`, `console.error`, or any logger includes the password string

#### Scenario: Password never appears in logs on failure

- GIVEN `provisionUser` encounters an error (Supabase or Resend)
- WHEN the error is thrown
- THEN the thrown `AppError` message does not contain the password

---

### Requirement: CLI — Provision User Script

The `scripts/provision-user.ts` CLI MUST accept `[EMAIL] [PASSWORD]` positional arguments and a `--env <name>` flag. When EMAIL is omitted it MUST fall back to `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from the resolved env file. It MUST print only `userId`, `created`, and `emailId`. It MUST NOT print the password.

#### Scenario: Bootstrap user provisioning (no args)

- GIVEN `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are set in `.dev.vars`
- WHEN the script is invoked with no arguments
- THEN it calls `provisionUser` with those credentials
- AND prints a JSON or plain object containing `userId`, `created`, and `emailId`
- AND does not print the password

#### Scenario: Explicit email provisioning

- GIVEN an email is passed as the first positional argument
- WHEN the script is invoked
- THEN it calls `provisionUser` with that email (and optional password)
- AND prints `userId`, `created`, and `emailId`

#### Scenario: Environment selection via --env flag

- GIVEN `--env staging` is passed
- WHEN the script resolves its env file
- THEN it reads from `.dev.vars.staging` (not `.dev.vars`)

---

### Requirement: CLI — Get Token Script

The `scripts/get-token.ts` CLI MUST sign in via `signInWithPassword` using the publishable Supabase key and print only the `access_token`. It MUST NOT print the password. When called without arguments it MUST fall back to bootstrap credentials.

#### Scenario: Token printed on successful sign-in

- GIVEN valid credentials exist in the env file
- WHEN the script is invoked
- THEN it prints the `access_token` string to stdout
- AND does not print the password or the full session object

#### Scenario: Bootstrap fallback when no arguments supplied

- GIVEN `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` are set
- WHEN the script is invoked with no arguments
- THEN it uses the bootstrap credentials for `signInWithPassword`

---

### Requirement: Justfile Recipes

The justfile MUST expose three recipes: `create-first-user` (no args), `create-user EMAIL PASSWORD=""`, and `token EMAIL="" PASSWORD=""`. Each recipe MUST delegate to the corresponding script. `create-user` MUST support an empty PASSWORD that triggers server-side password generation.

#### Scenario: create-first-user delegates to provision script

- GIVEN the justfile is present
- WHEN `just create-first-user` is executed
- THEN it runs `bun run scripts/provision-user.ts` with no arguments

#### Scenario: create-user passes email and optional password

- WHEN `just create-user test@example.com` is executed
- THEN it runs `bun run scripts/provision-user.ts test@example.com`

#### Scenario: token recipe retrieves access_token

- WHEN `just token` is executed
- THEN it runs `bun run scripts/get-token.ts` and the output contains the access_token

---

### Requirement: Environment Variable Examples

`.dev.vars.example` and `.dev.vars.staging.example` MUST declare `BOOTSTRAP_ADMIN_EMAIL=` and `BOOTSTRAP_ADMIN_PASSWORD=` with empty values. These variables MUST NOT appear in `src/types/env.ts` because they are scripts-only and never read by the Worker runtime.

#### Scenario: Example files include bootstrap vars

- GIVEN the example env files are read
- WHEN their contents are inspected
- THEN both contain the keys `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`
- AND `src/types/env.ts` does not declare those keys

---

## Source

Originated from change `add-user-provisioning` (archived 2026-06-24).
Implementation: `src/features/auth/` — `password.ts`, `user-provisioning.ts`, `templates.ts` + colocated tests.
ADRs: see `openspec/changes/archive/2026-06-24-add-user-provisioning/design.md` §3–6.
Future work: migrate to invite-links when set-password page exists (ADR-4 migration path).
