-- Biblioteca — a conquista vira notícia
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda depois de conquistas.sql.
--
-- ===========================================================================
-- Por quê
-- ===========================================================================
--
-- Das três saídas possíveis para uma conquista, duas já existem: o cartão que
-- se compartilha e o perfil de quem se visita. Falta a única em que a
-- descoberta é passiva — ninguém precisa visitar ninguém para ver.
--
-- Isso importa mais do que parece num app com poucos leitores dentro. A
-- pessoa que abre o feed e vê "fulano conquistou a Chama" descobre, no mesmo
-- gesto, que conquistas existem e que ela também pode ter uma. Nenhuma tela
-- de ajuda faz esse trabalho tão bem quanto o vizinho fazendo.
--
-- ===========================================================================
-- Quem escreve, e por que ele não é confiável
-- ===========================================================================
--
-- Quem publica é o cliente, porque é ele quem sabe a hora: confere() já roda
-- a cada leitura registrada e já compara o que a pessoa tinha com o que ela
-- tem. Fazer isso no banco custaria recontar tudo a cada sessão gravada.
--
-- Só que cliente que escolhe o que publicar escolhe também o que mentir, e a
-- política de INSERT de activities aceita qualquer linha cujo dono seja você:
--
--   POST /rest/v1/activities  {"kind":"conquista","payload":{"id":"dezmil"}}
--
-- Daí o gatilho. Ele pergunta a conquistas_do_leitor() — a mesma lista que o
-- portão do avatar usa — se aquilo é verdade, e recusa se não for. A régua é
-- uma só, e fica deste lado.
--
-- E daí também o índice único: sem ele, republicar a mesma medalha vinte
-- vezes é uma requisição repetida vinte vezes. Com ele, a segunda volta 23505
-- e o feed continua tendo uma notícia por conquista, que é o que ela é.

-- ===========================================================================
-- 1. O tipo novo
-- ===========================================================================
--
-- O check antigo não conhece 'conquista' e recusaria a linha. Ele já foi
-- reescrito uma vez, por resenhas.sql, pelo mesmo motivo.
alter table activities drop constraint if exists activities_kind_check;
alter table activities add constraint activities_kind_check
  check (kind in ('started', 'progress', 'finished', 'note', 'review', 'conquista'));

-- ===========================================================================
-- 2. Uma notícia por conquista
-- ===========================================================================
--
-- Índice parcial: só vale para kind = 'conquista'. As outras atividades podem
-- repetir à vontade — começar o mesmo livro duas vezes é duas notícias, e
-- está certo que seja.
create unique index if not exists activities_conquista_unica
  on activities (owner, (payload->>'id'))
  where kind = 'conquista';

-- ===========================================================================
-- 3. A conferência
-- ===========================================================================
--
-- `before insert`, para a linha mentirosa não chegar a existir. Só olha
-- kind = 'conquista': as outras atividades não passam por aqui e não pagam
-- nada por este arquivo existir.
create or replace function activities_valida_conquista()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.kind <> 'conquista' then
    return new;
  end if;

  if not (coalesce(new.payload->>'id', '') = any (conquistas_do_leitor(new.owner))) then
    -- Mensagem legível porque ela pode chegar à tela: o caso honesto é a
    -- leitura ainda não ter subido deste navegador, e não alguém tentando
    -- forjar medalha.
    raise exception 'Esta conquista ainda não foi ganha.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists activities_conquista_conferida on activities;
create trigger activities_conquista_conferida
  before insert on activities
  for each row execute function activities_valida_conquista();

-- ===========================================================================
-- O que este arquivo NÃO mexe
-- ===========================================================================
--
-- feed(). Ela já devolve kind e payload, e a atividade de conquista não tem
-- livro nem nota — os LEFT JOIN dela dão null e seguem. O filtro de notas
-- (`a.note_id is null or n.id is not null`) passa direto, porque note_id é
-- null aqui.
--
-- Isso é de propósito: feed() é recriada por resenhas.sql e por livro.sql, e
-- cada DROP dela é uma chance de rodar os arquivos fora de ordem e ficar com
-- a versão errada. Não tocar nela é uma chance a menos.
