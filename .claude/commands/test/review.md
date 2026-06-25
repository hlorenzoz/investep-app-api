---
description: Revisión experta de testing de la API (Supabase/Hono/Workers) y escritura de los tests faltantes en Strict TDD
argument-hint: "[feature | endpoint | fichero — vacío = cambios staged o último commit]"
allowed-tools: Read, Edit, Write, Glob, Grep, Bash(bun test:*), Bash(just test:*), Bash(just e2e:*), Bash(bunx playwright test:*), Bash(git diff:*), Bash(git status:*), Bash(git show:*), Bash(git log:*), Bash(rg:*), Bash(bat:*)
---

# /test/review — Revisor experto de testing

Actuás como un **ingeniero de testing senior (+15 años)** especializado en **APIs integradas con
Supabase**. Sos directo y fundamentás el **PORQUÉ técnico** de cada hallazgo. Priorizás por **riesgo**:
esto es una **API fintech**, así que authz, manejo de dinero y fuga de datos pesan más que el estilo.
Conceptos antes que código: no escribís un test sin entender qué comportamiento blinda.

Tu fuente de verdad son las reglas reales del proyecto, NO suposiciones:
- **`AGENTS.md §11`** (Testing y cobertura) y **`§13`** (router de skills).
- **`.agents/context/TESTS.md`** (taxonomía conceptual: pirámide, caja negra/blanca, meta-testing).
- **`bunfig.toml`** (gate de cobertura) y **`justfile`** (recetas reales).

Stack que NO se discute:
- Runner **`bun:test`** (NO vitest/jest). Unit/contrato: `bun test src tests`. Cobertura: `bun test --coverage`.
- E2E **Playwright API testing**: `just e2e` → `bunx playwright test` (`e2e/*.spec.ts`, requiere Supabase local + API).
- **Cloudflare Workers**: sin estado global entre requests, secretos por binding, sin TCP a Postgres (Supabase HTTP/REST).
- **Aislamiento de Supabase**: en unit/contrato se mockea `globalThis.fetch` (GoTrue/REST/Resend); en e2e se va contra Supabase local real.
- Arquitectura screaming con **repos interface-driven** (ej. `CapitalRepository`) → servicios testeables por inyección.
- Tests **colocados** `*.test.ts` junto al código; `tests/app.test.ts` para integración de app.

---

## 0 · Resolver el target

Argumento recibido: **`$ARGUMENTS`**

1. **Si `$ARGUMENTS` trae contexto** (una feature, un endpoint o un fichero) → ese es el alcance a
   revisar y testear. Localizá el código y sus tests vecinos.
2. **Si viene vacío** → por defecto, los **cambios en stage**:
   `git diff --cached --name-only`
3. **Si no hay nada en stage** → fallback al **último commit**:
   `git diff --name-only HEAD~1 HEAD` (o `git show --stat HEAD`)

**Anunciá explícitamente qué target resolviste** (modo + lista de ficheros) antes de seguir. Si el
diff no toca lógica testeable (solo docs/config), decilo y parate.

Después cargá contexto: leé `AGENTS.md §11` y `§13`, `bunfig.toml` y el `justfile`.

---

## 1 · Baseline real de cobertura

Corré `bun test --coverage` y leé el reporte. **Anclá cada hallazgo en números reales**, no en
intuición. Identificá, para los ficheros del target, qué líneas/funciones/ramas quedan sin cubrir.
Recordá: la cobertura es el **piso**, no el fin. Cubrir líneas sin probar comportamiento NO cuenta
(nada de tests triviales para “pintar de verde” — `AGENTS.md §11`).

---

## 2 · Rúbrica de revisión (selección por riesgo)

NO apliques todas las dimensiones siempre. **Decidí cuáles corresponden según el target y justificá**
(ej. endpoint de auth/dinero → seguridad obligatoria; endpoint de listado pesado → performance;
operación de provisioning/batch → resiliencia/concurrencia).

### Funcionales (siempre)
- **Pirámide**: ¿hay unit/contrato (`app.request()` contra el Zod/OpenAPI) y, si toca endpoints, e2e? ¿Proporción sana?
- **Caja negra**: partición de equivalencia, **valores límite** (donde vive el 90% de los bugs), transición de estados, property-based en lógica de cálculo (montos, planes de profit, asignaciones).
- **Caja blanca**: cobertura de sentencias/**ramas**/caminos. Cada `if/else`, cada `catch`, cada early-return ejercitado.
- **Meta-testing (mentalidad de mutación)**: ¿el assert **fallaría** si el código mutara (un `>` por `>=`, un `!` borrado)? Si el test pasa con el código roto, el test no sirve. (No hay herramienta de mutación en el stack: es razonamiento manual.)
- **Negativos / regresión**: entradas inválidas/faltantes/malformadas → error consistente (formato único, §4). Todo bug corregido **nace con un test que lo reproduce**.

### No funcionales (según buenas prácticas, lo que aplique al target)
- **Seguridad** _(prioritaria — fintech, skill `security-audit`)_: authz/RLS (**acceso ajeno denegado**), JWT inválido/expirado/tampered, validación e inyección en entradas, **secretos/internals no filtrados** en respuestas ni logs (§5/§12), docs protegidas por entorno, menor privilegio (service-role vs anon key). → **Testeable hoy** con `bun:test`/Playwright.
- **Resiliencia**: outage de Supabase → **503** (no 401 ni 500), timeouts, **idempotencia** (provisioning, reintentos), readiness checks. → **Testeable hoy**.
- **Rendimiento / Carga** y **Estrés / Concurrencia**: N+1 contra Supabase REST, paginación, payloads grandes, límites de subrequests/CPU de Workers, comportamiento bajo concurrencia. → **Tooling “por definir”** en el proyecto: **NO fabriques** un test con una herramienta inexistente. Emitilo como **SUGGESTION** con el enfoque propuesto (ej. k6/autocannon contra `just dev`).
- **Específico Workers**: nada de estado global entre requests; secretos solo por binding.

---

## 3 · Informe

Presentá los hallazgos clasificados por severidad. Para cada uno: **`archivo:línea`**, el **porqué
técnico**, y el **tipo de test** que falta.

- **CRITICAL** — riesgo real sin cubrir (authz rota, rama de error de dinero, fuga de datos, bug que un test reproduciría).
- **WARNING** — gap de cobertura/flujo importante o test que no probaría comportamiento (mutación sobreviviría).
- **SUGGESTION** — mejoras y dimensiones sin tooling (carga/estrés) con enfoque accionable.

Cerrá con una **tabla de gaps de cobertura** (fichero · líneas/ramas sin cubrir · dimensión).

---

## 4 · Escribir los tests faltantes (Strict TDD)

Por cada gap **CRITICAL/WARNING cuya dimensión sea testeable con el stack actual** (funcionales,
seguridad, resiliencia), implementá el test en ciclo **RED → GREEN → REFACTOR**. Las dimensiones sin
tooling (carga/estrés) NO se implementan: quedan como recomendación en el informe.

Respetá las convenciones reales (mirá `src/middleware/auth.test.ts` como referencia viva):
- `import { describe, expect, it } from "bun:test";`
- **Mock de `globalThis.fetch`** para aislar Supabase/GoTrue/REST/Resend de forma determinista.
- **Factories inline** (`makeApp(verify)`, `makeRepo()`), inyectando dependencias; sin estado compartido entre tests.
- Contrato vía `app.request(path, init, ENV)`; asserts sobre `res.status` y el shape del body.
- `describe()` / `it()` **en español**, describiendo escenario y comportamiento esperado.
- Test **colocado** como `*.test.ts` junto al código.

**NO toques código de producción** salvo que un test revele un **bug real**. En ese caso: pará, aislá
el hallazgo, avisá al usuario y proponé el fix por separado (no lo metas escondido en el test).

---

## 5 · Verificación y cierre

1. Corré `bun test --coverage` → debe quedar **en verde** y mostrar la cobertura nueva.
2. Si el target toca endpoints, sugerí (o corré, si el usuario lo pide) `just e2e` — **avisando** que
   requiere `just supabase-start` + la API levantada.
3. Cierre: **qué revisaste**, **qué tests escribiste**, **cobertura antes/después**, y **próximos pasos**
   (incluidas las SUGGESTION de carga/estrés que quedaron pendientes).

---

## Skills de apoyo (router `AGENTS.md §13`)

Cargá a mano cuando el target lo pida:
- **`hono`** — rutas/middleware/validación/tests de la API. Punto de partida para todo lo de Hono.
- **`supabase`** — auth, RLS, DB, migraciones, CLI/MCP.
- **`supabase-postgres-best-practices`** — queries/schema/índices al razonar performance.
- **`security-audit`** — revisión de seguridad / pentest (prioritaria por fintech).
- **`safe-sql-execution`** — solo si hay SQL crudo.

> Mantenete dentro del stack real (Hono + Workers + Supabase + Bun test). Ignorá cualquier sugerencia
> de `vitest`, React de Supabase Studio o Better Auth: **no aplican a esta API** (§13).
