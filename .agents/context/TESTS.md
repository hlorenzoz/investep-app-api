# Mapa de Estrategia de Testing — investep-app-api

Este documento define los tipos de tests aplicables a esta **API fintech** (Cloudflare Workers + Hono +
Supabase REST, TypeScript, Bun) y cómo deben usarse. Sirve como referencia conceptual para agentes de IA
y desarrolladores al diseñar o escribir pruebas.

> **Fuente de verdad operativa:** las reglas estrictas (objetivo de cobertura, comandos, qué se gate-ea)
> viven en **`AGENTS.md §11`**. Este mapa es el marco conceptual; ante conflicto, manda `AGENTS.md`.

---

## 1. Según el Alcance del Código (Pirámide de Testing)

### A. Tests Funcionales

| Tipo | Qué prueba | Herramienta en este proyecto |
|------|-----------|-------------------------------|
| **Unitarios** | Mínima unidad (función, servicio) de forma aislada, con dependencias inyectadas/mockeadas | `bun:test` (`bun test src tests`) |
| **De Contrato** | Cada endpoint contra su definición **Zod/OpenAPI** (status, shape, validación de entrada) | `bun:test` vía `app.request()` |
| **De Integración** | Comunicación entre módulos/servicios y Supabase (REST/GoTrue) | `bun:test` con mock de `globalThis.fetch` |
| **E2E (Extremo a Extremo)** | Flujo completo contra la API levantada de verdad + Supabase real | **Playwright API testing** (`just e2e`, `e2e/*.spec.ts`) |
| **De Aceptación (UAT)** | Validación final por negocio de que cumple los requisitos | Manual / Playwright |

### B. Tests No Funcionales

| Tipo | Qué prueba | Herramienta en este proyecto |
|------|-----------|-------------------------------|
| **De Rendimiento — Carga** | Comportamiento bajo tráfico esperado (N+1 a Supabase REST, paginación, payloads grandes) | Por definir (ej. k6/autocannon contra `just dev`) |
| **De Rendimiento — Estrés** | Comportamiento al límite (concurrencia, subrequests/CPU de Workers) | Por definir |
| **De Seguridad** | Vulnerabilidades, inyecciones, authz/RLS, JWT, fuga de datos/secretos | skill `security-audit` / `bun:test` / manual |
| **De Accesibilidad (a11y)** | — | **N/A** (API sin UI) |

### C. Mantenimiento y Diseño

| Tipo | Qué prueba | Herramienta en este proyecto |
|------|-----------|-------------------------------|
| **De Regresión** | Que los cambios nuevos no rompen lo existente; todo bug nace con un test que lo reproduce | `bun:test` (suite completa, gate en `pre-push` de `devel`) |
| **Visuales (Regresión Visual)** | — | **N/A** (API sin UI) |

---

## 2. Según la Estrategia de Diseño (Caja Negra vs. Caja Blanca)

### A. Tests de Comportamiento e Inputs (Caja Negra)

Se centran en el **qué hace** el software ante diferentes datos, ignorando cómo está programado por dentro.

| Técnica | Descripción | Cuándo aplicarla |
|---------|-------------|-----------------|
| **Partición de Equivalencia** | Agrupar inputs en clases con comportamiento idéntico para evitar pruebas redundantes | Validación Zod de entrada, reglas de negocio con rangos |
| **Análisis de Valores Límite** | Probar los extremos de rangos válidos e inválidos (donde ocurre el 90% de los bugs) | IDs, montos/capital, fechas, targets de planes de profit |
| **Tablas de Transición de Estados** | Cómo responde el sistema según su estado previo | Flujos de auth (login → reset obligatorio), provisioning idempotente, asignaciones a brokers |
| **Basados en Propiedades (Property-Based)** | Generación de inputs aleatorios bajo reglas para intentar romper el código | Lógica de cálculo (montos, distribución de capital, profit) |

### B. Tests de Flujo y Estructura (Caja Blanca)

Se centran en el **cómo está escrito**, asegurando que la ejecución recorra todos los caminos posibles.

| Técnica | Descripción | Cuándo aplicarla |
|---------|-------------|-----------------|
| **Cobertura de Sentencias** | Cada línea se ejecuta al menos una vez | Piso mínimo en módulos nuevos |
| **Cobertura de Ramas (Branch Coverage)** | Todos los caminos de bifurcación (`if/else`, `switch`, `catch`, early-return) | Objetivo estándar — cada rama de error de un endpoint/servicio |
| **Cobertura de Caminos (Path Coverage)** | Todas las combinaciones en algoritmos con bucles o condicionales anidados | Lógica de cálculo de capital/profit, mapeo de errores |
| **Flujo de Datos** | Rastrear el ciclo de vida de variables (creación, modificación, uso) | Servicios con múltiples pasos encadenados sobre el repositorio |

---

## 3. Meta-Testing (Probar los Tests)

| Técnica | Descripción | Herramienta en este proyecto |
|---------|-------------|-------------------------------|
| **Mentalidad de Mutación** | ¿El assert **fallaría** si el código mutara (un `>` por `>=`, un `!` borrado, un status cambiado)? Si el test sigue en verde con el código roto, el test no es efectivo. | Razonamiento **manual** (no hay herramienta de mutación nativa en Bun/TS; **Stryker — por evaluar**) |

---

## Aplicación en este Proyecto

- **Objetivo de cobertura**: **95% de código (líneas y funciones) y de flujos (cada rama, cada caso de
  error)** según `AGENTS.md §11`. La cobertura es el **piso**, no el fin: cubrir líneas sin probar
  comportamiento NO cuenta. Nada de tests triviales para "pintar de verde".
- **Gate de cobertura**: configurado en `bunfig.toml` (`coverageThreshold`, `line`/`function` al **95%**),
  alineado con `AGENTS.md §11`. Se evalúa **solo con `--coverage`**, en el **`pre-push` de la branch
  `devel`** (`scripts/coverage-devel.sh` → `bun test --coverage`). El resto de las branches no se gate-ea.
- **Comandos**:
  - Unit/contrato/integración: **`bun test src tests`** (mocká dependencias externas de forma determinista).
  - E2E: **`just e2e`** (Playwright API testing — `e2e/*.spec.ts`, queda **fuera** de `bun test`; requiere
    `just supabase-start` + la API levantada).
- **Strict TDD activo**: todo cambio lleva tests **en la misma entrega**, en ciclo RED → GREEN → REFACTOR.
- **Convenciones reales** (referencia viva: `src/middleware/auth.test.ts`):
  - `import { describe, expect, it } from "bun:test";` — `describe()`/`it()` **en español**.
  - **Mock de `globalThis.fetch`** para aislar Supabase/GoTrue/REST/Resend.
  - **Factories inline** (`makeApp(verify)`, `makeRepo()`) inyectando dependencias; sin estado compartido.
  - Contrato vía `app.request(path, init, ENV)`; asserts sobre `res.status` y el shape del body.
  - Tests **colocados** `*.test.ts` junto al código (`tests/app.test.ts` para integración de app).
- **Prohibido**: tocar código de producción desde un test; si un test revela un bug real, aislarlo y
  proponer el fix por separado. Ignorar herramientas de fuera del stack (`vitest`, etc. — `AGENTS.md §13`).
- **Skills de apoyo** (`AGENTS.md §13`): `hono`, `supabase`, `supabase-postgres-best-practices`,
  `security-audit`, `safe-sql-execution`.
