-- Biblioteca — resenha com nota
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de feed.sql.
--
-- ===========================================================================
-- Por quê
-- ===========================================================================
--
-- A tela de entrada promete "suas resenhas" desde o primeiro dia, e resenha
-- nunca existiu em lugar nenhum do esquema. Além de promessa não cumprida,
-- era o buraco de conteúdo do feed: alguém termina um livro, o gatilho
-- publica "terminou X", e não há o que responder a isso. Ninguém comenta um
-- fato. Comenta-se uma opinião.
--
-- Onde a nota mora: em `books`, a linha que já é do usuário. Não numa tabela
-- de obra canônica — essa é a refatoração cara (juntar edições, reconciliar
-- livro digitado à mão com a Open Library), e resenha não precisa esperar por
-- ela. `ol_key` continua sendo o fio que permite agregar depois, quando a
-- obra virar entidade: dá para calcular nota média por ol_key hoje mesmo.
--
-- Quem vê: o RLS de books já resolve. `books_read` libera o que é seu e o que
-- é de perfil público, então a resenha de um perfil público é legível, e a de
-- um perfil privado não. Nada de política nova.

-- ===========================================================================
-- 1. As colunas
-- ===========================================================================
alter table books add column if not exists rating smallint
  check (rating is null or rating between 1 and 5);
alter table books add column if not exists review text
  check (review is null or char_length(review) <= 4000);
alter table books add column if not exists reviewed_at timestamptz;

comment on column books.rating is
  'Nota de 1 a 5 do dono. Null = ainda não avaliou; nunca 0, para "sem nota" e "nota mínima" não se confundirem.';

-- ===========================================================================
-- 2. Resenha é notícia
-- ===========================================================================
--
-- 'review' precisa entrar na lista de tipos aceitos. O check antigo não a
-- conhece e recusaria a linha.
alter table activities drop constraint if exists activities_kind_check;
alter table activities add constraint activities_kind_check
  check (kind in ('started', 'progress', 'finished', 'note', 'review'));

-- Publica quando a nota aparece ou muda. Não publica quando o usuário só
-- corrige uma vírgula do texto: reescrever a resenha três vezes não são três
-- notícias. E não publica nota que veio junto na primeira sincronia de uma
-- estante inteira, pelo mesmo motivo que o gatilho de status não publica —
-- acervo não é acontecimento.
create or replace function on_book_review()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.rating is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.rating is not distinct from old.rating then
    return new;
  end if;
  -- Importação: livro que chega já avaliado, terminado há tempos.
  if tg_op = 'INSERT' and coalesce(new.finished_at, current_date) < current_date - 1 then
    return new;
  end if;

  -- Reavaliar substitui a notícia anterior em vez de empilhar outra. A
  -- atividade some com os comentários dela, o que é o certo: eram respostas a
  -- uma opinião que o autor trocou.
  delete from activities where book_id = new.id and kind = 'review';

  insert into activities (owner, kind, book_id, payload)
  values (new.owner, 'review', new.id,
          jsonb_build_object('title', new.title, 'author', new.author, 'rating', new.rating));

  return new;
end;
$$;

drop trigger if exists books_review_feed on books;
create trigger books_review_feed
  after insert or update of rating on books
  for each row execute function on_book_review();

-- ===========================================================================
-- 3. O feed passa a carregar a nota e o texto
-- ===========================================================================
--
-- Mesma função de feed.sql, com book_rating e book_review no retorno. O tipo
-- de retorno mudou, então o DROP é obrigatório: CREATE OR REPLACE não muda
-- assinatura de função em Postgres.
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
         b.rating, b.review,
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

-- ===========================================================================
-- 4. Nota média da obra
-- ===========================================================================
--
-- Agrega por ol_key, que é o que aproxima edições do mesmo livro. Só perfis
-- públicos entram na média, pelo mesmo princípio do ranking: o que é agregado
-- é público, o que é granular é privado.
--
-- SECURITY DEFINER para poder ler a nota de todo mundo; o que sai é média e
-- contagem, nunca quem deu qual nota.
create or replace function book_rating(p_ol_key text)
returns table (media numeric, votos bigint)
language sql
stable security definer set search_path = public
as $$
  select round(avg(b.rating)::numeric, 1), count(*)
  from books b
  join profiles p on p.id = b.owner
  where b.ol_key = p_ol_key
    and b.rating is not null
    and p.is_private = false;
$$;

create index if not exists books_ol_key_idx on books (ol_key) where ol_key is not null;
