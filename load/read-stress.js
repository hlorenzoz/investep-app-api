import { group } from "k6";
import http from "k6/http";
import { getToken } from "./lib/auth.js";
import { checkOk } from "./lib/checks.js";
import { BASE_URL, hasCreds } from "./lib/config.js";

/**
 * ESTRÉS creciente (arrival-rate: RPS fijo que sube) sobre los endpoints de lectura.
 * Objetivo: ENCONTRAR el punto de saturación, no necesariamente pasar todos los thresholds.
 * Mirá p(95)/p(99) y http_req_failed por etapa para ver dónde se degrada. Requiere credenciales.
 */
export const options = {
  scenarios: {
    read_stress: {
      executor: "ramping-arrival-rate",
      startRate: 10,
      timeUnit: "1s",
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: "1m", target: 50 },
        { duration: "1m", target: 100 },
        { duration: "1m", target: 200 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.05"],
    checks: ["rate>0.95"],
  },
};

export function setup() {
  if (!hasCreds) {
    throw new Error(
      "Escenario autenticado bloqueado: faltan credenciales. Seteá E2E_USER_EMAIL/E2E_USER_PASSWORD " +
        "o poblá .dev.vars + just create-first-user.",
    );
  }
  return { token: getToken() };
}

export default function (data) {
  const params = { headers: { Authorization: `Bearer ${data.token}` } };
  group("capital", () => {
    checkOk(http.get(`${BASE_URL}/capital`, params));
  });
  group("plans", () => {
    checkOk(http.get(`${BASE_URL}/plans`, params));
  });
}
