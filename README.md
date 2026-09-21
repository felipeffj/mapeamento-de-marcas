# Mapeamento de Marcas — TOTVS Linx

Aplicação web servida via **Google Apps Script (Web App)** usada pelos analistas de implantação para documentar o *Mapeamento de Marca* de clientes Linx: o padrão de configuração da rede (Nível 1) e as exceções por loja durante o rollout (Nível 2). O documento final pode ser exportado como HTML "limpo" ou como texto em **Wiki Markup**, pronto para colar em uma página do Confluence (Share Jira/Linx Share).

## Sumário

- [Arquitetura](#arquitetura)
- [Estrutura de arquivos](#estrutura-de-arquivos)
- [Como publicar/rodar](#como-publicarrodar)
- [Funcionalidades](#funcionalidades)
- [Modelo de persistência](#modelo-de-persistência)
- [Limitações conhecidas](#limitações-conhecidas)
- [Análise técnica e pontos de melhoria](#análise-técnica-e-pontos-de-melhoria)
- [Persistência com compressão gzip e chunking — nota técnica](#persistência-com-compressão-gzip-e-chunking--nota-técnica)
- [Exportação para Wiki Markup (Confluence) — nota técnica](#exportação-para-wiki-markup-confluence--nota-técnica)
- [Roadmap sugerido](#roadmap-sugerido)

## Arquitetura

```
┌─────────────────────────┐        google.script.run        ┌───────────────────────────┐
│        Index.html       │ ───────────────────────────────▶ │          Code.gs           │
│  (HTML + Tailwind CDN +  │                                  │  doGet()                   │
│   Lucide Icons + JS      │ ◀─────────────────────────────── │  salvarEstadoCompleto()    │
│   inline, single file)   │        callback (json/erro)       │  carregarEstadoCompleto()   │
└─────────────────────────┘                                  │  resetarParaModeloPadrao() │
                                                               └───────────────────────────┘
                                                                         │
                                                                         ▼
                                                          PropertiesService.getUserProperties()
```

- **`Code.gs`**: backend do Google Apps Script. Serve o HTML (`doGet`) e expõe 3 funções de persistência baseadas em `PropertiesService` (armazenamento key/value por usuário).
- **`Index.html`**: front-end monolítico (HTML + CSS via Tailwind CDN + JS inline). Todo o estado do "documento" vive no DOM (`contenteditable`) dentro de `#documento-container`. Não há um modelo de dados estruturado (array de objetos) — o estado salvo é o **HTML inteiro serializado como string**.

## Estrutura de arquivos

```
mapeamento-de-marcas/
├── Code.gs        # Backend Apps Script (doGet + persistência em UserProperties)
└── Index.html     # Front-end único: cabeçalho, sidebar, Nível 1, Nível 2, scripts
```

## Como publicar/rodar

1. Criar um projeto no [Google Apps Script](https://script.google.com) (ou usar `clasp`).
2. Copiar `Code.gs` para o arquivo de script e `Index.html` como arquivo HTML.
3. Implantar como **Aplicativo da Web** (`Deploy > New deployment > Web app`):
   - Executar como: usuário que acessa (ou o proprietário, dependendo da política de acesso desejada).
   - Quem tem acesso: conforme política do domínio/organização.
4. Acessar a URL gerada — cada usuário autenticado terá seu próprio rascunho salvo (ver [Modelo de persistência](#modelo-de-persistência)).

> Recomenda-se usar [`clasp`](https://github.com/google/clasp) para versionar este projeto em Git e sincronizar com o Apps Script (`clasp push` / `clasp pull`), já que hoje o projeto não tem nenhum controle de versão nem pipeline de deploy.

## Funcionalidades

- **Nível 1 — Padrão da Marca**:
  - **Visão Geral do Projeto**: segmentada em 4 cards principais:
    - *Informações da Marca*: Nome da Marca / Projeto, Número da Franquia e Servidor.
    - *Responsáveis TOTVS*: Analista de Projeto, Analistas de Implantação (com badges múltiplos) e ECS Responsável.
    - *Qtd. Lojas Inicial*: quantidade em destaque com nota de previsão de escopo.
    - *Descrição da Operação*: resumo operacional e modelo de atendimento da marca.
  - Tabelas e listas editáveis (`contenteditable`): Ecossistema de Módulos e Sistemas, Jornada de Venda e Fluxo, Dados Técnicos e Acessos Globais, Infraestrutura e Hardware Padrão, e Regras de Negócio e Permissões.
- **Nível 2 — Exceções e Rollout**: tabela "quick view" de lojas + cards detalhados de exceção, com contadores automáticos (total, no padrão, com exceção, em implantação).
- **Adicionar/remover loja e exceção**: botões que criam linhas de tabela e cards via uma função unificada (`criarLojaCompleta()`), com geração de código sequencial sem colisão (`obterProximoCodigoLoja()`).
- **Exportar para Jira/Confluence**:
  - **Copiar Wiki Markup (Nível 1)** e **Copiar Wiki Markup (Nível 2)** — botões ativos na sidebar. Geram, a partir dos dados atuais de cada nível, um texto em [sintaxe clássica de wiki markup do Confluence](https://confluence.atlassian.com/doc/confluence-wiki-markup-251003035.html) (`{panel}`, `{status}`, `{warning}`, `{note}`, `{expand}`, tabelas `||...||`) e copiam para a área de transferência. Devem ser colados dentro da macro **Markup** do Confluence (inserida manualmente pelo usuário via `+`/Inserir → Markup), pois o editor novo do Confluence Server/Data Center não converte esse texto automaticamente se colado direto no corpo da página.
    - O Nível 1 inclui a tabela estruturada da Visão Geral do Projeto (Informações da Marca, Responsáveis TOTVS e Escopo), o painel de Descrição da Operação, Ecossistema de Módulos, Pontos Críticos, Dados Técnicos, Hardware e Regras de Negócio.
    - O Nível 2 inclui o resumo de rollout (total/padrão/exceções/implantação), a tabela quick-view de lojas (com badges coloridos por status) e o registro detalhado de cada exceção (painel com metadados + lista de divergências mapeadas). Se não houver nenhuma exceção registrada, o texto gerado indica isso explicitamente em vez de gerar uma seção vazia.
  - **Copiar HTML Limpo** / **Baixar .html** — ocultos por padrão na interface atual (ver decisão de UX abaixo), mas as funções (`copiarHTMLJira()`, `baixarHTML()`) continuam implementadas para uma eventual reativação futura. Exportam apenas o conteúdo de `#documento-container` (não a página inteira), envolvido num HTML mínimo e autocontido — sem CDNs externos, sem `<script>`, sem `contenteditable`/`onclick`/`oninput`/`onchange` e sem os atributos `data-lucide` (que ficariam como ícones "mortos" sem o script do Lucide).
    - *Motivo de estarem ocultos*: ao colar o HTML "limpo" em uma página do Confluence, praticamente todo o estilo visual (Tailwind) se perde — o resultado é funcional, mas visualmente pobre. A alternativa de Wiki Markup, embora exija montagem manual de macros, aproveita melhor os recursos nativos do Confluence.
- **Exportar/Importar projeto (.json)**: baixa/carrega um snapshot local do `innerHTML` do documento. A importação pede confirmação antes de sobrescrever o conteúdo atual, e o HTML lido do arquivo passa por `sanitizarHTMLDocumento()` antes de ser reinserido (ver nota de segurança abaixo).
- **Auto-save na nuvem com debounce**: alterações no documento (detectadas via `MutationObserver`) disparam `google.script.run.salvarEstadoCompleto()` após 3s de inatividade, com uma verificação de segurança adicional a cada 2 minutos. Falhas de salvamento/carregamento exibem um indicador visual de erro (`exibirErroSalvamento()`), e o carregamento inicial mostra um overlay de carregamento. O HTML recebido do Apps Script também passa por `sanitizarHTMLDocumento()` antes de ser reinserido no documento.
- **Reset para modelo padrão**: apaga o rascunho salvo e recarrega a página (volta ao HTML original do arquivo).

> **Nota de segurança:** `sanitizarHTMLDocumento(html)` remove `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` e qualquer atributo de evento (`on*`) que não seja uma chamada a uma das funções internas conhecidas do app (`alterarStatus`, `alterarStatusOperacional`, `alterarStatusExcecao`, `adicionarLinhaTabela`, `adicionarNovaExcecao`, `removerLinhaTabela`, `removerExcecao`, `recalcularContadores`), além de hrefs/srcs com esquema `javascript:`. Isso reduz o risco de um HTML colado num campo `contenteditable` (ou um `.json` de projeto compartilhado) reintroduzir um handler malicioso ao ser recarregado, sem quebrar os `onclick` legítimos dos badges/botões gerados dinamicamente.

## Modelo de persistência

O "banco de dados" é um conjunto de chaves nas *User Properties* do Apps Script, por usuário autenticado:

- `RASCUNHO_META`: metadado com a quantidade de "chunks" (pedaços) usados na última gravação — `{ chunks: N }`.
- `RASCUNHO_CHUNK_0`, `RASCUNHO_CHUNK_1`, ...: pedaços de até 8000 caracteres do JSON `{ conteudoHTML, timestamp }` (onde `conteudoHTML` é o `innerHTML` completo do container do documento), **comprimido com gzip e codificado em base64** antes de ser fatiado.
- `RASCUNHO_MAPEAMENTO_COMPLETO`: formato legado (string única, sem compressão), mantido apenas como *fallback* de leitura para rascunhos salvos antes desta mudança — nunca mais é escrito.

Ver [nota técnica sobre compressão/chunking](#persistência-com-compressão-gzip-e-chunking--nota-técnica) para detalhes da implementação.

## Limitações conhecidas

- `PropertiesService` tem limite de **9 KB por valor** e **500 KB de armazenamento total por usuário/script**. O HTML inteiro do documento facilmente ultrapassa 9 KB brutos (o template real já fica em ~40 KB só com o Nível 1 preenchido) — por isso o valor é comprimido (gzip) e fatiado em múltiplos "chunks" antes de ser salvo (ver [nota técnica](#persistência-com-compressão-gzip-e-chunking--nota-técnica)). Com compressão de ~80% em conteúdo real, a margem prática antes de esbarrar no limite total de 500 KB é bem maior, mas projetos **extremamente** grandes (centenas de lojas/exceções) ainda podem, em teoria, atingi-lo.
- Existe **apenas 1 slot de rascunho por usuário** (`RASCUNHO_META`/`RASCUNHO_CHUNK_*` são chaves fixas). Avaliado como **não sendo um problema prático**: o app já tem **Exportar/Importar projeto (.json)**, que cobre o cenário de um analista trabalhando em mais de uma marca — basta exportar o projeto atual antes de começar o próximo. Ver item 7.1 da análise para o raciocínio completo.
- Não há histórico/versionamento: o auto-save (por debounce, ~3s após a última edição) sobrescreve o estado anterior a cada save.

---

## Análise técnica e pontos de melhoria

Revisão do estado atual do código (`Index.html` + `Code.gs`), em 2026-09-18, confirmando o que já foi corrigido em sessões anteriores e o que ainda é uma pendência real.

### ✅ Itens já corrigidos e confirmados no código atual

| # | Item | Onde foi corrigido |
|---|------|---------------------|
| 1 | **Dados sensíveis no HTML.** O arquivo só contém placeholders (`[Nome da Marca]`, `admin@franquiamarca.com.br`, `@Analista`) e exemplos genéricos de hardware. Nenhum CNPJ, cliente real ou e-mail real. | Template já sanitizado. |
| 2 | **Falta de tratamento de erro no `google.script.run`.** As três chamadas (`autoSalvarNoGoogle`, `carregarEstadoGoogle`, `limparRascunhoGoogle`) agora têm `.withFailureHandler(...)`, exibindo um indicador visual de erro (`exibirErroSalvamento()`) em vez de falhar silenciosamente. | `autoSalvarNoGoogle`, `carregarEstadoGoogle`, `limparRascunhoGoogle` |
| 3 | **Bug do cancelamento em `alterarStatusExcecao`.** O `confirm()` agora é chamado **antes** de qualquer alteração de `textContent`/`className`; se o usuário cancelar, o badge e o card de exceção permanecem exatamente como estavam (sem dessincronia). | `alterarStatusExcecao` |
| 4 | **Geração de IDs por contagem de elementos.** Substituído por `obterProximoCodigoLoja()`, que calcula o próximo código a partir do **maior número já usado** na tabela (não da contagem de filhos) e garante, com um laço de verificação, que o `id` gerado ainda não existe no DOM — elimina colisão de IDs ao remover/adicionar lojas fora de ordem. | `obterProximoCodigoLoja` |
| 6 | **Auto-save incondicional a cada 15s.** Substituído por auto-save reativo por **debounce** (`marcarComoAlterado()` + `MutationObserver` no `#documento-container`, salva ~3s após a última edição real) com uma rede de segurança bem mais espaçada (a cada 2 min, só se houver algo pendente). | `marcarComoAlterado`, `autoSalvarNoGoogle`, `AUTO_SAVE_DEBOUNCE_MS`/`AUTO_SAVE_SEGURANCA_MS` |
| 7.4 | **Import de projeto sobrescrevia sem confirmação.** `importarArquivoProjeto()` agora exibe um `confirm()` antes de sobrescrever o documento em tela. | `importarArquivoProjeto` |
| 7.5 | **Sem indicador de carregamento inicial.** `carregarEstadoGoogle()` agora exibe um overlay (`exibirCarregando()`/`ocultarCarregando()`) até a resposta do `google.script.run` chegar. | `carregarEstadoGoogle` |
| 7.8 | **Duplicação de lógica entre `adicionarLinhaTabela` e `adicionarNovaExcecao`.** Unificadas em `criarLojaCompleta(codigo, elementId, nomeLoja, comExcecao)`, usada pelos dois fluxos. | `criarLojaCompleta` |

### ✅ Corrigidos nesta revisão (2026-09-18)

**5. Limpeza do HTML exportado para o Jira/Confluence — melhorada.** `obterHTMLTratado()` antes clonava o `<html>` inteiro (incluindo `<head>` com os `<script>` de CDN do Tailwind/Lucide e o `@import` de fonte do Google) e mantinha os atributos `data-lucide="..."` como ícones "mortos" (sem o script do Lucide para renderizá-los). Agora a função:
- Exporta **apenas o conteúdo de `#documento-container`**, envolvido num documento HTML mínimo e autocontido (sem nenhum CDN externo, sem `<script>`, com um `<style>` inline mínimo apenas para fonte/bordas de tabela).
- Remove o atributo `data-lucide` de todos os ícones (em vez de deixá-los como marcação morta).
- Continua removendo `contenteditable` e os atributos `onclick`/`oninput`/`onchange`, que não têm efeito fora da aplicação.

**7.3. `innerHTML` bruto salvo/restaurado sem nenhuma sanitização — corrigido.** Foi adicionada a função `sanitizarHTMLDocumento(html)`, aplicada tanto ao restaurar o rascunho vindo do Apps Script (`carregarEstadoGoogle`) quanto ao importar um arquivo `.json` de projeto (`importarArquivoProjeto`). Ela:
- Remove qualquer `<script>`, `<style>`, `<iframe>`, `<object>` e `<embed>` porventura presente no HTML restaurado.
- Remove todo atributo de evento (`on*`) **exceto** quando o valor é uma chamada a uma das funções internas que o próprio app usa nos badges/botões gerados dinamicamente (`alterarStatus`, `alterarStatusOperacional`, `alterarStatusExcecao`, `adicionarLinhaTabela`, `adicionarNovaExcecao`, `removerLinhaTabela`, `removerExcecao`, `recalcularContadores`) — preservando a interatividade legítima da tabela/cards, mas bloqueando um handler injetado (ex.: `<img onerror="...">` colado em um campo `contenteditable`).
- Remove `href`/`src` com o esquema `javascript:`.

> Não foi adotado `DOMPurify` (biblioteca externa) porque isso exigiria mais uma dependência de CDN (ver item 7.6, ainda em aberto) — a sanitização por *allowlist* acima cobre o cenário de risco real do app (HTML colado num `contenteditable` ou um `.json` de projeto de origem não totalmente confiável) sem quebrar os `onclick` que o próprio app depende para funcionar.

**7.2. Limite de 9 KB por propriedade — resolvido.** Foi confirmado, inclusive, que esse limite **já era ultrapassado na prática**: o HTML real do template (só o Nível 1 preenchido, sem nenhuma loja de exceção) já fica em ~40 KB, muito acima dos 9 KB permitidos por valor no `PropertiesService` — ou seja, o auto-save provavelmente já falhava silenciosamente em qualquer uso real antes desta correção (o item 2, feito em sessão anterior, ao menos passou a *avisar* essa falha, mas não resolvia a causa raiz).

A solução implementada em `Code.gs` **não exige nenhuma dependência externa nem migração para um novo modelo de dados** — usa apenas recursos nativos do Apps Script:
1. O JSON salvo é comprimido com **`Utilities.gzip()`** (gzip nativo do Apps Script) e codificado em base64 antes de ser persistido. Testado com o HTML real do projeto: **~80% de redução** (41 KB → ~8 KB), graças à repetição de classes Tailwind.
2. O resultado comprimido é **fatiado em múltiplos "chunks"** (`RASCUNHO_CHUNK_0`, `RASCUNHO_CHUNK_1`, ...) de até 8000 caracteres cada, cobrindo também projetos grandes o bastante para ultrapassar os 9 KB mesmo após a compressão (várias lojas/exceções). Uma chave de metadado (`RASCUNHO_META`) registra quantos chunks foram usados na última gravação.
3. Ao salvar um documento **menor** que o anterior, os chunks "órfãos" da gravação antiga são removidos (evita lixo acumulado).
4. **Compatibilidade com rascunhos antigos**: se não existir `RASCUNHO_META` (usuário que já tinha um rascunho salvo no formato antigo, sem compressão), `carregarEstadoCompleto()` cai de volta para a chave legada `RASCUNHO_MAPEAMENTO_COMPLETO`, sem quebrar o carregamento. Essa chave legada nunca mais é escrita — o próximo save do usuário já migra para o novo formato.
5. **Validado com uma simulação funcional** (mock de `PropertiesService`/`Utilities` com `zlib` do Node, replicando a mesma lógica): roundtrip de salvar/carregar com documento pequeno e grande (multi-chunk), limpeza de chunks órfãos ao salvar um documento menor, fallback para o formato legado e reset — todos os cenários passaram. Não foi possível testar chamando o `Utilities.gzip()` real do Apps Script (só roda no ambiente do Google), mas a lógica é a mesma.

Ver [nota técnica completa](#persistência-com-compressão-gzip-e-chunking--nota-técnica) para mais detalhes de implementação.

### ⚪ Avaliado e não implementado por decisão de escopo

**7.1. Um único slot de rascunho por usuário.** Após discussão, decidiu-se **não implementar** namespacing/múltiplos projetos por usuário: o app já tem **Exportar/Importar projeto (.json)**, que cobre exatamente esse cenário — um analista que for começar o mapeamento de uma nova marca pode exportar o projeto atual antes, e importá-lo de volta depois se precisar retomá-lo. Adicionar um sistema de múltiplos slots (seleção de projeto, `?projeto=` na URL, etc.) agregaria complexidade a mais na camada de persistência (novas chaves, migração, UI de seleção) para resolver um problema que já tem uma solução manual razoável e sob controle do próprio analista. Caso o padrão de uso mude no futuro (ex.: muitos analistas reclamando de perda de rascunho), vale reconsiderar.

### 🟡 Pendências reais que ainda restam (mudanças de arquitetura maiores)

| # | Problema | Impacto | Sugestão |
|---|----------|---------|----------|
| 7.6 | **Dependência de 3 CDNs externos** (Tailwind, Lucide, Google Fonts) carregados a cada acesso, sem fallback caso a rede/CDN falhe (comum em ambientes corporativos com proxy/allowlist restritiva). | Médio — pode quebrar a aplicação inteira em rede corporativa restrita. | Avaliar build local do Tailwind (CLI) e vendorizar os ícones usados, eliminando dependência de rede externa. |
| 7.7 | **Nenhum controle de versão** do projeto Apps Script (não há `.clasp.json`/histórico Git). | Médio — dificulta rollback e revisão de mudanças. | Adotar `clasp` + repositório Git (mesmo que privado) para o projeto Apps Script. |


Os itens 7.6 e 7.7 exigem decisões de arquitetura/processo (build de assets, workflow de deploy) e ainda não foram implementados — ver seção [Roadmap sugerido](#roadmap-sugerido) para a proposta de próximos passos.

## Persistência com compressão gzip e chunking — nota técnica

Implementado inteiramente em `Code.gs`, sem nenhuma dependência externa (usa apenas `Utilities`, nativo do Apps Script). Resolve o item 7.2 da análise técnica.

**Por que era necessário:** o estado salvo é o `innerHTML` completo do documento (Nível 1 + Nível 2, com todas as classes Tailwind). Mesmo um projeto simples (só o Nível 1 preenchido, sem nenhuma loja de exceção) já gera um HTML de ~40 KB — muito acima do limite de **9 KB por valor** do `PropertiesService`. Ou seja, o auto-save já estava, na prática, sujeito a falhar silenciosamente antes desta correção (o `.withFailureHandler`, adicionado em sessão anterior, passou a *avisar* a falha, mas não resolvia a causa).

**Como funciona (`salvarEstadoCompleto` / `carregarEstadoCompleto` / `resetarParaModeloPadrao`):**

1. **Compressão**: o JSON recebido (`{ conteudoHTML, timestamp }`) é comprimido com `Utilities.gzip()` e o resultado binário é codificado em base64 com `Utilities.base64Encode()` — texto HTML com muitas classes Tailwind repetidas comprime muito bem (~80% de redução medida com o template real do projeto: 41 KB → ~8 KB).
2. **Fatiamento (chunking)**: a string base64 comprimida é dividida em pedaços de até 8000 caracteres (`TAMANHO_CHUNK`), cada um salvo em uma propriedade própria (`RASCUNHO_CHUNK_0`, `RASCUNHO_CHUNK_1`, ...), com folga sob o limite de 9 KB por valor. Isso cobre também projetos grandes o bastante para ultrapassar 9 KB mesmo já comprimidos (muitas lojas/exceções).
3. **Metadado**: `RASCUNHO_META` guarda `{ chunks: N }`, usado para saber quantos pedaços reconstituir na leitura.
4. **Limpeza de chunks órfãos**: ao salvar um documento **menor** que o anterior (ex.: usuário removeu várias exceções), os chunks que sobraram da gravação anterior são excluídos antes de escrever os novos, evitando lixo acumulado.
5. **Compatibilidade com rascunhos antigos**: se `RASCUNHO_META` não existir (usuário que já tinha um rascunho salvo antes desta mudança, no formato de string única sem compressão), `carregarEstadoCompleto()` cai de volta para a chave legada `RASCUNHO_MAPEAMENTO_COMPLETO`. Essa chave nunca mais é escrita — o próximo save do usuário já migra automaticamente para o novo formato comprimido/fatiado.
6. **Reset**: `resetarParaModeloPadrao()` limpa tanto os chunks do formato novo quanto a chave legada.

**A interface com o front-end não mudou**: `Index.html` continua chamando `google.script.run.salvarEstadoCompleto(json)` / `.carregarEstadoCompleto()` exatamente como antes — toda a lógica de compressão/fatiamento é transparente para quem consome essas funções.

**Validação**: como `Utilities.gzip`/`Utilities.base64Encode` só existem no runtime do Apps Script (não é possível rodá-los localmente), a lógica foi validada por uma simulação funcional em Node.js, substituindo `PropertiesService`/`Utilities` por mocks equivalentes (usando o módulo `zlib` para gzip real) e executando o código de `Code.gs` num sandbox de `vm`. Cenários testados com sucesso: roundtrip de salvar/carregar com documento pequeno (1 chunk) e grande (múltiplos chunks), limpeza de chunks órfãos ao salvar um documento menor depois de um maior, fallback para o formato legado sem `RASCUNHO_META`, e reset completo.

## Exportação para Wiki Markup (Confluence) — nota técnica

A exportação para Wiki Markup (`gerarWikiMarkupNivel1()`/`copiarWikiMarkupNivel1()` e `gerarWikiMarkupNivel2()`/`copiarWikiMarkupNivel2()` em `Index.html`) não usa nenhuma biblioteca externa: lê os dados diretamente do DOM de cada nível e monta uma string em [sintaxe clássica de wiki markup do Confluence](https://confluence.atlassian.com/doc/confluence-wiki-markup-251003035.html). As duas exportações compartilham os mesmos helpers genéricos:

- `tabelaParaWikiMarkup(tabela, { colunasStatus, colunasIgnorar })`: converte uma `<table>` (thead/tbody) em tabela de wiki markup (`||cabeçalho||` / `|célula|`).
  - `colunasStatus` é um mapa `{ índiceDaColuna: resolverDeCor }` — cada coluna listada tem seu texto convertido em `{status:colour=...|title=...}`, usando o resolvedor de cor informado.
  - `colunasIgnorar` é uma lista de índices de colunas omitidas no texto final (ex.: a coluna "Ações" da Tabela Quick-View, que só tem botões/links sem sentido fora da interface).
- `resolverCorStatus(status)` / `resolverCorExcecao(status)`: mapeiam o texto do badge original para uma cor de `{status}`. Foram separados porque o mesmo texto "SIM" tem semânticas diferentes em cada tabela — no Ecossistema de Módulos, "SIM" é positivo (verde); na coluna "Tem Exceção?" da Tabela Quick-View, "SIM" é um alerta (amarelo), refletindo a cor original do badge na interface.
- `listaParaWikiMarkup(lista, marcador)`: converte um `<ol>`/`<ul>` em itens (`# item` ou `* item`).
- `listaRotuloValorParaWikiMarkup(container)`: converte uma lista de `<div>`s no formato rótulo/valor (não uma `<table>`) em uma tabela `||Item||Valor||`. Usada para "Dados Técnicos e Acessos Globais" no Nível 1.
- `escaparWikiMarkup(texto)`: faz *escape* de `{`, `}`, `[`, `]` em todo texto livre, para que o conteúdo digitado pelo analista não quebre a macro gerada.
- `obterNomeMarca()`: extrai o nome da marca com resiliência estrutural. Tenta pelo ID oficial (`campo-nome-marca-projeto`); se ausente (ex.: edição do `contenteditable` que removeu a tag `<span>` ou rascunho legado), localiza o card correspondente pelo rótulo semântico na seção de Visão Geral. Preserva textos válidos preenchidos pelo usuário com colchetes (ex.: `[Franquia VIP]`), descartando apenas o placeholder padrão literal (`[Nome da Marca]`).
- `obterElementoSecao(idPreferencial, termoTitulo, seletorInterno, containerRaiz)`: busca elementos estruturais pelo ID direto com fallback semântico pelo título da `<section>`, evitando que tabelas ou listas fiquem vazias caso IDs sejam perdidos ou alterados.
- `assegurarIdsEstruturais()`: verifica e reinjeta os IDs necessários nas tags correspondentes do DOM, recuperando rascunhos antigos salvos sem IDs.
- `restaurarConteudoDocumento(htmlRestaurado)`: restauração segura do HTML por aba (`#content-nivel1` e `#content-nivel2`). Se um rascunho salvo contiver apenas uma das abas (ex.: rascunho legado que só possuía o Nível 2), a outra aba de fábrica é **preservada** e não sobrescrita, eliminando o risco de perda do Nível 1.

**Nível 1 (`gerarWikiMarkupNivel1`)**: lê "Visão Geral do Projeto" (via `obterNomeMarca()`), o banner de instruções, e as seções de Ecossistema de Módulos, Hardware, Regras de Negócio, Pontos Críticos e Dados Técnicos (com fallbacks semânticos via `obterElementoSecao`).

**Nível 2 (`gerarWikiMarkupNivel2`)**: lê a marca global via `obterNomeMarca()`, o banner de instruções do Nível 2, os 4 cards de resumo de rollout (`#card-total`, `#card-padrao`, `#card-excecoes`, `#card-implantacao`), a Tabela Quick-View (com fallback via `obterElementoSecao`, ignorando a coluna "Ações" e colorindo "Status" e "Tem Exceção?" com resolvedores diferentes) e cada card do Registro Detalhado de Exceções (`#container-excecoes`), convertido por `cardExcecaoParaWikiMarkup()` em um título (`h3.`) + painel com metadados (razão, data, analista) + lista de divergências mapeadas. Se não houver nenhum card de exceção, a seção exibe o texto `_Nenhuma exceção registrada até o momento._` em vez de ficar vazia.

Em ambos os casos, o fluxo final é: sincronizar `<textarea>`s sem disparar o observador de auto-save → montar a string → copiar via `navigator.clipboard.writeText()` → exibir um toast informando o próximo passo (colar dentro da macro **Markup** do Confluence).

**Por que não é wiki markup "puro" digitado direto na página:** o Confluence Server 7.19 (versão confirmada em uso — ver `share.linx.com.br`) usa o **editor novo**, que não converte mais `{chave}` digitado como texto simples em uma macro (esse atalho só existia no editor clássico/legado). Por isso o texto gerado precisa ser colado dentro de uma macro específica que interpreta wiki markup (na prática, uma macro "Markup" habilitada no ambiente) — não existe, hoje, uma forma de automatizar 100% a colagem/formatação com um único clique.

## Roadmap sugerido

1. **✅ Concluído**
   - Bug do `confirm()` de cancelamento (#3).
   - `.withFailureHandler` em todas as chamadas `google.script.run` (#2).
   - Debounce + dirty flag no auto-save, no lugar do `setInterval` fixo (#6).
   - Geração de IDs com contador incremental persistido (#4).
   - `obterHTMLTratado()` exportando só o conteúdo do documento, sem scripts/CDNs (#5).
   - Sanitização por *allowlist* do HTML restaurado/importado (#7.3).
   - Confirmação antes de sobrescrever no import (#7.4) e overlay de carregamento inicial (#7.5).
   - Unificação de `criarLojaCompleta()` (#7.8).
   - Compressão gzip + chunking na persistência, resolvendo o limite de 9 KB por valor (#7.2).
2. **Avaliado e descartado por decisão de escopo**
   - Namespacing de múltiplos rascunhos por usuário (#7.1) — o Exportar/Importar `.json` já cobre esse caso de uso sem adicionar complexidade à persistência.
3. **Em aberto — próximos passos sugeridos**
   - **Vendorizar as 3 dependências de CDN** (#7.6): substituir `cdn.tailwindcss.com` por um CSS compilado localmente (Tailwind CLI, gerado uma vez e embutido no `<style>`), inlinar como SVG estático os ícones Lucide efetivamente usados (eliminando o `<script src="unpkg.com/lucide">`), e trocar o `@import` de fonte do Google Fonts por uma pilha de fontes de sistema (ou hospedar o arquivo de fonte junto ao projeto). Reduz a dependência de rede em ambientes corporativos restritivos.
   - **Adotar `clasp` + Git** (#7.7): inicializar um repositório Git para este projeto e configurar `clasp` (`clasp clone`/`clasp push`/`clasp pull`) para sincronizar com o Apps Script, permitindo histórico de commits, revisão de mudanças e rollback — hoje o único "histórico" é a memória de quem editou o script diretamente no editor do Apps Script.
   - **Migração para modelo de dados estruturado** (JSON com arrays de módulos/lojas/exceções, renderizando o HTML a partir dele): não é mais urgente para resolver o limite de 9 KB (já coberto pela compressão/chunking), mas continua sendo uma melhoria de longo prazo que habilitaria relatórios, validações de dados e exportações adicionais (ex.: planilha, dashboard) — considerar apenas se o app crescer em complexidade a ponto de justificar o esforço de reescrita.
