# Project: investep-app-api

## Stack

- Runtime: Cloudflare Workers (Bun for local dev/scripts)
- Framework: Hono
- Language: TypeScript (strict, no `any`)
- Database / Auth: Supabase (HTTP/REST via `@supabase/supabase-js` v2)
- Email: Resend (via `src/lib/resend.ts`)
- Testing: Bun test (`bun test src tests`); coverage gate 95–100%
- Tooling: Just, Biome, tsc

## Architecture

Screaming/hexagonal architecture organized by feature under `src/features/{domain}/`.
Reference pattern: `src/features/health/`.

Shared libs: `src/lib/supabase.ts`, `src/lib/resend.ts`, `src/lib/errors.ts`.
Secrets: wrangler / `.dev.vars`; never committed.

## Conventions

- API-first: Zod + OpenAPI for route contracts
- Single error format via `AppError` (`src/lib/errors.ts`)
- Tests colocated with source (`*.test.ts`)
- Scripts in `scripts/` are NOT covered by the coverage gate
- No state, no TCP to Postgres; Workers-compatible APIs only
- Never log tokens, passwords, or JWTs

## Strict TDD

Enabled. Runner: `bun test src tests`. Every `src/` file ships with tests (red → green → refactor).
