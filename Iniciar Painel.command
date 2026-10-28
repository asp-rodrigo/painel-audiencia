#!/bin/zsh
# Clique duas vezes neste arquivo (no Finder) para iniciar o painel e abri-lo no navegador.
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js não encontrado. Instale em https://nodejs.org (versão 18 ou superior) e tente de novo."
  read -k1 "?Pressione qualquer tecla para fechar…"
  exit 1
fi
echo "Iniciando o Painel de Audiência… (feche esta janela ou pressione Ctrl+C para encerrar)"
node server.js --open
