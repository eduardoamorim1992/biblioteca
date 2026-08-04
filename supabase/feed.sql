-- Biblioteca — o feed
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de schema.sql.
--
-- Este arquivo não cria tabela nenhuma. As tabelas do feed (activities, likes,
-- comments) já existem desde o primeiro dia, e o gatilho já grava evento a cada
-- livro começado ou terminado — o que faltava era alguém ler. O que há aqui é:
--
--   1. o conserto do gatilho, para o feed não estrear como ruído;
--   2. uma função que monta o feed em uma ida só ao servidor.

-- ===========================================================================
-- 1. Nem toda mudança de status é notícia
-- ===========================================================================
--
-- O gatilho antigo publicava em todo INSERT. Quando alguém sincroniza uma
-- estante de quarenta livros pela primeira vez, isso são quarenta "terminou de
-- ler" no mesmo minuto — livros lidos há anos, todos carimbados com a data de
-- hoje. O feed nasceria impossível de ler, e a culpa apareceria como "esse app
-- é uma bagunça", não como "o gatilho está errado".
--
-- Notícia é o que acabou de acontecer. Estante que chega inteira é acervo.
create or replace function on_book_status_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  evento text;
  recente boolean;
begin
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  evento := case new.status when 'lendo' then 'started'
                            when 'lido'  then 'finished' end;
  if evento is null then
    return new;
  end if;

  -- Livro que entra já lido/lendo só vira notícia se a data disser que é de
  -- agora. Sem data, assume-se hoje: quem cadastra à mão está fazendo agora.
  recente := case new.status
               when 'lendo' then coalesce(new.started_at, current_date)  >= current_date - 1
               when 'lido'  then coalesce(new.finished_at, current_date) >= current_date - 1
             end;

  if tg_op = 'INSERT' and not recente then
    return new;
  end if;

  -- Mesmo livro, mesmo acontecimento, duas vezes: acontece quando alguém
  -- corrige o status de ida e volta, ou quando uma sincronia reescreve a linha.
  -- Para quem lê o feed, é a mesma notícia repetida.
  if exists (select 1 from activities a where a.book_id = new.id and a.kind = evento) then
    return new;
  end if;

  insert into activities (owner, kind, book_id, payload)
  values (new.owner, evento, new.id,
          jsonb_build_object('title', new.title, 'author', new.author, 'pages', new.pages));

  return new;
end;
$$;

drop trigger if exists books_status_feed on books;
create trigger books_status_feed
  after insert or update of status on books
  for each row execute function on_book_status_change();

-- Limpa o ruído que o gatilho antigo já produziu: atividades criadas em bloco
-- para livros que ninguém tocou naquele dia. O critério é o mesmo de cima —
-- se a data do livro não bate com a data da publicação, aquilo nunca foi
-- notícia, foi importação.
delete from activities a
using books b
where a.book_id = b.id
  and a.created_at::date > coalesce(
        case a.kind when 'started' then b.started_at else b.finished_at end,
        a.created_at::date) + 1;

-- ===========================================================================
-- 2. O feed em uma ida só
-- ===========================================================================
--
-- Sem isto, montar a tela custaria uma consulta para as atividades, outra para
-- os autores, outra para as curtidas, outra para saber se fui eu que curti e
-- outra para contar comentários — cinco viagens para desenhar uma lista, e o
-- app tem que abrir rápido em rede de celular.
--
-- SECURITY DEFINER porque a função precisa contar curtidas e comentários de
-- todo mundo. Por isso o WHERE é a fronteira de privacidade, e ela é explícita:
-- ou a atividade é minha, ou é de um perfil público. Perfil privado não vaza
-- nem para quem o segue.
--
-- p_escopo:
--   'seguindo' — a praça de quem eu escolhi acompanhar (mais as minhas)
--   'todos'    — a praça pública, que é o que salva o primeiro dia de quem
--                ainda não segue ninguém e abriria um feed vazio
create or replace function feed(
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
    -- Nota despublicada some do feed junto: a atividade continua existindo,
    -- mas sem o texto ela não é nada, e mostrá-la vazia entregaria que ela
    -- existiu.
    and (a.note_id is null or n.id is not null)
    and (p_antes is null or a.created_at < p_antes)
  order by a.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

-- Índice para a ordenação do feed. Sem ele, cada carregamento varre a tabela
-- inteira e ordena — invisível com dez usuários, e o primeiro gargalo com mil.
create index if not exists activities_recentes_idx on activities (created_at desc);
create index if not exists likes_atividade_idx on likes (activity_id);
create index if not exists follows_seguidor_idx on follows (follower);
