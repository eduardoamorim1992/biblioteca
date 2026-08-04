-- Biblioteca — desafio anual de leitura
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de sugestoes.sql.
--
-- ===========================================================================
-- Por quê
-- ===========================================================================
--
-- "42 de 50 livros em 2026" é o gancho de retenção mais eficaz que existe
-- neste gênero de app, e todos os dados para calcular já estavam aqui — só
-- faltava o número que a pessoa escolhe.
--
-- Onde mora: em profiles, não em settings do navegador. As metas diárias
-- (páginas, minutos) são locais e continuam locais, porque são régua de
-- trabalho e ninguém precisa saber. O desafio anual é o oposto: só vira
-- desafio se alguém puder ver. No perfil, ele acompanha a conta entre
-- aparelhos e aparece para quem visita.
alter table profiles add column if not exists goal_books smallint
  check (goal_books is null or goal_books between 1 and 999);

comment on column profiles.goal_books is
  'Meta de livros no ano. Null = não participa; o app não inventa meta para ninguém.';

-- ===========================================================================
-- O cartão do leitor passa a carregar a meta
-- ===========================================================================
--
-- books_year já existia; o que faltava era com quanto comparar. Com os dois,
-- o perfil de qualquer leitor mostra o progresso dele no ano.
--
-- Assinatura nova, então DROP obrigatório.
drop function if exists reader_card(citext);

create function reader_card(p_username citext)
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
  goal_books   smallint,
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
         p.goal_books,
         reader_streak(p.id),
         (select count(*) from follows f where f.following = p.id),
         (select count(*) from follows f where f.follower = p.id)
  from profiles p
  where p.username = p_username and p.is_private = false;
$$;
