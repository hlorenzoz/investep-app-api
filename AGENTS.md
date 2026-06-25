# AGENTS.md — investep-app-api

> Guía para agentes de IA (Claude Code, Cursor, etc.) que trabajen en este repositorio.
> Léelo entero antes de modificar código.

## 1. Qué es este proyecto

`investep-app-api` es la **API REST** de Investep App, una aplicación del ecosistema de
[Investep Academy](https://investepacademy.com/) orientada a inversión y seguimiento de
carteras. Esta API es el backend central que consumen el resto de clientes (app Flutter y
sitio web SvelteKit).

La API expone, principalmente:
- Autenticación y gestión de sesión (apoyada en Supabase Auth).
- Datos de planes de inversión y contenido de la academia.
- Datos de cartera de los usuarios: saldos, posiciones, órdenes y transacciones,
  obtenidos en **solo lectura** desde brókers de terceros (IBKR, TastyTrade, eTrade)
  a través de un agregador (SnapTrade / Plaid).

## 2. Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Framework | **Hono** (TypeScript), estilo **API REST** |
| Validación + contrato API | **Hono OpenAPI** / **Zod OpenAPI Hono** (`@hono/zod-openapi`) |
| Documentación de API | **Scalar** (`@scalar/hono-api-reference`) + **Swagger UI** (`@hono/swagger-ui`) |
| Runtime / despliegue | **Cloudflare Workers** vía **Wrangler** |
| Base de datos / Auth / Storage | **Supabase** (PostgreSQL) |
| Caché | Cloudflare KV |
| Archivos / documentos | Cloudflare R2 |
| Trabajos programados | Cloudflare Cron Triggers / Queues |
| Gestor de paquetes / runtime de tooling | **Bun** (NO npm) |
| Runner de tareas | **Justfile** (`just`) |
| Hooks de calidad | **pre-commit** + [pre-commit.ci](https://pre-commit.ci/) |
| Tests | **Bun test** (`bun test`) |

## 3. Reglas de la plataforma (Cloudflare Workers)

Estas restricciones son del runtime y **no son negociables**:

- **No hay servidor de larga vida.** No asumas estado en memoria entre peticiones.
- **Límite de tiempo de CPU por invocación.** No metas cómputo pesado (análisis
  cuantitativo, ingestas masivas) en el handler de una petición. Sácalo a **Queues**,
  a un **Cron Trigger**, o a un servicio aparte.
- **Conexiones a Postgres:** Workers no mantiene conexiones TCP persistentes. Conéctate
  a Supabase vía su **cliente HTTP/REST**, o usa **Hyperdrive** para el pooling. No abras
  conexiones TCP directas a Postgres desde el handler.
- **WebSockets / streaming en tiempo real:** no encajan en un Worker normal. Usa
  **Durable Objects** o un servicio externo si hace falta streaming de datos de cuenta.
- Las claves y secretos van como **secrets de Wrangler / variables de entorno**, nunca
  en el código ni commiteados.
- **Wrangler** es la herramienta oficial para dev local, secrets y despliegue. Invócala
  vía Bun (`bunx wrangler ...`) o, preferiblemente, a través de las recetas del Justfile.

## 4. Convenciones de código

- **TypeScript estricto.** Nada de `any` salvo justificación explícita.
- **Contrato primero (API-first).** La API es **REST** y cada endpoint se define con
  **Zod OpenAPI Hono** (`@hono/zod-openapi`): esquema Zod → tipos → ruta tipada → spec
  OpenAPI. El spec OpenAPI generado es la **fuente de verdad** que consumen los clientes
  Flutter y SvelteKit. No definas rutas con el router plano de Hono si la ruta forma
  parte del contrato público: usa `OpenAPIHono` y `createRoute`.
- Valida **toda** entrada externa con Zod en el borde de la petición.
- Respuestas de error consistentes (formato único de error con código y mensaje).
- Organiza por dominio/feature (auth, plans, portfolio, brokers), no por tipo técnico.
- No hay tipos compartidos con Flutter (Dart); sí conviene mantener alineado el spec
  OpenAPI para que el cliente Dart se genere/actualice contra él.

### Calidad, documentación y refactorización del código (estricto)

Esta es una API fintech: el código se **blinda**. No negociable:

- **Tests con CADA implementación (obligatorio).** Toda implementación o cambio de código se entrega
  **junto con sus tests** en la misma tanda — sin excepción. Una feature/fix sin sus tests está
  **incompleta** y no se mergea. El detalle de qué cubrir está en §11.
- **Tipado total.** TypeScript estricto, **sin `any`** (`noExplicitAny` es error en Biome).
  Tipá entradas, salidas y errores. Derivá tipos del schema (Zod, `database.types.ts`) en vez de
  redeclararlos a mano.
- **Documentado con estándar.** Cada módulo, función pública y tipo no trivial lleva **TSDoc**
  (`/** … */`) que explica el QUÉ y el PORQUÉ (no el cómo obvio); documentá decisiones no evidentes
  y gotchas. Las rutas se documentan vía el schema OpenAPI (`summary`/`description`/`example`).
- **Optimizado para Workers.** Sin trabajo redundante en el handler; respetá los límites de CPU
  (§3). Nada de cómputo pesado ni N+1 contra Supabase.
- **Refactorizado y testable.** Funciones chicas, una responsabilidad, sin efectos secundarios
  ocultos. Inyectá dependencias (cliente Supabase, `env`) en vez de instanciarlas adentro: así se
  testean. **Si algo es difícil de testear, está mal diseñado → refactorizá.**
- **Sin bugs introducidos.** Todo cambio compila (`tsc`), pasa lint (`biome`) y tests **antes** de
  commitear/pushear (lo fuerzan los hooks). No se mergea código en rojo.
- **DRY y consistente.** Reutilizá `lib/`, `schemas/` y el formato único de error. Seguí el patrón
  de `features/health/`.

### Documentación de la API (OpenAPI → Scalar + Swagger UI)

El contrato OpenAPI generado por **Hono OpenAPI** alimenta directamente la documentación;
no se mantiene a mano:

- **Spec OpenAPI:** se expone vía `app.doc(...)` (o `app.getOpenAPIDocument()`) en una
  ruta JSON, p. ej. `/openapi.json`. Es la fuente única para documentación y para generar
  el cliente Dart de Flutter.
- **Scalar** (`@scalar/hono-api-reference`) es la **referencia de API principal** (UI
  moderna), montada p. ej. en `/reference`, apuntando al spec anterior.
- **Swagger UI** (`@hono/swagger-ui`) se ofrece como vista alternativa/clásica, p. ej. en
  `/docs`, contra el mismo spec.
- Ambas UIs leen el **mismo** `/openapi.json`: cualquier endpoint nuevo definido con
  `createRoute` aparece automáticamente en las dos. No edites la documentación al margen
  del código.
- **No expongas la documentación ni el spec públicamente sin control.** Al ser una API
  fintech, protege `/openapi.json`, `/reference` y `/docs` (deshabilitar en producción,
  o tras autenticación / restricción por entorno). Decídelo de forma consciente.

## 5. Seguridad y datos sensibles (CRÍTICO — fintech)

Este servicio maneja datos financieros y de cartera de terceros. Trátalos en
consecuencia:

- **Tokens OAuth de brókers/agregador → siempre cifrados en reposo.** Nunca en logs,
  nunca en texto plano, nunca en respuestas de la API.
- **Acceso a cuentas de brókers es SOLO LECTURA.** No implementes endpoints que
  coloquen, modifiquen o cancelen órdenes, ni que muevan fondos, salvo que se cambie
  explícitamente el alcance del producto (decisión de producto + legal, no de un agente).
- **GDPR (usuarios en la UE):** minimiza datos almacenados, respeta consentimiento,
  permite borrado. No guardes más datos de cartera de los necesarios.
- **Datos de mercado:** respeta las restricciones de redistribución de cada bróker/
  proveedor. No reexpongas datos licenciados a terceros sin base para ello.
- Nunca registres en logs: tokens, credenciales, datos de cuenta identificables.

## 6. Integración con brókers (vía agregador)

- La estrategia por defecto es integrar **un agregador** (SnapTrade / Plaid), no cada
  bróker por separado.
- Flujo: el usuario autoriza vía OAuth → recibimos callback → guardamos el token
  cifrado (Supabase) → consultamos saldos/posiciones bajo demanda o en sincronizaciones
  programadas (Cron/Queues).
- Los refrescos periódicos de cartera van en **Cron Triggers / Queues**, nunca bloqueando
  una petición de usuario.

## 7. Tooling y flujo de trabajo

- **Bun es el gestor de paquetes y runtime de tooling. NO uses npm/npx/yarn/pnpm.**
  Instala con `bun install`, ejecuta binarios con `bunx`.
- **Justfile** es el punto de entrada único para tareas. Antes de inventar un comando,
  mira el `justfile`; si una tarea es habitual, añádele una receta en vez de documentar
  un comando suelto.
- **pre-commit es el ÚNICO pipeline de calidad — NO usamos GitHub Actions.** Corre en cada
  branch, en dos etapas: `pre-commit` (al commitear: formato, lint con Biome, typecheck con `tsc`,
  secretos con gitleaks) y `pre-push` (al pushear: `bun test`; cobertura **solo en `devel`**; deploy
  a Cloudflare Workers **solo en `staging`**).
  Instalá ambos hooks una vez: `pre-commit install --install-hooks`. No te saltes los hooks
  (`--no-verify`) salvo emergencia justificada. [pre-commit.ci](https://pre-commit.ci/) complementa
  en PRs, pero su entorno NO tiene Bun → los hooks de Biome/tsc/tests corren **localmente** (por eso
  van en `ci.skip`). El detalle de tests y cobertura está en §11.
- **Deploy a `staging`: automático en el `pre-push`.** Al pushear a `staging`, si pasan los tests, el
  hook `deploy-staging` (`scripts/deploy-staging.sh`) verifica que existan los secrets del Worker y
  corre `wrangler deploy --env staging`. Como ocurre en el pre-push, el push **solo se completa si el
  deploy funcionó**. Requiere `CLOUDFLARE_API_TOKEN` en el entorno (o `wrangler login`).
  **`production` se despliega a mano** (`just deploy-production`).

## 8. Comandos habituales

> Preferir siempre las recetas del Justfile. Actualiza esta sección al inicializar el repo.

```bash
# Instalar dependencias
bun install

# Recetas comunes (vía Just)
just dev          # wrangler dev (desarrollo local)
just test         # bun test
just lint         # lint + typecheck
just docs         # servir/abrir la referencia (Scalar en /reference, Swagger UI en /docs)
just deploy       # wrangler deploy

# Equivalentes directos si hace falta
bunx wrangler dev
bun test
bunx wrangler deploy

# Hooks
pre-commit run --all-files
```

## 9. Qué NO hacer

- No uses **npm / npx / yarn / pnpm**: este proyecto es **Bun**.
- No documentes ni ejecutes comandos sueltos si pueden ser una receta del Justfile.
- No te saltes los hooks de pre-commit con `--no-verify`.
- No definas rutas públicas fuera del contrato Hono OpenAPI / Zod OpenAPI Hono.
- No edites la documentación (Scalar/Swagger UI) a mano: se genera del spec OpenAPI.
- No expongas `/openapi.json`, `/reference` ni `/docs` públicamente sin control en producción.
- No metas lógica pesada/larga en un handler de petición.
- No abras conexiones TCP persistentes a Postgres desde el Worker.
- No implementes ejecución de órdenes ni movimiento de fondos.
- No commitees secretos ni tokens.
- No loguees datos financieros o credenciales.
- No tomes decisiones de alcance regulatorio/legal por tu cuenta: márcalo para revisión humana.
- No commitees/pushees código que no compile, no pase lint o no tenga tests: los hooks lo frenan.
- No bajes la cobertura ni desactives el gate de `devel` para “que pase”.
- No uses `console.log` crudo ni loguees sin estructura: usá logging estructurado (§12).
- No introduzcas `any` ni tipos laxos para esquivar el tipado estricto.

## 10. Contexto pendiente de confirmar

- Agregador elegido (SnapTrade vs Plaid).
- Rutas definitivas y política de exposición de la documentación (Scalar / Swagger UI) por entorno.
- Detalle de las recetas del Justfile y de la config de pre-commit.

## 11. Testing y cobertura (CRÍTICO — blindaje)

La API se blinda con tests. Reglas **estrictas**:

- **Objetivo: 95% de cobertura** — de **código** (líneas y funciones) y de **flujos** (cada rama,
  cada caso de error). La cobertura es el piso, no el fin: cubrir líneas sin probar comportamiento no
  cuenta. Nada de tests triviales para “pintar de verde”.
- **Todo cambio lleva tests en la misma entrega.** Si tocás lógica, agregás/ajustás sus tests.
- **Tipos de test a cubrir** (los que apliquen al cambio):
  - **Caja blanca / unitarios:** ramas internas, condiciones límite, manejo de errores.
  - **Funcionales / de contrato:** cada endpoint contra su definición Zod OpenAPI (status, shape,
    validación de entrada) vía `app.request()`.
  - **Negativos / negación:** entradas inválidas, faltantes o malformadas → error consistente (§4).
  - **Seguridad:** authz/RLS (acceso ajeno denegado), docs protegidas por entorno, que no se filtren
    datos sensibles en respuestas ni logs.
  - **Regresión:** todo bug corregido nace con un test que lo reproduce.
  - **E2E / integración:** Playwright **API testing** (`just e2e`, dir `e2e/`) contra la API
    levantada de verdad + Supabase real. Hoy cubre health; crece con los endpoints de negocio.
- **Verificación de cobertura:** corre en el **`pre-push` de la branch `devel`**
  (`scripts/coverage-devel.sh` → `bun test --coverage`). El umbral (95% líneas y funciones) se activa
  en `bunfig.toml` (`coverageThreshold`). En el resto de las branches no se gate-ea.
- Unit/contrato con **`bun test src tests`** (mocká dependencias externas de forma determinista);
  E2E con **`just e2e`** (Playwright API testing — `e2e/*.spec.ts`, queda fuera de `bun test`).

## 12. Observabilidad y logging (CRÍTICO — fintech)

- **Observabilidad activada** en `wrangler.jsonc` (`observability.enabled`). Usala.
- **Logging estructurado**, nunca `console.log` suelto. Logueá eventos con contexto (entorno, ruta,
  identificador de request), priorizando **errores** y **eventos de seguridad** (acceso no
  autorizado, validaciones fallidas sospechosas, fallos de authz, uso de la service-role).
- **Ante errores:** el `error-handler` central registra el fallo con contexto suficiente para
  diagnosticar y responde el **formato único de error** (§4) **sin filtrar internals** al cliente.
- **Eventos de seguridad** se loguean explícitamente para auditoría (login fallido, acceso denegado,
  rate-limit, etc.).
- **NUNCA loguear** (§5): tokens, credenciales, keys, JWTs, ni datos de cuenta/cartera
  identificables. Ante la duda, no lo loguees: sanitizá antes de registrar.

## 13. Router de skills de IA (cuándo usar cada una)

Las skills viven en `.claude/skills/` (la mayoría son symlinks a `.agents/skills/`) más algún
directorio propio. **Ambos directorios están gitignored**: solo se versiona `skills-lock.json`
(manifiesto con origen + hash de cada skill sincronizada desde GitHub). Una skill se carga
**automáticamente** cuando el contexto matchea su `description`/trigger, o **a mano** con
`/nombre-skill`.

> El inventario se podó a propósito: solo quedan skills del stack real (Hono + Workers + Supabase +
> **Bun test**). Se quitaron las que venían en el bundle pero eran de otros proyectos (frontend React
> de **Supabase Studio**, Vercel, `vitest`) o de otra librería de auth (**Better Auth** — acá usamos
> **Supabase Auth**). Si reaparecen, no las sigas: confirmá que apliquen a **esta** API antes.

| Skill | Cuándo usarla |
|-------|---------------|
| `hono` | Crear/editar rutas, middleware, validación, JSX o tests de Hono; cualquier import de `hono`/`hono/*`. **Punto de partida** para todo lo de la API. |
| `hono-api-scaffolder` | Andamiar un endpoint nuevo en Workers: archivo de ruta + binding tipado + Zod + manejo de error + doc. Respetá el contrato OpenAPI (§4). *(claude-code-only)* |
| `hono-cloudflare` | Referencia de bindings de Workers (KV, R2, D1, Durable Objects) y patrones edge al montar Hono. *(Reference: trae `disable-model-invocation` → no se auto-invoca, consultala a mano.)* |
| `supabase` | CUALQUIER tarea de Supabase: DB, Auth, Storage, Realtime, RLS, migraciones, CLI/MCP. |
| `supabase-server` | **Antes** de escribir/editar handlers que importen `@supabase/server` (`withSupabase`, `verifyAuth`, modos `auth:`) o al migrar patrones legacy (`Deno.serve`, `SUPABASE_SERVICE_ROLE_KEY`). Hoy `src/` aún no lo importa → relevante en cuanto agregues verificación de auth de entrada. |
| `supabase-postgres-best-practices` | Escribir u optimizar queries Postgres, diseño de schema, índices, migraciones, planes de ejecución. |
| `security-audit` | Revisión de seguridad / pentest: buscar vulnerabilidades explotables con impacto real. **Prioritaria** por ser fintech (§5). |
| `safe-sql-execution` | Ejecutar SQL crudo contra la DB sin riesgo de inyección (parametrización, validación de entrada). Solo si hay SQL crudo. |
