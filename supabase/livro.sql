-- Biblioteca — a obra no feed
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de notificacoes.sql.
--
-- ===========================================================================
-- Por quê
-- ===========================================================================
--
-- A página do livro agrega por ol_key: é a chave da obra na Open Library, e
-- é o que faz a edição dela e a edição dele contarem como o mesmo livro. O
-- feed devolvia tudo do livro menos essa chave, então dava para ver "Maria
-- avaliou Torto Arado" e não ter como abrir Torto Arado.
--
-- Fechar esse laço — ver no feed, abrir a obra, adicionar à estante — é o que
-- transforma o feed de mural em porta de entrada. Sem ele, ler o feed não
-- leva a lugar nenhum.
--
-- Uma coluna a mais no retorno, e por isso o DROP: CREATE OR REPLACE não muda
-- assinatura de função em Postgres.
--
-- Enquanto este arquivo não roda, o app continua funcionando: o bloco do
-- livro no feed simplesmente não fica clicável.
drop function if exists feed(text, int, timestamptz);

create function feed(
  p_escopo text default 'seguindo',
  p_limit  int default 30,
  p_antes  timestamptz default null
)
returns table (
  id            uuid,
  owner         uuid,
  username      citext,
  display_name  text,
  avatar_url    text,
  kind          text,
  book_id       uuid,
  book_title    text,
  book_author   text,
  book_cover    text,
  book_pages    int,
  book_ol_key   text,
  book_rating   smallint,
  book_review   text,
  note_body     text,
  note_kind     text,
  note_page     int,
  payload       jsonb,
  created_at    timestamptz,
  curtidas      bigint,
  eu_curti      boolean,
  comentarios   bigint
)
language sql
stable security definer set search_path = public
as $$
  select a.id, a.owner, p.username, p.display_name, p.avatar_url,
         a.kind, a.book_id, b.title, b.author, b.cover_url, b.pages,
         b.ol_key, b.rating, b.review,
         n.body, n.kind, n.page,
         a.payload, a.created_at,
         (select count(*) from likes l where l.activity_id = a.id),
         exists (select 1 from likes l where l.activity_id = a.id and l.user_id = auth.uid()),
         (select count(*) from comments c where c.activity_id = a.id)
  from activities a
  join profiles p on p.id = a.owner
  left join books b on b.id = a.book_id
  left join notes n on n.id = a.note_id and n.is_public
  where auth.uid() is not null
    and (
      a.owner = auth.uid()
      or (
        p.is_private = false
        and (
          p_escopo = 'todos'
          or exists (select 1 from follows f
                      where f.follower = auth.uid() and f.following = a.owner)
        )
      )
    )
    and (a.note_id is null or n.id is not null)
    and (p_antes is null or a.created_at < p_antes)
  order by a.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;
