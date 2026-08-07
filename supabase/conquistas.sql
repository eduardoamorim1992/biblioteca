-- Biblioteca — conquistas e avatares
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda DEPOIS de resenhas.sql e
-- desafio.sql — ele lê books.rating e profiles.goal_books, que nascem lá.
--
-- MUDOU DEPOIS DA PRIMEIRA VERSÃO: se você já rodou este arquivo, rode de
-- novo. A régua virou lista (conquistas_do_leitor) e ganhou uma porta pública
-- (conquistas_de), para o perfil de quem se visita poder mostrar o que a
-- pessoa ganhou. avatar_liberado continua existindo com a mesma assinatura,
-- então o gatilho não muda.
--
-- ===========================================================================
-- Por quê existe um arquivo de SQL para uma coisa de tela
-- ===========================================================================
--
-- O avatar conquistado é guardado em profiles.avatar_url como `av:<id>`. Sem
-- este arquivo, a única coisa entre "eu li 10.000 páginas" e "eu digitei
-- av:dezmil" é o JavaScript do meu próprio navegador — e a chave anônima que
-- fala com o PostgREST está nesse mesmo navegador, à vista de qualquer um:
--
--   PATCH /rest/v1/profiles?id=eq.<eu>   {"avatar_url":"av:coroa"}
--
-- Recompensa que o premiado carimba sozinho não é recompensa; é um campo de
-- texto com nome bonito. A régua tem que estar do lado de cá.
--
-- ===========================================================================
-- Nenhuma coluna nova, nenhum contador
-- ===========================================================================
--
-- Tudo que uma conquista mede já estava no banco: páginas e minutos em
-- `sessions`, livros e notas em `books`, anotações em `notes`, gente seguida
-- em `follows`, a meta do ano em `profiles`. Guardar um contador de conquistas
-- em paralelo criaria um segundo lugar onde a verdade mora — e dois lugares
-- discordam, sempre. Aqui a conquista é uma leitura da mesma verdade.
--
-- O catálogo tem gêmeo em avatares.js. Acrescentar avatar lá sem acrescentar
-- aqui faz a troca falhar com uma mensagem clara, que é o menos ruim dos
-- desencontros possíveis: o avatar não aparece e some ao recarregar seria pior.

-- ===========================================================================
-- 1. A melhor sequência que a pessoa já teve
-- ===========================================================================
--
-- reader_streak() já existe e responde outra pergunta: a sequência de agora,
-- que morre quando alguém passa um dia sem ler. Serve para o ranking, onde o
-- assunto é o presente.
--
-- Para conquista ela seria cruel e errada: quem leu 40 dias seguidos ganhou a
-- Chama, e nenhum feriado desfaz isso. Por isso esta olha todas as ilhas de
-- datas e devolve a maior, sem exigir que termine hoje.
create or replace function reader_best_streak(p_owner uuid)
returns int
language sql
stable security definer set search_path = public
as $$
  with dias as (
    select distinct date from sessions where owner = p_owner
  ),
  ilhas as (
    select date - (row_number() over (order by date))::int as grupo
    from dias
  ),
  blocos as (
    select count(*)::int as tamanho from ilhas group by grupo
  )
  select coalesce(max(tamanho), 0) from blocos;
$$;

-- ===========================================================================
-- 2. A régua, que é uma lista
-- ===========================================================================
--
-- Devolve tudo que a conta já ganhou, de uma vez. A primeira versão respondia
-- sobre um avatar por chamada, e isso servia enquanto a única pergunta era
-- "posso gravar este?" — uma vez por troca de rosto.
--
-- Não serve mais. O perfil de quem se visita mostra as conquistas da pessoa,
-- e perguntar dezesseis vezes seria refazer as nove contagens dezesseis
-- vezes: cento e quarenta e quatro varreduras para desenhar uma fileira de
-- bolinhas. Contando uma vez e comparando dezesseis, é uma.
--
-- Os três primeiros são de graça, e por isso já entram na lista: escolher um
-- rosto não pode ser prêmio de ninguém — quem chegou hoje também tem cara.
create or replace function conquistas_do_leitor(p_owner uuid)
returns text[]
language plpgsql
stable security definer set search_path = public
as $$
declare
  v_meta smallint;
  n      record;
  r      text[] := array['leitor', 'marcador', 'pilha'];
begin
  select
    coalesce((select sum(s.pages)   from sessions s where s.owner = p_owner), 0) as paginas,
    coalesce((select sum(s.minutes) from sessions s where s.owner = p_owner), 0) as minutos,
    (select count(*) from books b where b.owner = p_owner and b.status = 'lido')    as livros,
    (select count(*) from books b where b.owner = p_owner and b.rating is not null) as avaliados,
    (select count(*) from notes t where t.owner = p_owner)                          as notas,
    (select count(*) from notes t where t.owner = p_owner and t.kind = 'quote')     as citacoes,
    (select count(*) from follows f where f.follower = p_owner)                     as seguindo,
    (select count(*) from books b
       where b.owner = p_owner and b.status = 'lido'
         and b.finished_at >= date_trunc('year', current_date))                     as livros_ano,
    reader_best_streak(p_owner)                                                     as streak
  into n;

  select p.goal_books into v_meta from profiles p where p.id = p_owner;

  if n.streak    >= 7     then r := r || 'chama';     end if;
  if n.streak    >= 30    then r := r || 'lua';       end if;
  if n.minutos   >= 600   then r := r || 'ampulheta'; end if;
  if n.minutos   >= 3000  then r := r || 'lampiao';   end if;
  if n.paginas   >= 1000  then r := r || 'mil';       end if;
  if n.paginas   >= 10000 then r := r || 'dezmil';    end if;
  if n.livros    >= 5     then r := r || 'torre';     end if;
  if n.livros    >= 25    then r := r || 'coluna';    end if;
  if n.notas     >= 10    then r := r || 'pena';      end if;
  if n.citacoes  >= 25    then r := r || 'aspas';     end if;
  if n.avaliados >= 5     then r := r || 'estrela';   end if;
  if n.seguindo  >= 5     then r := r || 'elo';       end if;
  -- A meta é escolhida, então a conquista só existe para quem escolheu.
  if v_meta is not null and n.livros_ano >= v_meta then r := r || 'coroa'; end if;

  return r;
end;
$$;

-- O portão continua fazendo a mesma pergunta, com a mesma assinatura — o
-- gatilho lá embaixo não sabe que nada mudou. Duas passagens livres antes da
-- conta: valor vazio (volta a ser a inicial do nome) e valor que não é do
-- catálogo — imagem hospedada é outro assunto, e quem decide sobre ela não é
-- esta função.
create or replace function avatar_liberado(p_owner uuid, p_avatar text)
returns boolean
language sql
stable security definer set search_path = public
as $$
  select case
    when p_avatar is null or p_avatar = ''  then true
    when left(p_avatar, 3) <> 'av:'         then true
    else substr(p_avatar, 4) = any (conquistas_do_leitor(p_owner))
  end;
$$;

-- ===========================================================================
-- 2b. A porta pública
-- ===========================================================================
--
-- Conquista que só o dono vê é meia conquista. Esta é a versão de fora: pelo
-- @, e só de perfil público, pela mesma fronteira que reader_card() aplica.
--
-- Perfil privado e @ inexistente devolvem nada — e devolvem a MESMA coisa, de
-- propósito. Distinguir "não existe" de "existe e é privado" transformaria
-- esta função num detector de contas privadas.
create or replace function conquistas_de(p_username citext)
returns text[]
language sql
stable security definer set search_path = public
as $$
  select conquistas_do_leitor(p.id)
  from profiles p
  where p.username = p_username and p.is_private = false;
$$;

-- ===========================================================================
-- 3. O portão
-- ===========================================================================
--
-- Só quando o avatar muda: quem edita a bio não tem por que pagar oito
-- contagens. E `before`, não `after`, porque a ideia é impedir a linha errada
-- de existir, não desfazê-la depois.
create or replace function profiles_valida_avatar()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.avatar_url is not distinct from old.avatar_url then
    return new;
  end if;

  if not avatar_liberado(new.id, new.avatar_url) then
    -- A mensagem vai inteira para a tela do usuário: o cliente procura a
    -- palavra "conquist" nela para explicar o caso mais comum, que é a
    -- leitura ainda não ter subido deste navegador.
    raise exception 'Este avatar ainda não foi conquistado.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_avatar_conquistado on profiles;
create trigger profiles_avatar_conquistado
  before update of avatar_url on profiles
  for each row execute function profiles_valida_avatar();
