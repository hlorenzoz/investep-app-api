# Deploy checklist — staging / production

Pasos de infraestructura que NO viven en el repo y deben ejecutarse una vez por
entorno antes del primer deploy (y verificarse ante cualquier cambio de cuenta).

## 1. KV namespaces (bloqueante)

`wrangler.jsonc` tiene IDs placeholder (`REPLACE_WITH_*`). Crear y pegar los reales:

```bash
bunx wrangler kv namespace create CACHE --env staging
bunx wrangler kv namespace create CACHE --env production
```

Cada comando imprime el `id` → reemplazar `REPLACE_WITH_STAGING_KV_ID` y
`REPLACE_WITH_PRODUCTION_KV_ID` en `wrangler.jsonc` (y el del top-level si se usa
`wrangler dev` remoto). Sin esto, el caché de projections no funciona.

## 2. R2 buckets

```bash
bunx wrangler r2 bucket create investep-documents-staging
bunx wrangler r2 bucket create investep-documents
```

## 3. Secrets (por entorno)

```bash
# Repetir con --env staging y --env production (valores del proyecto Supabase correspondiente)
bunx wrangler secret put SUPABASE_URL --env production
bunx wrangler secret put SUPABASE_ANON_KEY --env production
bunx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
bunx wrangler secret put RESEND_API_KEY --env production
bunx wrangler secret put RESEND_FROM --env production
bunx wrangler secret put CORS_ORIGINS --env production
bunx wrangler secret put DOCS_TOKEN --env production
```

- **`CORS_ORIGINS` es obligatorio en producción**: el CORS es fail-closed — sin esta
  variable, NINGÚN frontend puede consumir la API desde el browser. Formato
  coma-separado: `https://app.investep.com,https://admin.investep.com`.
- **`DOCS_TOKEN`**: sin él, `/docs`, `/reference` y `/openapi.json` devuelven 404 en
  producción (bloqueo total). Con él, requieren `Authorization: Bearer <DOCS_TOKEN>`.
  Usar un token largo y aleatorio (`openssl rand -base64 32`).

## 4. Rate limiting

Los bindings `AUTH_RATE_LIMITER` / `ADMIN_WRITE_RATE_LIMITER` ya están en
`wrangler.jsonc` (no requieren crear recursos). Verificar tras el deploy que un burst
de >60 requests/min a `/auth/me` desde una misma IP devuelve `429 RATE_LIMITED`.
Capa extra opcional: reglas de rate limiting del dashboard de Cloudflare (WAF).

## 5. JWT: signing keys asimétricas en Supabase (performance)

La verificación de tokens usa `getClaims`: si el proyecto Supabase tiene **signing
keys asimétricas** (Dashboard → Authentication → Signing Keys), la validación es
100% local en el Worker (cero round-trips por request). Si el proyecto sigue en
HS256 (legacy), cada request paga una llamada a GoTrue — funciona igual, pero migrar
las keys es la mejora de latencia más barata disponible.

## 6. Deploy

```bash
bunx wrangler deploy --env staging    # primero staging
bunx wrangler deploy --env production
```

Smoke test post-deploy:

```bash
curl https://<worker-url>/health          # 200 {"status":"ok"}
curl https://<worker-url>/health/ready    # 200 {"status":"ready"} (Supabase alcanzable)
curl https://<worker-url>/openapi.json    # 404 (sin DOCS_TOKEN) o 401 (configurado, sin Bearer)
```
