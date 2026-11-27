-- Undo accidental automatic opening performed by the previous migration.
-- Opening is an explicit action: opened_at must be set only by open_capsule.

update public.capsules c
set opened_at = null
from public.couples co
where co.id = c.couple_id
  and c.opened_at = c.opens_at
  and c.month >= date_trunc('month', now() at time zone co.timezone)::date;
