#!/usr/bin/env python3
"""Confere se os dois catálogos de avatares concordam.

    python supabase/confere-catalogo.py

O catálogo de avatares existe em dois lugares e precisa ser o mesmo nos dois:

  - avatares.js       desenha o rosto e mostra a régua na tela
  - conquistas.sql    decide quem tem direito a ele, no banco

São dois porque têm trabalhos diferentes — um desenha, o outro julga —, e o
segundo tem que estar no servidor pelo motivo de sempre: a chave anônima está
no navegador de todo mundo, e recompensa que o premiado carimba sozinho é um
campo de texto com nome bonito.

O preço dessa separação é este script. Acrescentar avatar de um lado só não
quebra nada na hora: o rosto aparece na grade, a pessoa escolhe, e o banco
recusa. O erro só existe para quem tentou usar aquele avatar específico, que é
o jeito mais lento possível de descobrir um problema.

Só biblioteca padrão de propósito. Este repositório não tem build nem
dependências, e uma conferência que exige instalar coisa antes é uma
conferência que ninguém roda.
"""

import re
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


def do_js(texto):
    """Os ids do catálogo de avatares.js, na ordem em que aparecem."""
    return re.findall(r'\{\s*id:\s*"([a-z]+)"', texto)


def do_sql(texto):
    """Os ids de conquistas.sql: os livres da lista inicial, mais um por regra."""
    inicial = re.search(r"r\s+text\[\]\s*:=\s*array\[([^\]]*)\]", texto)
    livres = re.findall(r"'([a-z]+)'", inicial.group(1)) if inicial else []
    return livres + re.findall(r"r\s*\|\|\s*'([a-z]+)'", texto)


def main():
    js = do_js((RAIZ / "avatares.js").read_text(encoding="utf-8"))
    sql = do_sql((RAIZ / "supabase" / "conquistas.sql").read_text(encoding="utf-8"))

    if not js or not sql:
        print("não achei catálogo em um dos arquivos — o formato mudou?")
        return 2

    so_js = [i for i in js if i not in sql]
    so_sql = [i for i in sql if i not in js]
    repetido = [i for i in set(js) if js.count(i) > 1 or sql.count(i) > 1]

    print(f"avatares.js    {len(js):>3}")
    print(f"conquistas.sql {len(sql):>3}")

    if not so_js and not so_sql and not repetido:
        print("\nos dois concordam.")
        return 0

    if so_js:
        print(f"\nsó em avatares.js: {', '.join(so_js)}")
        print("  A grade mostra estes, e o banco recusa quem tentar usá-los.")
        print("  Falta a regra em conquistas.sql.")
    if so_sql:
        print(f"\nsó em conquistas.sql: {', '.join(so_sql)}")
        print("  Regra órfã: ninguém consegue pedir estes, porque não há desenho.")
    if repetido:
        print(f"\nid repetido: {', '.join(repetido)}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
