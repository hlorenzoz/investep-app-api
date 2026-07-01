-- Migration: Update relation types and seed rich tickers dataset
-- ==============================================================

-- 1. Actualizar restricción check en ticker_relations
ALTER TABLE public.ticker_relations
  DROP CONSTRAINT IF EXISTS ticker_relations_relation_type_check;

ALTER TABLE public.ticker_relations
  ADD CONSTRAINT ticker_relations_relation_type_check CHECK (relation_type IN ('x2', 'x3', 'inverso'));

-- 2. Limpiar registros de tickers existentes
TRUNCATE public.ticker_relations, public.tickers RESTART IDENTITY CASCADE;

-- 3. Insertar Activos Principales y ETFs relacionados
INSERT INTO public.tickers (symbol, name, asset_class) VALUES
  -- Índices principales
  ('SPX', 'S&P 500 Index', 'index'),
  ('NDX', 'Nasdaq 100 Index', 'index'),
  ('RUT', 'Russell 2000 Index', 'index'),
  ('DJI', 'Dow Jones Industrial Average', 'index'),
  ('SOXQ', 'Invesco PHLX Semiconductor ETF', 'index'),

  -- Acciones principales
  ('AAPL', 'Apple Inc.', 'stock'),
  ('MSFT', 'Microsoft Corporation', 'stock'),
  ('TSLA', 'Tesla, Inc.', 'stock'),
  ('NVDA', 'Nvidia Corporation', 'stock'),
  ('AMD', 'Advanced Micro Devices, Inc.', 'stock'),
  ('COIN', 'Coinbase Global, Inc.', 'stock'),
  ('AMZN', 'Amazon.com, Inc.', 'stock'),
  ('NFLX', 'Netflix, Inc.', 'stock'),
  ('META', 'Meta Platforms, Inc.', 'stock'),
  ('AVGO', 'Broadcom Inc.', 'stock'),
  ('MU', 'Micron Technology, Inc.', 'stock'),
  ('QCOM', 'Qualcomm Incorporated', 'stock'),
  ('GOOG', 'Alphabet Inc.', 'stock'),
  ('PLTR', 'Palantir Technologies Inc.', 'stock'),
  ('UBER', 'Uber Technologies, Inc.', 'stock'),
  ('PYPL', 'PayPal Holdings, Inc.', 'stock'),
  ('CRM', 'Salesforce, Inc.', 'stock'),
  ('HOOD', 'Robinhood Markets, Inc.', 'stock'),

  -- ETFs leveraged / 1x (bajo columna ETFs x2 en la hoja)
  ('SPY', 'SPDR S&P 500 ETF Trust', 'etf'),
  ('QQQ', 'Invesco QQQ Trust', 'etf'),
  ('IWM', 'iShares Russell 2000 ETF', 'etf'),
  ('TNA', 'Direxion Daily Small Cap Bull 3X Shares', 'etf'),
  ('DIA', 'SPDR Dow Jones Industrial Average ETF Trust', 'etf'),
  ('AAPU', 'Direxion Daily AAPL Bull 2X Shares', 'etf'),
  ('MSFU', 'Direxion Daily MSFT Bull 2X Shares', 'etf'),
  ('MSFL', 'Direxion Daily MSFT Bull 1.5X Shares', 'etf'),
  ('TSLL', 'Direxion Daily TSLA Bull 2X Shares', 'etf'),
  ('NVDL', 'GraniteShares 2x Long NVDA Daily ETF', 'etf'),
  ('NVDG', 'Direxion Daily NVDA Bull 2X Shares', 'etf'),
  ('NVDU', 'Direxion Daily NVDA Bull 2X Shares', 'etf'),
  ('AMDL', 'Direxion Daily AMD Bull 2X Shares', 'etf'),
  ('CONL', 'GraniteShares 2x Long COIN Daily ETF', 'etf'),
  ('AMZZ', 'Direxion Daily AMZN Bull 2X Shares', 'etf'),
  ('AMZU', 'Direxion Daily AMZN Bull 2X Shares', 'etf'),
  ('NFXL', 'Direxion Daily NFLX Bull 2X Shares', 'etf'),
  ('METU', 'Direxion Daily META Bull 2X Shares', 'etf'),
  ('AVL', 'Direxion Daily AVGO Bull 2X Shares', 'etf'),
  ('MUU', 'Direxion Daily MU Bull 2X Shares', 'etf'),
  ('SOXL', 'Direxion Daily Semiconductor Bull 3X Shares', 'etf'),
  ('QCML', 'Direxion Daily QCOM Bull 2X Shares', 'etf'),
  ('GGLL', 'Direxion Daily GOOG Bull 2X Shares', 'etf'),
  ('PTIR', 'Direxion Daily PLTR Bull 2X Shares', 'etf'),
  ('UBRL', 'Direxion Daily UBER Bull 2X Shares', 'etf'),
  ('PYPG', 'Direxion Daily PYPL Bull 2X Shares', 'etf'),
  ('CRMG', 'Direxion Daily CRM Bull 2X Shares', 'etf'),
  ('ROBN', 'Direxion Daily HOOD Bull 2X Shares', 'etf'),
  ('HOOG', 'Direxion Daily HOOD Bull 2X Shares', 'etf'),

  -- ETFs Inversos
  ('SH', 'ProShares Short S&P500', 'etf'),
  ('SDS', 'ProShares UltraShort S&P500', 'etf'),
  ('SPXU', 'ProShares UltraPro Short S&P500', 'etf'),
  ('SPXS', 'Direxion Daily S&P 500 Bear 3X Shares', 'etf'),
  ('PSQ', 'ProShares Short QQQ', 'etf'),
  ('QID', 'ProShares UltraShort QQQ', 'etf'),
  ('SQQQ', 'ProShares UltraPro Short QQQ', 'etf'),
  ('TZA', 'Direxion Daily Small Cap Bear 3X Shares', 'etf'),
  ('DOG', 'ProShares Short Dow30', 'etf'),
  ('DXD', 'ProShares UltraShort Dow30', 'etf'),
  ('SDOW', 'ProShares UltraPro Short Dow30', 'etf'),
  ('AAPD', 'Direxion Daily AAPL Bear 2X Shares', 'etf'),
  ('MSFD', 'Direxion Daily MSFT Bear 2X Shares', 'etf'),
  ('TSLS', 'Direxion Daily TSLA Bear 2X Shares', 'etf'),
  ('TSLZ', 'Direxion Daily TSLA Bear 2X Shares', 'etf'),
  ('TSLQ', 'Direxion Daily TSLA Bear 2X Shares', 'etf'),
  ('TSDD', 'Direxion Daily TSLA Bear 2X Shares', 'etf'),
  ('NVDS', 'Direxion Daily NVDA Bear 2X Shares', 'etf'),
  ('NVDD', 'Direxion Daily NVDA Bear 2X Shares', 'etf'),
  ('NVD', 'Direxion Daily NVDA Bear 2X Shares', 'etf'),
  ('AMDD', 'Direxion Daily AMD Bear 2X Shares', 'etf'),
  ('CONI', 'Direxion Daily COIN Bear 2X Shares', 'etf'),
  ('AMZD', 'Direxion Daily AMZN Bear 2X Shares', 'etf'),
  ('NFXS', 'Direxion Daily NFLX Bear 2X Shares', 'etf'),
  ('METD', 'Direxion Daily META Bear 2X Shares', 'etf'),
  ('AVS', 'Direxion Daily AVGO Bear 2X Shares', 'etf'),
  ('MUD', 'Direxion Daily MU Bear 2X Shares', 'etf'),
  ('SOXS', 'Direxion Daily Semiconductor Bear 3X Shares', 'etf'),
  ('GGLS', 'Direxion Daily GOOG Bear 2X Shares', 'etf'),
  ('PLTD', 'Direxion Daily PLTR Bear 2X Shares', 'etf'),
  ('PLTZ', 'Direxion Daily PLTR Bear 2X Shares', 'etf');

-- 4. Helper function temporal para asociar relaciones usando símbolos
CREATE OR REPLACE FUNCTION public.add_ticker_relation_by_symbol(
  parent_sym  varchar(50),
  related_sym varchar(50),
  rel_type    varchar(50),
  mult        numeric(4,2)
) RETURNS void AS $$
DECLARE
  parent_id bigint;
  related_id bigint;
BEGIN
  SELECT id INTO parent_id FROM public.tickers WHERE symbol = parent_sym;
  SELECT id INTO related_id FROM public.tickers WHERE symbol = related_sym;

  IF parent_id IS NOT NULL AND related_id IS NOT NULL THEN
    INSERT INTO public.ticker_relations (parent_ticker_id, related_ticker_id, relation_type, multiplier)
    VALUES (parent_id, related_id, rel_type, mult)
    ON CONFLICT DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Seeding de relaciones basadas en la hoja de activos
-- SPX
SELECT public.add_ticker_relation_by_symbol('SPX', 'SPY', 'x2', 1.0);
SELECT public.add_ticker_relation_by_symbol('SPX', 'SH', 'inverso', -1.0);
SELECT public.add_ticker_relation_by_symbol('SPX', 'SDS', 'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('SPX', 'SPXU', 'inverso', -3.0);
SELECT public.add_ticker_relation_by_symbol('SPX', 'SPXS', 'inverso', -3.0);

-- NDX
SELECT public.add_ticker_relation_by_symbol('NDX', 'QQQ', 'x2', 1.0);
SELECT public.add_ticker_relation_by_symbol('NDX', 'PSQ', 'inverso', -1.0);
SELECT public.add_ticker_relation_by_symbol('NDX', 'QID', 'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('NDX', 'SQQQ', 'inverso', -3.0);

-- RUT
SELECT public.add_ticker_relation_by_symbol('RUT', 'IWM', 'x2', 1.0);
SELECT public.add_ticker_relation_by_symbol('RUT', 'TNA', 'x3', 3.0);
SELECT public.add_ticker_relation_by_symbol('RUT', 'TZA', 'inverso', -3.0);

-- DJI
SELECT public.add_ticker_relation_by_symbol('DJI', 'DIA', 'x2', 1.0);
SELECT public.add_ticker_relation_by_symbol('DJI', 'DOG', 'inverso', -1.0);
SELECT public.add_ticker_relation_by_symbol('DJI', 'DXD', 'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('DJI', 'SDOW', 'inverso', -3.0);

-- AAPL
SELECT public.add_ticker_relation_by_symbol('AAPL', 'AAPU', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('AAPL', 'AAPD', 'inverso', -2.0);

-- MSFT
SELECT public.add_ticker_relation_by_symbol('MSFT', 'MSFU', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('MSFT', 'MSFL', 'x2', 1.5);
SELECT public.add_ticker_relation_by_symbol('MSFT', 'MSFD', 'inverso', -2.0);

-- TSLA
SELECT public.add_ticker_relation_by_symbol('TSLA', 'TSLL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('TSLA', 'TSLS', 'inverso', -1.0);
SELECT public.add_ticker_relation_by_symbol('TSLA', 'TSLZ', 'inverso', -1.0);
SELECT public.add_ticker_relation_by_symbol('TSLA', 'TSLQ', 'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('TSLA', 'TSDD', 'inverso', -2.0);

-- NVDA
SELECT public.add_ticker_relation_by_symbol('NVDA', 'NVDL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('NVDA', 'NVDG', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('NVDA', 'NVDU', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('NVDA', 'NVDS', 'inverso', -1.25);
SELECT public.add_ticker_relation_by_symbol('NVDA', 'NVDD', 'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('NVDA', 'NVD', 'inverso', -2.0);

-- AMD
SELECT public.add_ticker_relation_by_symbol('AMD', 'AMDL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('AMD', 'AMDD', 'inverso', -2.0);

-- COIN
SELECT public.add_ticker_relation_by_symbol('COIN', 'CONL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('COIN', 'CONI', 'inverso', -2.0);

-- AMZN
SELECT public.add_ticker_relation_by_symbol('AMZN', 'AMZZ', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('AMZN', 'AMZU', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('AMZN', 'AMZD', 'inverso', -2.0);

-- NFLX
SELECT public.add_ticker_relation_by_symbol('NFLX', 'NFXL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('NFLX', 'NFXS', 'inverso', -2.0);

-- META
SELECT public.add_ticker_relation_by_symbol('META', 'METU', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('META', 'METD', 'inverso', -2.0);

-- AVGO
SELECT public.add_ticker_relation_by_symbol('AVGO', 'AVL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('AVGO', 'AVS', 'inverso', -2.0);

-- MU
SELECT public.add_ticker_relation_by_symbol('MU', 'MUU', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('MU', 'MUD', 'inverso', -2.0);

-- SOXQ
SELECT public.add_ticker_relation_by_symbol('SOXQ', 'SOXL', 'x3', 3.0);
SELECT public.add_ticker_relation_by_symbol('SOXQ', 'SOXS', 'inverso', -3.0);

-- QCOM
SELECT public.add_ticker_relation_by_symbol('QCOM', 'QCML', 'x2', 2.0);

-- GOOG
SELECT public.add_ticker_relation_by_symbol('GOOG', 'GGLL', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('GOOG', 'GGLS', 'inverso', -2.0);

-- PLTR
SELECT public.add_ticker_relation_by_symbol('PLTR', 'PTIR', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('PLTR', 'PLTD', 'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('PLTR', 'PLTZ', 'inverso', -2.0);

-- UBER
SELECT public.add_ticker_relation_by_symbol('UBER', 'UBRL', 'x2', 2.0);

-- PYPL
SELECT public.add_ticker_relation_by_symbol('PYPL', 'PYPG', 'x2', 2.0);

-- CRM
SELECT public.add_ticker_relation_by_symbol('CRM', 'CRMG', 'x2', 2.0);

-- HOOD
SELECT public.add_ticker_relation_by_symbol('HOOD', 'ROBN', 'x2', 2.0);
SELECT public.add_ticker_relation_by_symbol('HOOD', 'HOOG', 'x2', 2.0);

-- Limpiar función auxiliar
DROP FUNCTION public.add_ticker_relation_by_symbol;
