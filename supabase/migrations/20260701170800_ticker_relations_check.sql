-- Migration: Add non-zero constraint on ticker_relations multiplier
-- ============================================================

ALTER TABLE public.ticker_relations
  ADD CONSTRAINT ticker_relations_multiplier_nonzero CHECK (multiplier <> 0.0);
