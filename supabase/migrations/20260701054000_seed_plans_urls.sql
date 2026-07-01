-- Popula las URLs de los planes de Investep Academy correspondientes
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinarbronce' WHERE slug = 'bronze';
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinarsilver' WHERE slug = 'silver';
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinaroro' WHERE slug = 'gold';
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinarplatino' WHERE slug = 'platinum';
