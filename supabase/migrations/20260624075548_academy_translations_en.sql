-- Investep Academy — traducciones EN del contenido (tiers + features).
-- Traducciones iniciales (revisables por marketing). Términos de marca conservados:
-- "DoubleGREEN" sin traducir. "Cracks de Soporte" → "Support Aces" (revisable).
-- Idempotente: on conflict do nothing.

-- Traducciones EN de los tiers
insert into public.investep_plan_translations (investep_plan_id, locale, name, subtitle)
select p.id, 'en', t.name, t.subtitle
from (values
  ('bronze',   'Bronze Package',   '2 classes with Support Aces'),
  ('silver',   'Silver Package',   '2 weeks with Support Aces'),
  ('gold',     'Gold Package',     '3 weeks with Support Aces'),
  ('platinum', 'Platinum Package', '4 weeks with Support Aces')
) as t (slug, name, subtitle)
join public.investep_plans p on p.slug = t.slug
on conflict do nothing;

-- Traducciones EN de las features
insert into public.investep_feature_translations (investep_feature_id, locale, label)
select f.id, 'en', t.label
from (values
  ('intensive-seminar',        'Intensive Seminar: Learning to Invest'),
  ('intro-followup-classes',   'Introductory, follow-up and support tracking classes'),
  ('community',                'Access to our investment community'),
  ('lifetime-platform',        'Lifetime access to our study platform'),
  ('live-classes-1-week',      '1 week of 3 LIVE investment classes and mentoring'),
  ('basic-training',           'Basic Support training (1 month)'),
  ('live-classes-3-months-i',  '3 months of LIVE investment classes and mentoring'),
  ('intermediate-training',    'Intermediate Support training (1 month)'),
  ('live-classes-3-months-ii', '3 months of LIVE investment classes and mentoring (continued)'),
  ('millionaire-ladder',       'Ladder to the Million: Advanced Support training (1 month)'),
  ('live-classes-6-months',    '6 months of LIVE investment classes and mentoring'),
  ('doublegreen',              'DoubleGREEN (2 months)')
) as t (slug, label)
join public.investep_features f on f.slug = t.slug
on conflict do nothing;
