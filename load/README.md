# Pruebas de carga (k6)

Carga/estrés contra la API levantada de verdad (stack Docker), separadas de `bun test` y de los
e2e de Playwright. Corren con [k6](https://k6.io) vía el bridge `scripts/k6-run.ts`, que lee
`.dev.vars` y pasa lo necesario por el **environment del proceso** (nunca por `-e` en la línea de
comando → los secretos no quedan en el history del shell).

## Prerrequisitos

1. **Stack arriba**: `just up` → levanta Supabase (self-hosting) + el servicio `api`
   publicado en `http://localhost:8787` + aplica migraciones. (La 1ra vez: `cp .env.example .env`.)
   Las recetas de carga NO levantan nada; tenés que tener el stack corriendo.
2. Para los escenarios **autenticados** (`load`, `load-stress`): un usuario sembrado
   (`just create-first-user`) y su password disponible — en `.dev.vars`
   (`BOOTSTRAP_ADMIN_PASSWORD`) o por env (`E2E_USER_EMAIL` / `E2E_USER_PASSWORD`).

## Recetas

| Receta | Auth | Qué hace |
|--------|------|----------|
| `just load-smoke` | No | `GET /health` + `/health/ready` con 2 VUs / 30s. Gate base, corre siempre. |
| `just load` | Sí | Carga sostenida (`ramping-vus`, 0→20→sostener 2m) sobre `/capital` y `/plans`. Valida N+1 bajo carga. |
| `just load-stress` | Sí | Estrés creciente (`ramping-arrival-rate`, hasta 200 RPS) para hallar el punto de saturación. |

## Variables (las inyecta `scripts/k6-run.ts`)

- `BASE_URL` — default `http://localhost:8787` (puerto publicado del servicio `api`).
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` — de `.dev.vars`; **host-reachables** (`127.0.0.1:54321`),
  NO la URL interna de Kong del contenedor. Se usan solo para obtener el token.
- `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` — credenciales del usuario de prueba (env gana sobre `.dev.vars`).
- La **service-role key NO se inyecta** (mínimo privilegio: los reads solo necesitan el JWT de usuario).

## Thresholds

- `smoke`: `http_req_failed < 1%`, `p(95) < 300ms`, `checks > 99%`.
- `load`: `http_req_failed < 1%`, `p(95) < 800ms` / `p(99) < 1500ms` por endpoint, `checks > 99%`.
- `stress`: más laxo (`http_req_failed < 5%`, `checks > 95%`) — el objetivo es ver el quiebre.

> Calibrá los umbrales con la **primera corrida** (la línea base local) y ajustalos a valores reales
> + margen. Los números de carga **local** (Supabase en Docker) **no se extrapolan** a staging/prod:
> volvé a correr allá apuntando `BASE_URL` (y credenciales) al entorno correspondiente.
