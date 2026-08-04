-- Biblioteca — notificações
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de resenhas.sql.
--
-- ===========================================================================
-- Por quê
-- ===========================================================================
--
-- Hoje você segue alguém, curte, comenta — e a pessoa nunca fica sabendo.
-- Sem retorno, nenhuma interação traz ninguém de volta, e o laço que sustenta
-- uma rede pequena (alguém te segue, você é avisado, você segue de volta)
-- simplesmente não fecha. É a peça de retenção mais barata que falta.
--
-- Quem escreve é o banco, não o cliente. Notificação criada pelo navegador
-- seria notificação forjável: bastaria um POST para plantar aviso no nome de
-- outra pessoa. Aqui os gatilhos são SECURITY DEFINER e o cliente só tem
-- permissão de ler e marcar como lida as suas.

create table if not exists notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles on delete cascade,  -- quem recebe
  actor      uuid not null references profiles on delete cascade,  -- quem causou
  kind       text not null check (kind in ('follow', 'like', 'comment')),
  activity_id uuid references activities on delete cascade,
  comment_id  uuid references comments on delete cascade,
  created_at timestamptz not null default now(),
  read_at    timestamptz,
  constraint nao_notificar_a_si_mesmo check (user_id <> actor)
);

-- O índice que importa: "minhas não lidas, mais recentes primeiro" é a
-- consulta que roda toda vez que o app abre.
create index if not exists notifications_dono_idx
  on notifications (user_id, created_at desc);
create index if not exists notifications_nao_lidas_idx
  on notifications (user_id) where read_at is null;

-- Duas pessoas curtindo o mesmo fato são dois avisos; a mesma pessoa curtindo,
-- descurtindo e curtindo de novo é um só. Sem isto, dá para encher a caixa de
-- alguém com um dedo só.
create unique index if not exists notifications_sem_repeticao
  on notifications (user_id, actor, kind, coalesce(activity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where kind in ('follow', 'like');

-- ===========================================================================
-- Gatilhos
-- ===========================================================================

create or replace function notifica_seguidor()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into notifications (user_id, actor, kind)
  values (new.following, new.follower, 'follow')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists follows_notifica on follows;
create trigger follows_notifica
  after insert on follows
  for each row execute function notifica_seguidor();

create or replace function notifica_curtida()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  dono uuid;
begin
  select owner into dono from activities where id = new.activity_id;
  -- Curtir o próprio fato não avisa ninguém; o check da tabela recusaria a
  -- linha e derrubaria a curtida junto, que é o oposto do que se quer.
  if dono is null or dono = new.user_id then
    return new;
  end if;
  insert into notifications (user_id, actor, kind, activity_id)
  values (dono, new.user_id, 'like', new.activity_id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists likes_notifica on likes;
create trigger likes_notifica
  after insert on likes
  for each row execute function notifica_curtida();

create or replace function notifica_comentario()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  dono uuid;
begin
  select owner into dono from activities where id = new.activity_id;
  if dono is null or dono = new.author then
    return new;
  end if;
  -- Comentário não entra no índice de repetição: três respostas na mesma
  -- conversa são três avisos, porque cada uma tem texto próprio para ler.
  insert into notifications (user_id, actor, kind, activity_id, comment_id)
  values (dono, new.author, 'comment', new.activity_id, new.id);
  return new;
end;
$$;

drop trigger if exists comments_notifica on comments;
create trigger comments_notifica
  after insert on comments
  for each row execute function notifica_comentario();

-- ===========================================================================
-- RLS
-- ===========================================================================
alter table notifications enable row level security;

-- Ler: só as suas.
drop policy if exists notifications_read on notifications;
create policy notifications_read on notifications for select
  using (user_id = auth.uid());

-- Marcar como lida: só as suas. O WITH CHECK repete a condição de propósito —
-- sem ele, daria para atualizar a própria linha trocando o dono.
drop policy if exists notifications_update on notifications;
create policy notifications_update on notifications for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists notifications_delete on notifications;
create policy notifications_delete on notifications for delete
  using (user_id = auth.uid());

-- Nenhuma política de INSERT: o cliente não cria notificação. Quem cria são os
-- gatilhos acima, que rodam como SECURITY DEFINER e não passam por aqui.

-- ===========================================================================
-- Leitura em uma ida só
-- ===========================================================================
--
-- A lista precisa do nome de quem causou, e do livro quando o aviso aponta
-- para um fato. Sem esta função seriam três consultas por abertura da caixa.
create or replace function notificacoes(p_limit int default 30)
returns table (
  id           uuid,
  kind         text,
  created_at   timestamptz,
  read_at      timestamptz,
  actor        uuid,
  username     citext,
  display_name text,
  avatar_url   text,
  activity_id  uuid,
  activity_kind text,
  book_title   text,
  comment_body text
)
language sql
stable security definer set search_path = public
as $$
  select n.id, n.kind, n.created_at, n.read_at,
         n.actor, p.username, p.display_name, p.avatar_url,
         n.activity_id, a.kind, coalesce(b.title, a.payload->>'title'), c.body
  from notifications n
  join profiles p on p.id = n.actor
  left join activities a on a.id = n.activity_id
  left join books b on b.id = a.book_id
  left join comments c on c.id = n.comment_id
  where n.user_id = auth.uid()
  order by n.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Contagem de não lidas. Consulta separada e barata: roda ao abrir o app e de
-- tempos em tempos, enquanto a lista completa só é buscada se alguém clicar.
create or replace function nao_lidas()
returns int
language sql
stable security definer set search_path = public
as $$
  select count(*)::int from notifications
  where user_id = auth.uid() and read_at is null;
$$;
