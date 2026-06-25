import http from "k6/http";
import { EMAIL, PASSWORD, SUPABASE_ANON_KEY, SUPABASE_URL } from "./config.js";

/**
 * Obtiene un access_token de Supabase GoTrue (password grant) — lo mismo que hace
 * signInWithPassword internamente. NUNCA loguea el token, la password ni el body completo
 * (AGENTS.md §5); ante fallo lanza un Error con guía accionable.
 */
export function getToken() {
  const res = http.post(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: { apikey: SUPABASE_ANON_KEY, "Content-Type": "application/json" } },
  );

  if (res.status !== 200) {
    throw new Error(
      `No se pudo obtener token (status ${res.status}). Revisá E2E_USER_EMAIL/E2E_USER_PASSWORD ` +
        "y que el usuario exista (just create-first-user).",
    );
  }

  const token = res.json("access_token");
  if (!token) throw new Error("La respuesta de auth no trajo access_token.");
  return token;
}
