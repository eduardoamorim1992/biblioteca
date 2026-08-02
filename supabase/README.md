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
3. Em **Authentication → Providers**, deixe *Email* ligado. Google é opcional.
4. Em **Project Settings → API**, copie a **Project URL** e a chave **anon public**.

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

## Estado

O SQL foi validado pelo parser oficial do Postgres: 73 comandos e os corpos das três funções `language sql`. Isso garante sintaxe, **não** garante comportamento — os dois gatilhos em `plpgsql` e todas as políticas de RLS só podem ser testados contra um banco de verdade, o que exige o projeto criado.

Próximas etapas, nesta ordem:

1. **Contas** — tela de entrada, criação de conta, e migração do que já está no navegador para a conta.
2. **Perfil e ranking** — página pública do leitor e classificação.
3. **Social** — seguir, feed, curtidas e comentários.
