# Investep API — Guía para agentes de IA

> Cómo un agente o cliente debe **interactuar** con la API REST de Investep. La **fuente de verdad**
> de los endpoints es el spec OpenAPI en `GET /openapi.json`; esta guía cubre las **convenciones**
> transversales que el spec no explica por sí solo.

## 1. Descubrir la API (empezá por acá)

- **OpenAPI 3.1**: `GET /openapi.json` — lista TODOS los endpoints, parámetros, schemas de
  request/response y códigos de error. Un agente debe **leer este spec** para conocer el contrato;
  no asumas endpoints que no estén ahí.
- UIs para humanos: `GET /reference` (Scalar) y `GET /docs` (Swagger UI), ambas sobre el mismo spec.
- En **production** la documentación está protegida: requiere `Authorization: Bearer <DOCS_TOKEN>`
  (en `development` está abierta).

## 2. Base URLs

| Entorno | Base URL |
|---|---|
| devel (local, Docker/Bun) | `http://localhost:8787` · emulador Android `http://10.0.2.2:8787` |
| staging | proyecto en Cloudflare Workers (`--env staging`) |
| production | proyecto en Cloudflare Workers (`--env production`) |

## 3. Autenticación

La API se apoya en **Supabase Auth (JWT)**. El cliente hace login con Supabase, obtiene el
`access_token` y lo envía en cada petición protegida:

```http
Authorization: Bearer <supabase_access_token>
```

En el spec OpenAPI el esquema figura como `bearerAuth` (HTTP bearer, formato JWT). El backend valida
el token; el cliente **no** habla con la base directo (eso lo hace la API con su service role).

## 4. Formato de error (único y estable)

**Toda** respuesta de error usa el mismo shape:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Mensaje legible.", "details": [] } }
```

| `code` | HTTP | Cuándo |
|---|---|---|
| `VALIDATION_ERROR` | 422 | Entrada inválida (incluye `details` con los issues de Zod) |
| `UNAUTHORIZED` | 401 | Falta o es inválido el token |
| `FORBIDDEN` | 403 | Sin permiso sobre el recurso |
| `NOT_FOUND` | 404 | Recurso inexistente |
| `CONFLICT` | 409 | Conflicto de estado (duplicado, etc.) |
| `INTERNAL_ERROR` | 500 | Error inesperado (sin filtrar internals) |
| `SERVICE_UNAVAILABLE` | 503 | Dependencia externa (p. ej. Supabase Auth) no disponible; reintentá |

`details` es opcional. La API **nunca** devuelve stack traces ni datos sensibles.

## 5. Convenciones

- **JSON** en request y response (`Content-Type: application/json`).
- **Validación**: toda entrada se valida con Zod en el borde → entrada inválida = `422` con `details`.
- **i18n**: el contenido multilingüe se pide con `?locale=es|en` (idioma base: `es`).
- **Brokers = SOLO LECTURA**: la API jamás coloca/modifica/cancela órdenes ni mueve fondos.

## 6. Endpoints disponibles hoy

| Método | Ruta | Auth | Respuesta |
|---|---|---|---|
| `GET` | `/health` | — | `200 { "status": "ok", "service": "investep-app-api", "timestamp": "…" }` |
| `GET` | `/health/ready` | — | `200 { "status": "ready", "checks": { "supabase": "up" } }` · `503` si degradado |
| `GET` | `/auth/me` | Bearer | `200 { "user": { "id": "…", "email": "…", "mustResetPassword": false } }` · `401` si falta o es inválido el token · `503` si no se puede verificar contra Supabase (outage; reintentá) |

> `GET /auth/me` valida el `Authorization: Bearer <token>` contra Supabase Auth y devuelve el usuario
> autenticado. Es el endpoint que un cliente usa para **confirmar** que su JWT es válido contra la API.
>
> Los dominios `plans`, `portfolio` y `brokers` están **planificados** (aún stubs). A medida
> que se implementen aparecerán automáticamente en `/openapi.json` — vuelve a leer el spec.

## 7. Reglas del proyecto

El comportamiento, la arquitectura y las políticas de seguridad están en
[`AGENTS.md`](../AGENTS.md). Un agente que **modifique** este repo debe leerlo entero (tipado
estricto, tests por implementación, observabilidad, fintech).
