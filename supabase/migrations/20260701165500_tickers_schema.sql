-- Migration: Tickers, Ticker Relations, and Investep Plan Tickers tables.
-- ============================================================

-- 1. Tickers table
CREATE TABLE public.tickers (
  id                 bigint generated always as identity primary key,
  symbol             text not null unique,
  name               text not null,
  asset_class        text not null default 'stock',
  exchange           text,
  sector             text,
  industry           text,
  country            text,
  price              numeric(12, 4),
  change_pct         numeric(8, 4),
  prev_close         numeric(12, 4),
  volume             bigint,
  avg_volume         bigint,
  fifty_two_w_high   numeric(12, 4),
  fifty_two_w_low    numeric(12, 4),
  market_cap         numeric(20, 2),
  pe_ratio           numeric(8, 2),
  forward_pe         numeric(8, 2),
  peg_ratio          numeric(8, 2),
  ps_ratio           numeric(8, 2),
  pb_ratio           numeric(8, 2),
  dividend_yield     numeric(8, 4),
  financials         jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  CONSTRAINT tickers_symbol_uppercase CHECK (symbol = upper(symbol)),
  CONSTRAINT tickers_asset_class_check CHECK (asset_class in ('stock', 'etf', 'index', 'crypto', 'commodity', 'currency'))
);

CREATE INDEX tickers_sector_idx ON public.tickers (sector);
CREATE INDEX tickers_asset_class_idx ON public.tickers (asset_class);

-- 2. Ticker Relations (reflexive relationship for leveraged/inverse tickers)
CREATE TABLE public.ticker_relations (
  parent_ticker_id   bigint not null references public.tickers (id) on delete cascade,
  related_ticker_id  bigint not null references public.tickers (id) on delete cascade,
  relation_type      text not null, -- 'leveraged_long', 'leveraged_short', 'inverse', 'underlying', 'peer'
  multiplier         numeric(4, 2) not null default 1.0,
  created_at         timestamptz not null default now(),
  PRIMARY KEY (parent_ticker_id, related_ticker_id, relation_type),
  CONSTRAINT ticker_relations_prevent_self CHECK (parent_ticker_id <> related_ticker_id)
);

CREATE INDEX ticker_relations_related_idx ON public.ticker_relations (related_ticker_id);

-- 3. Investep Plan Tickers (Many-to-Many junction table)
CREATE TABLE public.investep_plan_tickers (
  investep_plan_id   bigint not null references public.investep_plans (id) on delete cascade,
  ticker_id          bigint not null references public.tickers (id) on delete cascade,
  created_at         timestamptz not null default now(),
  PRIMARY KEY (investep_plan_id, ticker_id)
);

CREATE INDEX investep_plan_tickers_ticker_idx ON public.investep_plan_tickers (ticker_id);

-- Trigger for updated_at
CREATE TRIGGER tickers_set_updated_at BEFORE UPDATE ON public.tickers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS Settings
ALTER TABLE public.tickers ENABLE ROW LEVEL SECURITY;
CREATE POLICY tickers_read_authenticated ON public.tickers
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.tickers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tickers TO service_role;

ALTER TABLE public.ticker_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ticker_relations_read_authenticated ON public.ticker_relations
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.ticker_relations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ticker_relations TO service_role;

ALTER TABLE public.investep_plan_tickers ENABLE ROW LEVEL SECURITY;
CREATE POLICY investep_plan_tickers_read_authenticated ON public.investep_plan_tickers
  FOR SELECT TO authenticated USING (true);
GRANT SELECT ON public.investep_plan_tickers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.investep_plan_tickers TO service_role;

-- ============================================================
-- Seed data
-- ============================================================

-- Seed basic tickers
INSERT INTO public.tickers (symbol, name, asset_class, exchange, sector, industry, country, price, change_pct, prev_close, volume, avg_volume, fifty_two_w_high, fifty_two_w_low, market_cap, financials)
VALUES
  ('TSLA', 'Tesla, Inc.', 'stock', 'NASDAQ', 'Consumer Cyclical', 'Auto Manufacturers', 'USA', 426.64, 1.44, 420.60, 8153033, 56280000, 498.83, 288.77, 1579655830000.00, '{"pe_ratio": 389.77, "forward_pe": 176.09, "peg_ratio": 7.18}'),
  ('TSLL', 'Direxion Daily TSLA Bull 2X Shares', 'etf', 'NASDAQ', 'Financial', 'ETF', 'USA', 25.40, 2.88, 24.69, 1200000, 5000000, 32.10, 12.50, 850000000.00, '{}'),
  ('TSLS', 'Direxion Daily TSLA Bear 1X Shares', 'etf', 'NASDAQ', 'Financial', 'ETF', 'USA', 15.20, -1.44, 15.42, 340000, 1200000, 25.60, 11.20, 210000000.00, '{}'),
  ('SPX', 'S&P 500 Index', 'index', 'CBOE', 'Index', 'Index', 'USA', 5100.25, 0.45, 5077.38, 0, 0, 5200.00, 4500.00, 0.00, '{}'),
  ('SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'NYSE Arca', 'Financial', 'ETF', 'USA', 510.12, 0.44, 507.88, 70000000, 80000000, 520.00, 448.00, 500000000000.00, '{}'),
  ('SH', 'ProShares Short S&P500', 'etf', 'NYSE Arca', 'Financial', 'ETF', 'USA', 12.45, -0.44, 12.51, 15000000, 18000000, 15.20, 11.80, 2500000000.00, '{}'),
  ('AAPL', 'Apple Inc.', 'stock', 'NASDAQ', 'Technology', 'Consumer Electronics', 'USA', 180.25, -0.50, 181.16, 45000000, 52000000, 199.62, 165.00, 2800000000000.00, '{"pe_ratio": 28.5, "forward_pe": 26.2, "peg_ratio": 2.4}'),
  ('AAPU', 'Direxion Daily AAPL Bull 2X Shares', 'etf', 'NASDAQ', 'Financial', 'ETF', 'USA', 30.15, -1.00, 30.45, 150000, 450000, 38.50, 20.10, 120000000.00, '{}'),
  ('AAPD', 'Direxion Daily AAPL Bear 1X Shares', 'etf', 'NASDAQ', 'Financial', 'ETF', 'USA', 14.80, 0.50, 14.73, 85000, 250000, 18.20, 11.50, 45000000, '{}');

-- Seed relations
INSERT INTO public.ticker_relations (parent_ticker_id, related_ticker_id, relation_type, multiplier)
VALUES
  ((SELECT id FROM public.tickers WHERE symbol = 'TSLA'), (SELECT id FROM public.tickers WHERE symbol = 'TSLL'), 'leveraged_long', 2.00),
  ((SELECT id FROM public.tickers WHERE symbol = 'TSLA'), (SELECT id FROM public.tickers WHERE symbol = 'TSLS'), 'inverse', -1.00),
  ((SELECT id FROM public.tickers WHERE symbol = 'SPX'), (SELECT id FROM public.tickers WHERE symbol = 'SPY'), 'etf', 1.00),
  ((SELECT id FROM public.tickers WHERE symbol = 'SPX'), (SELECT id FROM public.tickers WHERE symbol = 'SH'), 'inverse', -1.00),
  ((SELECT id FROM public.tickers WHERE symbol = 'AAPL'), (SELECT id FROM public.tickers WHERE symbol = 'AAPU'), 'leveraged_long', 2.00),
  ((SELECT id FROM public.tickers WHERE symbol = 'AAPL'), (SELECT id FROM public.tickers WHERE symbol = 'AAPD'), 'inverse', -1.00);

-- Seed plan tickers (bronze, silver, gold, platinum mappings)
-- Let''s assign TSLA, AAPL, SPY to plans
INSERT INTO public.investep_plan_tickers (investep_plan_id, ticker_id)
VALUES
  ((SELECT id FROM public.investep_plans WHERE slug = 'bronze'), (SELECT id FROM public.tickers WHERE symbol = 'SPY')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'silver'), (SELECT id FROM public.tickers WHERE symbol = 'SPY')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'silver'), (SELECT id FROM public.tickers WHERE symbol = 'AAPL')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'gold'), (SELECT id FROM public.tickers WHERE symbol = 'SPY')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'gold'), (SELECT id FROM public.tickers WHERE symbol = 'AAPL')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'gold'), (SELECT id FROM public.tickers WHERE symbol = 'TSLA')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'platinum'), (SELECT id FROM public.tickers WHERE symbol = 'SPY')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'platinum'), (SELECT id FROM public.tickers WHERE symbol = 'AAPL')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'platinum'), (SELECT id FROM public.tickers WHERE symbol = 'TSLA')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'platinum'), (SELECT id FROM public.tickers WHERE symbol = 'TSLL')),
  ((SELECT id FROM public.investep_plans WHERE slug = 'platinum'), (SELECT id FROM public.tickers WHERE symbol = 'TSLS'));
