import { sleep } from "k6";
import http from "k6/http";
import { checkOk } from "./lib/checks.js";
import { BASE_URL } from "./lib/config.js";

/**
 * Smoke de carga SIN auth: liveness + readiness. Corre SIEMPRE (no requiere credenciales).
 * Sirve de gate base ("la API está arriba y responde bajo un poco de carga").
 */
export const options = {
  scenarios: {
    smoke: { executor: "constant-vus", vus: 2, duration: "30s" },
  },
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<300"],
    checks: ["rate>0.99"],
  },
};

export default function () {
  checkOk(http.get(`${BASE_URL}/health`));
  checkOk(http.get(`${BASE_URL}/health/ready`));
  sleep(1);
}
