-- Biblioteca — a quem seguir
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de livro.sql.
--
-- ===========================================================================
-- Por quê
-- ===========================================================================
--
-- Quem se cadastra hoje encontra estante vazia, feed vazio e ninguém para
-- seguir. A busca só serve para achar quem a pessoa já conhece de fora, e o
-- ranking exige que ela adivinhe que aquilo é uma lista de gente. Os dois
-- primeiros minutos são onde se perde quase todo mundo, e são justamente os
-- que estão sem resposta.
--
-- O critério, na ordem:
--
--   1. livros em comum. É o sinal mais forte que existe numa rede de leitura
--      e o que nenhuma rede genérica tem — gosto literário diz muito mais
--      sobre afinidade do que amigo em comum;
--   2. tamanho da estante, como desempate. Para quem acabou de entrar e não
--      tem livro nenhum, é o único critério que sobra, e é razoável: seguir
--      quem registra leitura garante que o feed terá o que mostrar amanhã.
--
-- Quem eu já sigo fica de fora, e eu também. Perfil privado idem — não entra
-- em lista de sugestão, pelo mesmo princípio do ranking.
create or replace function sugestoes(p_limit int default 6)
returns table (
  user_id      uuid,
  username     citext,
  display_name text,
  avatar_url   text,
  em_comum     bigint,
  livros       bigint
)
language sql
stable security definer set search_path = public
as $$
  with meus as (
    select distinct ol_key
    from books
    where owner = auth.uid() and ol_key is not null
  )
  select p.id, p.username, p.display_name, p.avatar_url,
         count(distinct m.ol_key) as em_comum,
         count(distinct b.id)     as livros
  from profiles p
  left join books b on b.owner = p.id
  -- O join com `meus` é o que conta a interseção. Feito por LEFT JOIN e não
  -- por subconsulta dentro de FILTER porque FILTER não aceita subconsulta.
  left join meus m on m.ol_key = b.ol_key
  where auth.uid() is not null
    and p.is_private = false
    and p.id <> auth.uid()
    and not exists (
      select 1 from follows f
      where f.follower = auth.uid() and f.following = p.id
    )
  group by p.id, p.username, p.display_name, p.avatar_url
  order by em_comum desc, livros desc, p.username
  limit least(greatest(p_limit, 1), 20);
$$;
