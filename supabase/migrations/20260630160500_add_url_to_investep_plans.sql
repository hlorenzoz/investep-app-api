ALTER TABLE public.investep_plans ADD COLUMN url text;

UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinarbronce' WHERE slug = 'bronze';
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinarsilver' WHERE slug = 'silver';
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinaroro' WHERE slug = 'gold';
UPDATE public.investep_plans SET url = 'https://investepacademy.com/webinarplatino' WHERE slug = 'platinum';
