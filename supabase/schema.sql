-- Biblioteca — esquema da rede social de leitores (Supabase / Postgres)
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- É idempotente no que dá: pode rodar de novo sem quebrar.
--
-- Princípio de privacidade adotado aqui: o que é agregado é público,
-- o que é granular é privado. Ninguém vê a que horas você leu nem
-- quantos minutos gastou em cada sessão; vê o total, o ranking e o que
-- você publicar de propósito.

create extension if not exists citext;

-- ===========================================================================
-- Perfis
-- ===========================================================================
create table if not exists profiles (
  id          uuid primary key references auth.users on delete cascade,
  username    citext not null unique
              check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text not null check (char_length(display_name) between 1 and 60),
  bio         text check (char_length(bio) <= 280),
  avatar_url  text,
  is_private  boolean not null default false,
  created_at  timestamptz not null default now()
);

comment on column profiles.is_private is
  'Perfil privado sai do ranking e do feed público; só seguidores aprovados veem.';

-- Cria o perfil junto com o usuário, com um username provisório baseado no e-mail.
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  base text;
  candidate text;
  n int := 0;
begin
  base := lower(regexp_replace(split_part(new.email, '@', 1), '[^a-z0-9_]', '', 'g'));
  if char_length(base) < 3 then base := 'leitor' || base; end if;
  base := left(base, 16);
  candidate := base;

  while exists (select 1 from profiles where username = candidate) loop
    n := n + 1;
    candidate := left(base, 16 - char_length(n::text)) || n::text;
  end loop;

  insert into profiles (id, username, display_name)
  values (new.id, candidate, coalesce(new.raw_user_meta_data->>'display_name', candidate));

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===========================================================================
-- Estante, sessões e anotações
-- ===========================================================================
create table if not exists books (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null references profiles on delete cascade,
  title        text not null check (char_length(title) between 1 and 300),
  author       text,
  pages        int check (pages is null or pages between 1 and 20000),
  current_page int not null default 0 check (current_page >= 0),
  status       text not null default 'fila'
               check (status in ('fila', 'lendo', 'lido', 'abandonado')),
  priority     smallint not null default 1 check (priority between 0 and 2),
  cover_url    text,
  year         int,
  isbn         text,
  ol_key       text,
  synopsis     text,
  started_at   date,
  finished_at  date,
  created_at   timestamptz not null default now(),
  constraint current_page_dentro_do_livro
    check (pages is null or current_page <= pages)
);
create index if not exists books_owner_idx on books (owner, status);

create table if not exists sessions (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references profiles on delete cascade,
  book_id    uuid not null references books on delete cascade,
  date       date not null,
  pages      int not null default 0 check (pages >= 0),
  minutes    int not null default 0 check (minutes >= 0),
  created_at timestamptz not null default now(),
  constraint sessao_nao_vazia check (pages > 0 or minutes > 0)
);
create index if not exists sessions_owner_date_idx on sessions (owner, date desc);

create table if not exists notes (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references profiles on delete cascade,
  book_id    uuid not null references books on delete cascade,
  page       int,
  kind       text not null default 'note' check (kind in ('quote', 'note')),
  body       text not null check (char_length(body) between 1 and 4000),
  is_public  boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists notes_owner_idx on notes (owner, created_at desc);

-- ===========================================================================
-- Grafo social
-- ===========================================================================
create table if not exists follows (
  follower   uuid not null references profiles on delete cascade,
  following  uuid not null references profiles on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower, following),
  constraint nao_seguir_a_si_mesmo check (follower <> following)
);
create index if not exists follows_following_idx on follows (following);

-- ===========================================================================
-- Feed
-- ===========================================================================
create table if not exists activities (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references profiles on delete cascade,
  kind       text not null check (kind in ('started', 'progress', 'finished', 'note')),
  book_id    uuid references books on delete cascade,
  note_id    uuid references notes on delete cascade,
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activities_feed_idx on activities (owner, created_at desc);

create table if not exists likes (
  activity_id uuid not null references activities on delete cascade,
  user_id     uuid not null references profiles on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (activity_id, user_id)
);

create table if not exists comments (
  id          uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities on delete cascade,
  author      uuid not null references profiles on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  created_at  timestamptz not null default now()
);
create index if not exists comments_activity_idx on comments (activity_id, created_at);

create table if not exists reports (
  id          uuid primary key default gen_random_uuid(),
  reporter    uuid not null references profiles on delete cascade,
  comment_id  uuid references comments on delete cascade,
  activity_id uuid references activities on delete cascade,
  reason      text not null check (char_length(reason) between 1 and 500),
  created_at  timestamptz not null default now(),
  constraint alvo_obrigatorio check (comment_id is not null or activity_id is not null)
);

-- Publica no feed quando um livro é começado ou terminado.
create or replace function on_book_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  if new.status = 'lendo' then
    insert into activities (owner, kind, book_id, payload)
    values (new.owner, 'started', new.id, jsonb_build_object('title', new.title, 'author', new.author));
  elsif new.status = 'lido' then
    insert into activities (owner, kind, book_id, payload)
    values (new.owner, 'finished', new.id,
            jsonb_build_object('title', new.title, 'author', new.author, 'pages', new.pages));
  end if;

  return new;
end;
$$;

drop trigger if exists books_status_feed on books;
create trigger books_status_feed
  after insert or update of status on books
  for each row execute function on_book_status_change();

-- ===========================================================================
-- Estatísticas e ranking
--
-- Estas funções leem `sessions` de todo mundo, mas só devolvem agregados.
-- Por isso são SECURITY DEFINER: o RLS de sessions continua fechado.
-- ===========================================================================

-- Sequência de dias consecutivos com leitura, terminando hoje ou ontem.
create or replace function reader_streak(p_owner uuid)
returns int
language sql
stable security definer set search_path = public
as $$
  with dias as (
    select distinct date from sessions where owner = p_owner
  ),
  ilhas as (
    select date, date - (row_number() over (order by date))::int as grupo
    from dias
  ),
  blocos as (
    select grupo, max(date) as fim, count(*)::int as tamanho
    from ilhas group by grupo
  )
  select coalesce(max(tamanho), 0)
  from blocos
  where fim >= current_date - 1;
$$;

-- Ranking. period: 'week' | 'month' | 'year' | 'all'
-- metric: 'pages' | 'books' | 'streak'
create or replace function leaderboard(
  p_period text default 'month',
  p_metric text default 'pages',
  p_limit  int  default 50
)
returns table (
  rank         bigint,
  user_id      uuid,
  username     citext,
  display_name text,
  avatar_url   text,
  pages        bigint,
  minutes      bigint,
  books        bigint,
  streak       int
)
language sql
stable security definer set search_path = public
as $$
  with limites as (
    select case p_period
             when 'week'  then date_trunc('week', current_date)::date
             when 'month' then date_trunc('month', current_date)::date
             when 'year'  then date_trunc('year', current_date)::date
             else '-infinity'::date
           end as inicio
  ),
  base as (
    select p.id, p.username, p.display_name, p.avatar_url,
           coalesce(sum(s.pages), 0)   as pages,
           coalesce(sum(s.minutes), 0) as minutes,
           (select count(*) from books b
             where b.owner = p.id and b.status = 'lido'
               and b.finished_at >= (select inicio from limites)) as books,
           reader_streak(p.id) as streak
    from profiles p
    left join sessions s
      on s.owner = p.id and s.date >= (select inicio from limites)
    where p.is_private = false
    group by p.id, p.username, p.display_name, p.avatar_url
  )
  select rank() over (
           order by case p_metric
                      when 'books'  then books
                      when 'streak' then streak::bigint
                      else pages
                    end desc
         ) as rank,
         id, username, display_name, avatar_url, pages, minutes, books, streak
  from base
  order by rank
  limit least(greatest(p_limit, 1), 200);
$$;

-- Cartão público de um leitor: o que aparece no perfil.
create or replace function reader_card(p_username citext)
returns table (
  user_id      uuid,
  username     citext,
  display_name text,
  bio          text,
  avatar_url   text,
  member_since timestamptz,
  pages_year   bigint,
  minutes_year bigint,
  books_year   bigint,
  streak       int,
  followers    bigint,
  following    bigint
)
language sql
stable security definer set search_path = public
as $$
  select p.id, p.username, p.display_name, p.bio, p.avatar_url, p.created_at,
         coalesce((select sum(s.pages) from sessions s
                    where s.owner = p.id and s.date >= date_trunc('year', current_date)), 0),
         coalesce((select sum(s.minutes) from sessions s
                    where s.owner = p.id and s.date >= date_trunc('year', current_date)), 0),
         (select count(*) from books b
           where b.owner = p.id and b.status = 'lido'
             and b.finished_at >= date_trunc('year', current_date)),
         reader_streak(p.id),
         (select count(*) from follows f where f.following = p.id),
         (select count(*) from follows f where f.follower = p.id)
  from profiles p
  where p.username = p_username and p.is_private = false;
$$;

-- ===========================================================================
-- Row Level Security
-- Sem estas políticas, qualquer chave pública lê o banco inteiro.
-- ===========================================================================
alter table profiles   enable row level security;
alter table books      enable row level security;
alter table sessions   enable row level security;
alter table notes      enable row level security;
alter table follows    enable row level security;
alter table activities enable row level security;
alter table likes      enable row level security;
alter table comments   enable row level security;
alter table reports    enable row level security;

-- Perfis: públicos são visíveis a todos; o próprio dono sempre se vê.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles for select
  using (is_private = false or id = auth.uid());

drop policy if exists profiles_write on profiles;
create policy profiles_write on profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- Estante: dono manda; terceiros leem se o perfil for público.
drop policy if exists books_read on books;
create policy books_read on books for select
  using (
    owner = auth.uid()
    or exists (select 1 from profiles p where p.id = books.owner and p.is_private = false)
  );

drop policy if exists books_owner on books;
create policy books_owner on books for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Sessões: estritamente privadas. Ranking e perfil passam pelas funções acima.
drop policy if exists sessions_owner on sessions;
create policy sessions_owner on sessions for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Anotações: privadas por padrão, públicas quando marcadas.
drop policy if exists notes_read on notes;
create policy notes_read on notes for select
  using (
    owner = auth.uid()
    or (is_public and exists (select 1 from profiles p where p.id = notes.owner and p.is_private = false))
  );

drop policy if exists notes_owner on notes;
create policy notes_owner on notes for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Seguidores: visíveis a todos; só você cria e desfaz os seus.
drop policy if exists follows_read on follows;
create policy follows_read on follows for select using (true);

drop policy if exists follows_write on follows;
create policy follows_write on follows for insert
  with check (follower = auth.uid());

drop policy if exists follows_delete on follows;
create policy follows_delete on follows for delete using (follower = auth.uid());

-- Feed: atividades de perfis públicos, mais as suas.
drop policy if exists activities_read on activities;
create policy activities_read on activities for select
  using (
    owner = auth.uid()
    or exists (select 1 from profiles p where p.id = activities.owner and p.is_private = false)
  );

drop policy if exists activities_owner on activities;
create policy activities_owner on activities for all
  using (owner = auth.uid()) with check (owner = auth.uid());

-- Curtidas e comentários: leitura acompanha a atividade; escrita é sua.
drop policy if exists likes_read on likes;
create policy likes_read on likes for select
  using (exists (select 1 from activities a where a.id = likes.activity_id));

drop policy if exists likes_write on likes;
create policy likes_write on likes for insert with check (user_id = auth.uid());

drop policy if exists likes_delete on likes;
create policy likes_delete on likes for delete using (user_id = auth.uid());

drop policy if exists comments_read on comments;
create policy comments_read on comments for select
  using (exists (select 1 from activities a where a.id = comments.activity_id));

drop policy if exists comments_write on comments;
create policy comments_write on comments for insert with check (author = auth.uid());

drop policy if exists comments_delete on comments;
create policy comments_delete on comments for delete using (author = auth.uid());

-- Denúncias: você cria e vê apenas as suas.
drop policy if exists reports_own on reports;
create policy reports_own on reports for all
  using (reporter = auth.uid()) with check (reporter = auth.uid());
