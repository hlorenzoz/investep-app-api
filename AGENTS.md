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
- **pre-commit** gestiona los hooks de calidad (formato, lint, typecheck, secretos).
  Está integrado con [pre-commit.ci](https://pre-commit.ci/), que corre y autoarregla en
  cada PR. No te saltes los hooks (`--no-verify`) salvo emergencia justificada.
- **Tests con `bun test`.** Todo cambio de lógica de negocio debe llevar tests. Los
  endpoints REST se testean contra su definición de Zod OpenAPI Hono.

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

## 10. Contexto pendiente de confirmar

- Agregador elegido (SnapTrade vs Plaid).
- Rutas definitivas y política de exposición de la documentación (Scalar / Swagger UI) por entorno.
- Detalle de las recetas del Justfile y de la config de pre-commit.
