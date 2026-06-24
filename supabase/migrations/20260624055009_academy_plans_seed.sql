-- Investep Academy — datos del catálogo: tiers, features, traducciones ES y el mapeo de ✓.
-- Datos de producto → migración versionada (existen en todos los entornos).
-- Slugs en inglés (identificadores de código); textos visibles en español (idioma base).
-- Suposiciones (validables): pricing ACUMULATIVO (Bronze 6, Silver 8, Gold 10, Platinum 12);
-- las dos filas "3 meses de clases EN VIVO" se modelan como features separadas (i/ii).
-- Idempotente: on conflict do nothing por si se re-ejecuta.

-- ============================================================
-- Tiers (precios en USD; el "." de la imagen es separador de miles)
-- ============================================================
insert into public.investep_plans (slug, price_regular, price_offer, currency, sort_order)
values
  ('bronze',   4999.00, 2199.00, 'USD', 1),
  ('silver',   8299.00, 3699.00, 'USD', 2),
  ('gold',     10799.00, 4199.00, 'USD', 3),
  ('platinum', 15699.00, 5999.00, 'USD', 4)
on conflict (slug) do nothing;

-- Traducciones ES de los tiers
insert into public.investep_plan_translations (investep_plan_id, locale, name, subtitle)
select p.id, 'es', t.name, t.subtitle
from (values
  ('bronze',   'Paquete Bronce',  '2 clases con Cracks de Soporte'),
  ('silver',   'Paquete Silver',  '2 semanas con Cracks de Soporte'),
  ('gold',     'Paquete Oro',     '3 semanas con Cracks de Soporte'),
  ('platinum', 'Paquete Platino', '4 semanas con Cracks de Soporte')
) as t (slug, name, subtitle)
join public.investep_plans p on p.slug = t.slug
on conflict do nothing;

-- ============================================================
-- Features (slugs en inglés; sort_order = orden de la imagen)
-- ============================================================
insert into public.investep_features (slug, sort_order)
values
  ('intensive-seminar',        1),
  ('intro-followup-classes',   2),
  ('community',                3),
  ('lifetime-platform',        4),
  ('live-classes-1-week',      5),
  ('basic-training',           6),
  ('live-classes-3-months-i',  7),
  ('intermediate-training',    8),
  ('live-classes-3-months-ii', 9),
  ('millionaire-ladder',       10),
  ('live-classes-6-months',    11),
  ('doublegreen',              12)
on conflict (slug) do nothing;

-- Traducciones ES de las features
insert into public.investep_feature_translations (investep_feature_id, locale, label)
select f.id, 'es', t.label
from (values
  ('intensive-seminar',        'Seminario Intensivo Aprendiendo a Invertir'),
  ('intro-followup-classes',   'Clases introductoria, posterior y de seguimiento de soporte'),
  ('community',                'Acceso a nuestra comunidad de inversiones'),
  ('lifetime-platform',        'Acceso a nuestra plataforma de estudio de por vida'),
  ('live-classes-1-week',      '1 semana de 3 clases de inversiones EN VIVO y mentoría'),
  ('basic-training',           'Formación básica de Soporte (1 mes)'),
  ('live-classes-3-months-i',  '3 meses de clases de inversiones EN VIVO y mentoría'),
  ('intermediate-training',    'Formación intermedia de soporte (1 mes)'),
  ('live-classes-3-months-ii', '3 meses de clases de inversiones EN VIVO y mentoría (continuación)'),
  ('millionaire-ladder',       'Escalera al millón: Formación avanzada de soporte (1 mes)'),
  ('live-classes-6-months',    '6 meses de clases de inversiones EN VIVO y mentoría'),
  ('doublegreen',              'DoubleGREEN (2 meses)')
) as t (slug, label)
join public.investep_features f on f.slug = t.slug
on conflict do nothing;

-- ============================================================
-- Mapeo plan ↔ feature (✓). Pricing acumulativo → cada tier incluye
-- todas las features hasta su umbral de sort_order.
-- ============================================================
insert into public.investep_plan_features (investep_plan_id, investep_feature_id)
select p.id, f.id
from public.investep_plans p
join public.investep_features f
  on f.sort_order <= case p.slug
    when 'bronze'   then 6
    when 'silver'   then 8
    when 'gold'     then 10
    when 'platinum' then 12
  end
on conflict do nothing;
