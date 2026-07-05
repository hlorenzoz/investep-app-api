# Planes de inversión — reglas de rentabilidad y proyección

> Fuente de verdad del **dominio** de rentabilidad de los planes. La API expone la serie ya
> calculada en `GET /projections` (ver `GET /openapi.json`); este documento explica **las reglas
> de negocio** que ese endpoint implementa y por qué.

## 1. Dos tipos de cuenta, dos fórmulas

Un plan de inversión (`investment_plans`) tiene un `account_type` y un target de rentabilidad. El
significado del porcentaje **depende del tipo de cuenta**:

| Tipo | `account_type` | Significado del % | Base sobre la que aplica | Ejemplos |
|------|----------------|-------------------|--------------------------|----------|
| Activos | `equity` | **Mensual** | 100% del capital | 25%, 50%, 100% |
| Opciones | `options` | **Diario** | 10% del capital (por operación) | 35%, 50% |

- **Activos (equity)**: se busca un retorno **mensual** sobre todo el capital. Ej.: 25% = 25% por
  mes ≈ 1.25% por día hábil (20 días).
- **Opciones (options)**: cada día se invierte el **10% del capital actual** buscando la
  rentabilidad **diaria** del plan sobre esa inversión. Ej.: capital 1.000 → se opera con 100 →
  35% sobre 100 = 35, y ese resultado se reinvierte (compone) en el total.

## 2. Caveat de naming: `target_monthly_pct` es un misnomer para opciones

La columna `investment_plans.target_monthly_pct` fue pensada para activos (mensual). Para **opciones**
guarda un valor **diario**, no mensual. La migración
[`20260705000000_investment_plans_options_daily.sql`](../supabase/migrations/20260705000000_investment_plans_options_daily.sql):

- Completa `target_daily_pct = target_monthly_pct` para opciones (el número guardado ES el diario).
- Corrige las labels de opciones de "mensual"/"monthly" a **"diario"/"daily"**.

> Deuda técnica pendiente: renombrar la columna (o modelar el período explícitamente) requiere tocar
> la FK compuesta `(id, account_type)` y los tipos generados; se difiere. Mientras tanto, leé
> `target_daily_pct` para opciones.

## 3. Modelo canónico de proyección (`GET /projections`)

La proyección "Desempeño vs Plan" la calcula la API en
[`src/features/projections/projections.service.ts`](../src/features/projections/projections.service.ts).
Se compone **una sola serie por día hábil** y las 4 vistas (diario/semanal/mensual/anual) son
**re-buckets de esa misma serie** ⇒ todas convergen al mismo saldo para el mismo horizonte.

- **Calendario sintético de trading**: 5 días hábiles/semana, 20/mes, 240/año.
- **Tasa por día hábil `r`:**
  - Activos: `r = (1 + mensual/100)^(1/20) − 1`. ⇒ 20 días componen **exactamente** el mensual del
    plan; 240 días = `(1 + mensual/100)^12` (compuesto anual).
  - Opciones: `r = 0.10 × (diario/100)`. ⇒ `total_{d+1} = total_d × (1 + 0.10·diario/100)`.
- **Balance a `n` días**: `B(n) = base × (1 + r)^n` (se evalúa con `pow`, sin iterar, para no
  arrastrar redondeo; se redondea solo al serializar).
- **Bucketing**: diario = 1 día, semanal = 5, mensual = 20, anual = 240 días hábiles.
- **Horizonte por defecto** (override con `?years=`): diario 1 año, semanal 1, mensual 3, anual 5.

### Ejemplo (equity 25% mensual, base 15.000)

| Vista | Período | Saldo inicial | Rendimiento | Saldo final |
|-------|---------|---------------|-------------|-------------|
| Mensual | mes 1 | 15.000 | +3.750 (25%) | 18.750 |
| Mensual | mes 2 | 18.750 | +4.687,50 | 23.437,50 |
| Mensual | mes 12 | … | … | **218.278,73** = 15.000 × 1.25¹² |
| Anual | año 1 | 15.000 | +203.278,73 | **218.278,73** (mismo saldo) |

## 4. Fuentes (código y migraciones)

| Fuente | Aporta |
|--------|--------|
| [`20260624051528_initial_schema.sql`](../supabase/migrations/20260624051528_initial_schema.sql) | Tabla `investment_plans` (`target_monthly_pct`, `account_type`, uniques). |
| [`20260625090347_investment_plans_seed.sql`](../supabase/migrations/20260625090347_investment_plans_seed.sql) | Siembra equity 25/50/100 + options 50. |
| [`20260626000000_investment_plans_daily_pct.sql`](../supabase/migrations/20260626000000_investment_plans_daily_pct.sql) | Agrega `target_daily_pct` + trigger (equity = mensual/20). |
| [`20260627190000_add_options_35_plan.sql`](../supabase/migrations/20260627190000_add_options_35_plan.sql) | Siembra options 35. |
| [`20260705000000_investment_plans_options_daily.sql`](../supabase/migrations/20260705000000_investment_plans_options_daily.sql) | Diario de opciones + labels "diario". |
| [`projections.service.ts`](../src/features/projections/projections.service.ts) | Implementa el modelo canónico. |

## 5. Fuera de alcance (follow-ups)

- **Proyección con retiros / aportes** o costos por operación (hoy la serie es compuesto puro).
- **Línea "actual" real** ("Desempeño vs Plan") desde el balance real del bróker / operaciones
  (hoy el frontend usa un placeholder `initialDeposit × 1.06`).
- **Refactor del frontend Flutter** para consumir `GET /projections` en vez del cálculo local
  (`compound_interest_calculator.dart`).
