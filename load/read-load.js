import { group, sleep } from "k6";
import http from "k6/http";
import { getToken } from "./lib/auth.js";
import { checkOk } from "./lib/checks.js";
import { BASE_URL, hasCreds } from "./lib/config.js";

/**
 * Carga SOSTENIDA sobre los endpoints de lectura (/capital, /plans). Valida bajo carga
 * real que no haya N+1 (latencia/throughput estables al subir VUs) y que el contrato se
 * mantenga. Requiere credenciales (escenario autenticado).
 */
export const options = {
  scenarios: {
    read_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 20 },
        { duration: "2m", target: 20 },
        { duration: "30s", target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{group:::capital}": ["p(95)<800", "p(99)<1500"],
    "http_req_duration{group:::plans}": ["p(95)<800", "p(99)<1500"],
    checks: ["rate>0.99"],
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
  sleep(1);
}
