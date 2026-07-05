/**
 * Dominio: PROJECTIONS — serie "Desempeño vs Plan" de una cuenta de bróker.
 *
 * Cálculo PURO (sin I/O): dado un monto inicial, una fecha de inicio, un tipo de
 * cuenta y la tasa del plan, proyecta el interés compuesto y lo agrupa por período.
 *
 * Modelo canónico (decidido con el usuario): se compone UNA sola serie por día
 * hábil y las 4 vistas (diario/semanal/mensual/anual) son re-buckets de esa misma
 * serie → todas convergen al mismo saldo para el mismo horizonte. Esto corrige los
 * bugs del cálculo previo del frontend (vistas que se contradecían, drift de fechas,
 * arrastre de redondeo).
 *
 * Calendario sintético de trading: 5 días hábiles/semana, 20/mes, 240/año.
 *
 * Tasa por día hábil `r`:
 *   - Activos (equity): `r = (1 + mensual/100)^(1/20) − 1`. ⇒ 20 días = exactamente
 *     el mensual del plan; 240 días = `(1+mensual/100)^12` (compuesto anual).
 *   - Opciones (options): `r = 0.10 × (diario/100)`. Cada día se invierte el 10% del
 *     capital actual buscando la tasa diaria del plan sobre esa inversión.
 *
 * Balance a `n` días: `B(n) = base × (1 + r)^n` (se evalúa con `pow`, sin iterar, para
 * NO arrastrar redondeo). Se redondea solo al serializar.
 */

export type ProjectionGrouping = "daily" | "weekly" | "monthly" | "yearly";
export type ProjectionAccountType = "equity" | "options";

export interface ProjectionPeriod {
  /** 1..N dentro de la serie devuelta. */
  periodIndex: number;
  /** Etiqueta lista para render: "1 Jul" (diario), "Semana 1", "Ago 26" (mensual), "2027" (anual). */
  label: string;
  /** Fecha real del primer día del bucket, ISO `YYYY-MM-DD`. */
  date: string;
  startBalance: number;
  yieldAmount: number;
  endBalance: number;
}

export interface BuildProjectionInput {
  /** Monto inicial de la cuenta de bróker. */
  baseAmount: number;
  /** Fecha de inicio de la cuenta (ancla de la serie). */
  startDate: Date;
  grouping: ProjectionGrouping;
  accountType: ProjectionAccountType;
  /** Tasa del plan en %. Equity: mensual (25/50/100). Options: diaria (35/50). */
  ratePct: number;
  /** Override del horizonte en años (default por vista). */
  years?: number;
}

/** Días hábiles que abarca cada bucket de una vista. */
const BUCKET_TRADING_DAYS: Record<ProjectionGrouping, number> = {
  daily: 1,
  weekly: 5,
  monthly: 20,
  yearly: 240,
};

/** Buckets por año de cada vista (240 días hábiles / tamaño del bucket). */
const PERIODS_PER_YEAR: Record<ProjectionGrouping, number> = {
  daily: 240,
  weekly: 48,
  monthly: 12,
  yearly: 1,
};

/** Horizonte por defecto (años) de cada vista; replica las ventanas del cliente actual. */
const DEFAULT_YEARS: Record<ProjectionGrouping, number> = {
  daily: 1,
  weekly: 1,
  monthly: 3,
  yearly: 5,
};

const MONTHS_ES = [
  "Ene",
  "Feb",
  "Mar",
  "Abr",
  "May",
  "Jun",
  "Jul",
  "Ago",
  "Sep",
  "Oct",
  "Nov",
  "Dic",
];

/** Redondeo monetario estable a 2 decimales (evita el sesgo binario de toFixed). */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/** Fracción del capital que una cuenta de opciones arriesga por día (el 10% del total). */
export const OPTIONS_RISK_FRACTION = 0.1;

/**
 * Tasa de compounding por día hábil de ACTIVOS: raíz 20 del mensual, de modo que 20 días
 * hábiles componen EXACTAMENTE el mensual del plan. `monthlyPct` en % (ej. 25).
 */
export function equityDailyRate(monthlyPct: number): number {
  return (1 + monthlyPct / 100) ** (1 / 20) - 1;
}

/**
 * Tasa de compounding por día hábil de OPCIONES: cada día se invierte el 10% del capital
 * actual a la tasa diaria del plan ⇒ `total ×= 1 + 0.10·diario`. `dailyPct` en % (ej. 35).
 */
export function optionsDailyRate(dailyPct: number): number {
  return OPTIONS_RISK_FRACTION * (dailyPct / 100);
}

/** Selecciona la fórmula de tasa diaria según el tipo de cuenta. */
function dailyRate(accountType: ProjectionAccountType, ratePct: number): number {
  return accountType === "options" ? optionsDailyRate(ratePct) : equityDailyRate(ratePct);
}

function addUtcDays(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 86_400_000);
}

/** Suma `n` meses calendario preservando el día (con overflow nativo de Date). */
function addMonths(start: Date, n: number): Date {
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + n, start.getUTCDate()));
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Fechas del primer día de cada bucket, en O(n). Para `daily` avanza un cursor de día hábil
 * de a uno (saltea fines de semana) en vez de recontar desde el inicio en cada bucket (O(n²)).
 * Para el resto es aritmética calendario O(1) por bucket.
 */
function bucketDates(grouping: ProjectionGrouping, startDate: Date, periods: number): Date[] {
  switch (grouping) {
    case "daily": {
      const dates: Date[] = [];
      const cursor = new Date(startDate.getTime());
      for (let k = 0; k < periods; k++) {
        dates.push(new Date(cursor.getTime()));
        // Avanzar al siguiente día hábil para el próximo bucket.
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        while (cursor.getUTCDay() === 0 || cursor.getUTCDay() === 6) {
          cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
      }
      return dates;
    }
    case "weekly":
      return Array.from({ length: periods }, (_, k) => addUtcDays(startDate, k * 7));
    case "monthly":
      return Array.from({ length: periods }, (_, k) => addMonths(startDate, k));
    case "yearly":
      return Array.from({ length: periods }, (_, k) => addMonths(startDate, k * 12));
  }
}

/** Etiqueta de presentación del bucket `k` (mismo formato que el frontend). */
function bucketLabel(grouping: ProjectionGrouping, date: Date, k: number): string {
  switch (grouping) {
    case "daily":
      return `${date.getUTCDate()} ${MONTHS_ES[date.getUTCMonth()]}`;
    case "weekly":
      return `Semana ${k + 1}`;
    case "monthly":
      return `${MONTHS_ES[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
    case "yearly":
      return `${date.getUTCFullYear()}`;
  }
}

/**
 * Construye la serie de proyección. Determinista: mismos inputs → misma salida
 * (clave para cachear). Las 4 vistas re-agrupan la MISMA curva `B(n) = base·(1+r)^n`,
 * por lo que coinciden en el saldo para cualquier horizonte compartido.
 */
export function buildProjection(input: BuildProjectionInput): ProjectionPeriod[] {
  const { baseAmount, startDate, grouping, accountType, ratePct } = input;
  const years = input.years ?? DEFAULT_YEARS[grouping];
  const periods = PERIODS_PER_YEAR[grouping] * years;
  const step = BUCKET_TRADING_DAYS[grouping];
  const r = dailyRate(accountType, ratePct);

  const balanceAt = (day: number): number => baseAmount * (1 + r) ** day;
  const dates = bucketDates(grouping, startDate, periods);

  const result: ProjectionPeriod[] = [];
  // `dates.entries()` tipa el valor como Date (no Date|undefined) y su length === periods.
  for (const [k, date] of dates.entries()) {
    const startBalance = round2(balanceAt(k * step));
    const endBalance = round2(balanceAt((k + 1) * step));
    result.push({
      periodIndex: k + 1,
      label: bucketLabel(grouping, date, k),
      date: toIsoDate(date),
      startBalance,
      yieldAmount: round2(endBalance - startBalance),
      endBalance,
    });
  }
  return result;
}
