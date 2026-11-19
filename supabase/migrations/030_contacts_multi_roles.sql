-- Multi-role contacts (shared with Case Tracker / paralegal-checklist).
-- See case-tracker supabase/sql/092_contacts_multi_roles.sql for full comments.

alter table public.contacts
  add column if not exists roles text[] not null default '{}'::text[];

create or replace function public.contact_has_role(
  p_roles text[],
  p_primary text,
  p_want text
)
returns boolean
language sql
immutable
as $$
  select
    case
      when p_want is null or btrim(p_want) = '' then false
      when p_roles is not null and cardinality(p_roles) > 0 then p_want = any (p_roles)
      else p_primary = p_want
    end;
$$;

create or replace function public.contacts_normalize_roles()
returns trigger
language plpgsql
as $$
declare
  v_roles text[];
  v_primary text;
begin
  v_primary := nullif(btrim(coalesce(NEW.role, '')), '');
  v_roles := coalesce(
    (
      select array_agg(distinct r order by r)
      from unnest(coalesce(NEW.roles, '{}'::text[])) as u(r)
      where nullif(btrim(r), '') is not null
    ),
    '{}'::text[]
  );

  if cardinality(v_roles) = 0 and v_primary is not null then
    v_roles := array[v_primary];
  end if;

  if v_primary is null and cardinality(v_roles) > 0 then
    v_primary := v_roles[1];
  end if;

  if v_primary is not null and not (v_primary = any (v_roles)) then
    v_roles := array[v_primary] || v_roles;
  end if;

  NEW.role := v_primary;
  NEW.roles := coalesce(v_roles, '{}'::text[]);
  return NEW;
end;
$$;

drop trigger if exists trg_contacts_normalize_roles on public.contacts;
create trigger trg_contacts_normalize_roles
before insert or update of role, roles on public.contacts
for each row execute function public.contacts_normalize_roles();

update public.contacts
set roles = array[role]
where (roles is null or cardinality(roles) = 0)
  and role is not null
  and btrim(role) <> '';

update public.contacts
set
  role = 'legal_assistant',
  roles = array['legal_assistant', 'paralegal']
where id = 'e0d485fc-2186-4a2a-8886-2554667eac64';
