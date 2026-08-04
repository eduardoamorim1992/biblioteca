# Backend da rede social

O app hoje é um arquivo estático com tudo no navegador. Para virar rede social ele precisa de contas, banco e servidor. Esta pasta é essa camada.

## Escolha

**Supabase.** Postgres de verdade (o ranking é uma consulta com janela, coisa que banco de documentos não faz bem), login pronto, e segurança por linha aplicada no próprio banco. O front continua estático e segue publicado na Vercel do jeito que está — o que muda é que ele passa a falar com uma API.

As alternativas e por que não: Firebase resolveria o feed ao vivo, mas o ranking viraria gambiarra; API própria em Node dá controle total ao custo de eu escrever autenticação e sessão do zero, que é exatamente onde erro de principiante vira vazamento.

## Decisão de privacidade

Agregado é público, granular é privado.

Ninguém vê a que horas você leu, nem quanto tempo levou em cada sessão. A tabela `sessions` é fechada até para usuários autenticados — só o dono lê. O que alimenta ranking e perfil são funções `security definer` que leem essas linhas e devolvem **apenas somas**. Anotações nascem privadas e só aparecem se marcadas como públicas.

Perfil marcado como privado sai do ranking e do feed.

## Como aplicar

1. Crie um projeto em [supabase.com](https://supabase.com) (plano gratuito serve).
2. No painel: **SQL Editor** → cole o `schema.sql` inteiro → **Run**.
3. No mesmo lugar, cole o `feed.sql` → **Run**. É o que liga o feed: conserta o
   gatilho que publicava importação como se fosse notícia e cria a função que
   monta a linha do tempo. Sem este passo o app avisa na tela, em vez de quebrar.
4. Em **Authentication → Providers**, deixe *Email* ligado. Google é opcional.
5. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.

Para valer com gente de verdade, falta um passo que não é SQL: em
**Authentication → Emails**, ligar um SMTP próprio (Resend, Brevo, SendGrid). O
serviço embutido do Supabase manda pouquíssimos e-mails por hora, e como a
confirmação de cadastro é obrigatória, quem não recebe o link fica preso do lado
de fora — com a senha certa.

A chave `anon` é feita para ficar no front — ela não dá acesso a nada por si só, quem decide o que ela enxerga são as políticas de RLS deste arquivo. Já a chave `service_role` **nunca** vai para o navegador nem para o Git: ela ignora todo o RLS.

## O que o schema cria

| Tabela | Para quê |
|---|---|
| `profiles` | usuário público: apelido, nome, bio, avatar, privado ou não |
| `books`, `sessions`, `notes` | os mesmos dados de hoje, agora por dono |
| `follows` | quem segue quem |
| `activities` | o feed; alimentado por gatilho quando um livro começa ou termina |
| `likes`, `comments` | interações |
| `reports` | denúncia de comentário ou atividade |

Funções:

- `reader_streak(uuid)` — sequência de dias consecutivos, por ilhas de datas
- `leaderboard(período, métrica, limite)` — ranking por páginas, livros ou sequência; semana, mês, ano ou geral
- `reader_card(username)` — o cartão do perfil público
- `feed(escopo, limite, antes)` — a linha do tempo em uma consulta só, já com autor, livro, citação, contagem de curtidas e comentários, e se fui eu que curti

## Por que o feed não é uma consulta simples

Montar a tela com PostgREST puro custaria cinco viagens: atividades, autores, curtidas, "fui eu que curti" e contagem de comentários. Em rede de celular isso é a diferença entre abrir e esperar. A função devolve tudo de uma vez.

Ela é `security definer` porque precisa contar curtidas e comentários de todo mundo — e é justamente por isso que o `WHERE` dela é a fronteira de privacidade, escrita à mão: ou a atividade é sua, ou é de um perfil público. Perfil privado não vaza nem para quem o segue.

## Estado

O `schema.sql` foi validado pelo parser oficial do Postgres: 73 comandos e os corpos das três funções `language sql`. O `feed.sql` passou pelo mesmo parser: 8 comandos e o corpo da função `feed`.

Isso garante sintaxe, **não** garante comportamento. Os gatilhos em `plpgsql` continuam conferidos só à mão — a validação de plpgsql da biblioteca falha até com uma função trivial de três linhas, então não dá para confiar nela como prova.

Próximas etapas, nesta ordem:

1. ~~**Contas**~~ — feito: entrada, criação de conta e sincronização automática.
2. ~~**Perfil e ranking**~~ — feito.
3. ~~**Feed, curtidas e comentários**~~ — feito, com denúncia e publicação de citação.
4. **Clubes de leitura** — ler o mesmo livro junto, com discussão por capítulo. Precisa de tabelas novas: `clubs`, `club_members`, `club_reads`.
5. **Moderação** — a tabela `reports` já recebe denúncia; falta uma tela para quem modera.
