-- Biblioteca — conquistas e avatares
--
-- Como aplicar: painel do Supabase -> SQL Editor -> cole este arquivo -> Run.
-- Idempotente: pode rodar de novo sem quebrar. Roda DEPOIS de resenhas.sql e
-- desafio.sql — ele lê books.rating e profiles.goal_books, que nascem lá.
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
-- 2. A régua
-- ===========================================================================
--
-- Devolve true quando o dono tem direito ao avatar pedido. Duas passagens
-- livres antes da conta: valor vazio (volta a ser a inicial do nome) e valor
-- que não é do catálogo — imagem hospedada é outro assunto, e quem decide
-- sobre ela não é esta função.
create or replace function avatar_liberado(p_owner uuid, p_avatar text)
returns boolean
language plpgsql
stable security definer set search_path = public
as $$
declare
  v_id   text;
  v_meta smallint;
  n      record;
begin
  if p_avatar is null or p_avatar = '' then return true; end if;
  if left(p_avatar, 3) <> 'av:' then return true; end if;

  v_id := substr(p_avatar, 4);

  -- Os três de graça. Existem porque escolher um rosto não pode ser prêmio de
  -- ninguém: quem chegou hoje também tem cara.
  if v_id in ('leitor', 'marcador', 'pilha') then return true; end if;

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

  return case v_id
    when 'chama'     then n.streak    >= 7
    when 'lua'       then n.streak    >= 30
    when 'ampulheta' then n.minutos   >= 600
    when 'lampiao'   then n.minutos   >= 3000
    when 'mil'       then n.paginas   >= 1000
    when 'dezmil'    then n.paginas   >= 10000
    when 'torre'     then n.livros    >= 5
    when 'coluna'    then n.livros    >= 25
    when 'pena'      then n.notas     >= 10
    when 'aspas'     then n.citacoes  >= 25
    when 'estrela'   then n.avaliados >= 5
    when 'elo'       then n.seguindo  >= 5
    -- A meta é escolhida, então a conquista só existe para quem escolheu.
    when 'coroa'     then v_meta is not null and n.livros_ano >= v_meta
    else false
  end;
end;
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
