do $$
declare
  admin_email text := 'REMPLACE_PAR_TON_EMAIL';
  partner_email text := 'REMPLACE_PAR_EMAIL_PARTENAIRE';
  admin_user_id uuid;
  partner_user_id uuid;
  new_couple_id uuid;
begin
  select id into admin_user_id
  from auth.users
  where lower(email) = lower(admin_email);

  if admin_user_id is null then
    raise exception 'Aucun utilisateur Auth ne correspond à %.', admin_email;
  end if;

  select id into partner_user_id
  from auth.users
  where lower(email) = lower(partner_email);

  if partner_user_id is null then
    raise exception 'Aucun utilisateur Auth ne correspond à %.', partner_email;
  end if;

  if admin_user_id = partner_user_id then
    raise exception 'Les adresses admin et partenaire doivent être différentes.';
  end if;

  insert into public.couples (name, timezone)
  values ('Notre capsule', 'Europe/Paris')
  returning id into new_couple_id;

  insert into public.memberships (couple_id, user_id, role, display_name)
  values
    (new_couple_id, admin_user_id, 'admin', 'Enzo'),
    (new_couple_id, partner_user_id, 'partner', 'Ana');

  raise notice 'Couple créé. VITE_COUPLE_ID=%', new_couple_id;
end
$$;
