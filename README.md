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

## Stack

HTML, CSS e JavaScript sem dependências. Gráficos em SVG escrito à mão. Tema claro e escuro.

## Licença

MIT
