# Biblioteca

Sistema de leitura em um arquivo só. Abra o `index.html` no navegador e pronto — sem instalação, sem servidor, sem conta.

Feito para dar rotina à leitura: registrar o que foi lido, ver a sequência de dias não quebrar e saber quando o livro atual termina.

## O que faz

**Hoje** — meta diária em páginas e minutos, anel de progresso, sequência de dias (streak) e o registro rápido de sessão: escolhe o livro, digita "parei na página X" e o resto é calculado.

**Estante** — fila de leitura com quatro situações (quero ler, lendo, lido, abandonado), prioridade, busca e filtro. Registrar leitura em um livro da fila já o move para "lendo"; chegar na última página marca como lido.

**Progresso** — páginas nos últimos 30 dias, ritmo médio, livros concluídos no ano, tempo total. Gráfico de barras por semana e mapa de constância dia a dia, ambos com tabela equivalente para quem prefere os números.

**Notas** — citações e comentários por livro e página, com busca.

## Onde ficam os dados

No `localStorage` do navegador que você usar. Nada sai da sua máquina.

Consequências práticas:

- Use sempre o mesmo navegador e o mesmo perfil.
- Não sincroniza entre dispositivos sozinho.
- Limpar dados do navegador apaga tudo.

Por isso existem **Exportar (.json)** e **Importar** no rodapé da aba Progresso. Exporte de vez em quando.

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
