# Biblioteca

Sistema de leitura em um arquivo só. Abra o `index.html` no navegador e pronto — sem instalação, sem servidor, sem conta.

Feito para dar rotina à leitura: registrar o que foi lido, ver a sequência de dias não quebrar e saber quando o livro atual termina.

## O que faz

**Hoje** — meta diária em páginas e minutos, anel de progresso, sequência de dias (streak) e o registro rápido de sessão: escolhe o livro, digita "parei na página X" e o resto é calculado.

**Cronômetro** — aperte *Iniciar leitura* antes de começar. Ao encerrar, os minutos entram sozinhos e o app sugere em que página você deve estar, calculando pelo seu ritmo real (páginas por minuto do próprio livro, ou o geral se ainda não houver histórico). Você confirma ou corrige, e a sessão é gravada.

O tempo é medido por relógio absoluto e o estado fica salvo: bloquear a tela, trocar de aba, fechar o navegador ou recarregar a página não perde nem atrasa a contagem.

**Estante** — fila de leitura com quatro situações (quero ler, lendo, lido, abandonado), prioridade, busca e filtro. Registrar leitura em um livro da fila já o move para "lendo"; chegar na última página marca como lido.

**Progresso** — páginas nos últimos 30 dias, ritmo médio, livros concluídos no ano, tempo total. Gráfico de barras por semana e mapa de constância dia a dia, ambos com tabela equivalente para quem prefere os números.

**Notas** — citações e comentários por livro e página, com busca.

**Leitores** — busca, ranking, feed e perfil. Tocar no nome de alguém abre o
perfil, e o perfil abre a estante: o que a pessoa está lendo, o que já leu, o
que quer ler e as notas que deu, além das conquistas que ela ganhou. É o que
faz seguir alguém significar algo — antes disso, seguir um leitor levava a
três números e ponto.

**Conquistas** — dezesseis avatares desenhados no próprio app, três livres e
treze abertos por leitura: sequência de dias, horas, páginas, livros
concluídos, anotações, citações, avaliações, leitores seguidos e o desafio do
ano batido. Ficam no painel da conta, em *Seu avatar*, com a régua e o quanto
falta para cada um. O avatar escolhido aparece no feed, no ranking, nos
comentários e para quem visita seu perfil.

Nenhum deles é imagem hospedada — são SVG de duas linhas, o que mantém a
promessa de funcionar offline. E quem confere a conquista é o banco, não o
navegador: `supabase/conquistas.sql` recusa avatar que a conta não ganhou.

Quando uma conquista cai, o aviso na tela leva direto para a grade, o feed
anuncia para quem te segue, e o avatar escolhido vai junto no cartão que você
compartilha.

## Onde ficam os dados

Em dois lugares ao mesmo tempo: no `localStorage` do navegador, para o app
abrir instantâneo e funcionar offline, e na sua conta, para você reencontrar
tudo em qualquer aparelho.

A sincronização é automática — não há botão de enviar. O que você registra
sobe segundos depois; o que outro aparelho registrou desce quando você abre o
app ou volta para a aba. Sem conexão, as alterações ficam esperando e sobem
sozinhas quando a rede volta; o painel da conta mostra quantas estão na fila.

Como cada registro carrega o mesmo id nos dois lados, sincronizar duas vezes
não duplica nada, e apagar num aparelho apaga no outro. Em empate — o mesmo
livro alterado nos dois lugares — vence a alteração que ainda não tinha
subido: dado registrado nunca é descartado por dedução.

**Exportar (.json)** e **Importar**, no rodapé da aba Progresso, continuam
existindo para quem quer uma cópia fora do sistema.

## Busca de metadados (opcional)

O campo *Buscar dados do livro* consulta a [Open Library](https://openlibrary.org/dev/docs/api/search) e preenche título, autor, ano, número de páginas, capa, ISBN e sinopse.

- É o único ponto do app que usa internet. Só o texto digitado na busca sai daqui.
- Sem conexão, ou se o livro não estiver no catálogo, todos os campos continuam preenchíveis à mão.
- A cobertura é boa para literatura e fraca para títulos técnicos brasileiros. Nesses casos, use o campo **Capa** para escolher uma imagem do seu computador — ela é reduzida para 360px e guardada junto com os dados.
- O número de páginas é o da edição que a Open Library conhece, que pode não ser a sua. Confira, porque é o que alimenta a previsão de término.

## Instalar como app (PWA)

Publicado em qualquer host HTTPS — Vercel, GitHub Pages, Netlify — o app pode ser instalado:

- **Android/Chrome:** menu → *Instalar app*
- **iPhone/Safari:** compartilhar → *Adicionar à Tela de Início*
- **Desktop:** ícone de instalar na barra de endereço

Instalado, ele ganha ícone próprio, abre em tela cheia sem barra do navegador e **funciona offline** — um service worker guarda o app em cache. Só a busca de metadados precisa de internet.

Segurar o ícone abre o atalho *Registrar leitura*.

Atualizações aparecem sozinhas: o service worker busca a versão nova pela rede quando há conexão, e só cai no cache quando não há.

## Publicar

É estático puro, sem build. Na Vercel: importe o repositório, *Framework Preset* → **Other**, e deixe build, output e install vazios. Cada `git push` na `main` redeploya.

## Stack

HTML, CSS e JavaScript sem dependências, sem build, sem framework. Gráficos em SVG escrito à mão. Tema claro e escuro. Ícones gerados por script.

## Licença

MIT
