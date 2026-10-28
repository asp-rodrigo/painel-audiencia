# Painel de Audiência (TV e Rádio)

Dashboard local que lê automaticamente os dados publicados em
<https://www.fifty5blue.com/pt/dados-de-audiencia> (IBOPE) e os apresenta em gráficos e tabelas.

- **TV · Top 10 semanal**: os 10 programas mais vistos de GLOBO, RECORD, SBT, BAND e REDE TV!
  na PNT (15 praças), Grande São Paulo e Grande Rio de Janeiro. Inclui o histórico desde 2016,
  quando as 15 praças vinham separadas.
- **Rádio · trimestral**: total de emissoras, com o detalhe de FM, AM e Web por praça. A partir de 2022
  os dados estão em ouvintes por minuto (OPM); de 2014 a 2022, em índice de audiência (%).

- **Comercial · SBT e RECORD**: grade comercial de São Paulo (SP1) lida das planilhas da pasta
  `planilhas/`, com preço, valor unitário, pontos e custo por ponto de cada programa, mês a mês.
  Os pontos são comparados à audiência domiciliar do IBOPE em Grande São Paulo, quando o programa
  entra no Top 10 da semana.

Não precisa de deploy, instalação de pacotes nem banco de dados: só do **Node.js 18 ou superior**.

## Grade comercial (planilhas)

- Salve os arquivos `.xlsx` na pasta `planilhas/`. O painel percebe quando um arquivo é adicionado
  ou salvo de novo e se atualiza em até 30 segundos. Arquivos do Numbers precisam ser exportados
  antes: **Arquivo → Exportar para → Excel**.
- Cada aba é uma emissora em um mês. O nome da aba precisa ter a emissora (SBT ou RECORD), o mês
  por extenso e o ano, por exemplo `SBT JULHO 2024`. Abas sem mês no nome aparecem como "Aba sem mês"
  e ficam fora da linha do tempo.
- As colunas são reconhecidas pelo cabeçalho: DIA, HORA, PROGRAMA, SÃO PAULO (preço de tabela),
  Valor Unitario e Pontos de audiencia. O custo por ponto é recalculado como valor unitário ÷ pontos.
- Se duas abas trouxerem a mesma emissora e o mesmo mês, vale a do arquivo salvo por último.
- **Esses dados são internos e não vão para o site público.** A pasta `planilhas/` fica fora do git,
  e `npm run build` só inclui a grade se você pedir explicitamente com `INCLUIR_COMERCIAL=1`.

## Como usar

**Opção 1:** dê dois cliques em **`Iniciar Painel.command`** no Finder. O navegador abre sozinho em
<http://localhost:3000>. Para encerrar, feche a janela do Terminal.

**Opção 2:** pelo Terminal, dentro desta pasta:

```bash
npm start
```

## Como a atualização automática funciona

1. Ao iniciar, e depois **a cada 60 minutos**, o servidor consulta a API pública do WordPress do site
   (`/pt/wp-json/wp/v2/posts`) nas categorias *Audiência TV* e *Audiência de Rádio*.
2. Só os posts novos ou editados são baixados: a busca para no primeiro post já conhecido.
   Normalmente são 2 requisições por verificação.
3. As tabelas HTML de cada post são convertidas em dados e salvas em `data/posts/`, um arquivo por post.
4. O painel aberto no navegador verifica o servidor a cada 30 s. Quando chega uma semana nova,
   ele se atualiza sozinho e mostra um aviso. O botão **Verificar agora** força uma verificação.

As requisições respeitam o `Crawl-delay: 10` do `robots.txt` do site, ou seja, 10 s entre páginas.

## Versão online (GitHub Pages)

O mesmo painel também é publicado como site estático no GitHub Pages e se atualiza sozinho,
sem depender de nenhum computador ligado:

1. O workflow `.github/workflows/atualizar-painel.yml` roda nos servidores do GitHub às 9h, 15h e 20h
   (horário de Brasília). Também dá para rodar na hora em **Actions → Atualizar painel → Run workflow**.
2. Ele executa `node scripts/build-site.js`, que busca os posts novos, salva os arquivos em `data/posts/`
   e gera o site em `dist/`.
3. Se chegou algum post, os arquivos novos entram no repositório. Em seguida o site é publicado.
4. Quem estiver com o site aberto recebe a atualização em até 10 minutos, sem recarregar.

Se uma verificação falhar, por exemplo porque o site do IBOPE recusou o acesso, o GitHub manda um
e-mail para o dono do repositório e o site continua no ar com os últimos dados. O painel mostra
"Sem atualização desde…" se passar dois dias sem uma verificação bem-sucedida.

Para gerar o site estático no seu computador: `npm run build`, que cria a pasta `dist/`.

## Configuração (opcional)

| Variável | Padrão | O que faz |
|---|---|---|
| `PORT` | `3000` | Porta local do painel |
| `SYNC_INTERVAL_MIN` | `60` | Intervalo entre verificações de novas postagens |
| `REQUEST_DELAY_MS` | `10000` | Pausa entre requisições ao site |

Exemplo: `PORT=8080 SYNC_INTERVAL_MIN=30 npm start`

## Arquivos

```
server.js                 servidor local
scripts/build-site.js     gera a versão estática (GitHub Pages)
lib/sync.js               busca de posts novos na API do site
lib/store.js              armazenamento dos posts e montagem dos dados do painel
lib/parse.js              leitura das tabelas HTML (TV e Rádio)
lib/xlsx.js               leitura de planilhas .xlsx (sem dependências)
lib/comercial.js          interpretação da grade comercial e cruzamento com o IBOPE
planilhas/                planilhas da grade comercial (fora do git)
public/                   dashboard (HTML, CSS e gráficos SVG próprios, sem bibliotecas externas)
data/posts/               um arquivo JSON por post (gerado automaticamente)
```

- Se `data/posts/` for apagada, o histórico completo é baixado de novo na próxima execução.
  Isso leva cerca de 4 minutos por causa do intervalo entre requisições.
- O HTML original de cada post fica salvo. Se o parser for melhorado, aumente `PARSER_VERSION`
  em `lib/store.js`, e todo o histórico é reprocessado sem baixar nada.

## Limitações

- O painel depende da estrutura atual das tabelas do site. Se o formato mudar, os posts novos
  podem não aparecer até o parser (`lib/parse.js`) ser ajustado.
- A atualização só ocorre enquanto o servidor está rodando.
- Posts especiais, como Copa e Olimpíadas, que não seguem o formato do ranking semanal, são ignorados.
