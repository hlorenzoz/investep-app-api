-- Migration: Seed SPDR sector ETFs and their inverse ETFs
-- ============================================================
-- Sin estos datos, GET /tickers/relations-overview devuelve `sectors` vacío:
-- la vista agrupa ETFs (asset_class = 'etf') con `sector` no nulo y ≥1 relación
-- inversa. Aquí sembramos los ETFs sectoriales con su sector y un ETF inverso.

-- 1. ETFs sectoriales (padre): asset_class 'etf' + sector no nulo.
INSERT INTO public.tickers (symbol, name, asset_class, sector) VALUES
  ('XLK', 'Technology Select Sector SPDR Fund', 'etf', 'Technology'),
  ('XLE', 'Energy Select Sector SPDR Fund', 'etf', 'Energy'),
  ('XLV', 'Health Care Select Sector SPDR Fund', 'etf', 'Health Care'),
  ('XLF', 'Financial Select Sector SPDR Fund', 'etf', 'Financial'),
  ('XLY', 'Consumer Discretionary Select Sector SPDR Fund', 'etf', 'Consumer Discretionary'),
  ('XLRE', 'Real Estate Select Sector SPDR Fund', 'etf', 'Real Estate')
ON CONFLICT (symbol) DO UPDATE
  SET name = EXCLUDED.name,
      asset_class = EXCLUDED.asset_class,
      sector = EXCLUDED.sector;

-- 2. ETFs inversos sectoriales (relacionados).
INSERT INTO public.tickers (symbol, name, asset_class) VALUES
  ('TECS', 'Direxion Daily Technology Bear 3X Shares', 'etf'),
  ('ERY',  'Direxion Daily Energy Bear 2X Shares', 'etf'),
  ('RXD',  'ProShares UltraShort Health Care', 'etf'),
  ('FAZ',  'Direxion Daily Financial Bear 3X Shares', 'etf'),
  ('SCC',  'ProShares UltraShort Consumer Discretionary', 'etf'),
  ('DRV',  'Direxion Daily Real Estate Bear 3X Shares', 'etf')
ON CONFLICT (symbol) DO NOTHING;

-- 3. Helper temporal para asociar relaciones por símbolo (idéntico al de la
--    migración de seed de tickers).
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

-- 4. Relaciones inversas: ETF sectorial (padre) → ETF inverso (relacionado).
SELECT public.add_ticker_relation_by_symbol('XLK', 'TECS', 'inverso', -3.0);
SELECT public.add_ticker_relation_by_symbol('XLE', 'ERY',  'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('XLV', 'RXD',  'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('XLF', 'FAZ',  'inverso', -3.0);
SELECT public.add_ticker_relation_by_symbol('XLY', 'SCC',  'inverso', -2.0);
SELECT public.add_ticker_relation_by_symbol('XLRE', 'DRV', 'inverso', -3.0);

-- 5. Limpiar helper.
DROP FUNCTION public.add_ticker_relation_by_symbol;
