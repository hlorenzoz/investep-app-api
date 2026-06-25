import { check } from "k6";

/** Check estándar: status esperado + body JSON parseable. Devuelve true si todo pasó. */
export function checkOk(res, expectedStatus = 200) {
  return check(res, {
    [`status ${expectedStatus}`]: (r) => r.status === expectedStatus,
    "body es JSON": (r) => {
      try {
        r.json();
        return true;
      } catch {
        return false;
      }
    },
  });
}
