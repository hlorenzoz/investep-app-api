# API local sobre Bun para desarrollo / integración con Flutter.
# NO es el runtime de producción: en prod la API corre en Cloudflare Workers (workerd).
FROM oven/bun:alpine

WORKDIR /app

# Dependencias primero (capa cacheable mientras no cambie la lockfile).
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Código de la app.
COPY . .

EXPOSE 8787

# --watch da hot reload cuando se monta ./src como volumen (ver compose.yaml).
CMD ["bun", "run", "--watch", "src/server.ts"]
