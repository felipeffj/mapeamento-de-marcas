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

- **Nível 1 — Padrão da Marca**: tabelas editáveis (`contenteditable`) com módulos/sistemas, hardware padrão e regras de negócio.
- **Nível 2 — Exceções e Rollout**: tabela "quick view" de lojas + cards detalhados de exceção, com contadores automáticos (total, no padrão, com exceção, em implantação).
- **Adicionar/remover loja e exceção**: botões que criam linhas de tabela e cards via uma função unificada (`criarLojaCompleta()`), com geração de código sequencial sem colisão (`obterProximoCodigoLoja()`).
- **Exportar para Jira/Confluence**:
  - **Copiar Wiki Markup (Nível 1)** e **Copiar Wiki Markup (Nível 2)** — botões ativos na sidebar. Geram, a partir dos dados atuais de cada nível, um texto em [sintaxe clássica de wiki markup do Confluence](https://confluence.atlassian.com/doc/confluence-wiki-markup-251003035.html) (`{panel}`, `{status}`, `{warning}`, `{note}`, `{expand}`, tabelas `||...||`) e copiam para a área de transferência. Devem ser colados dentro da macro **Markup** do Confluence (inserida manualmente pelo usuário via `+`/Inserir → Markup), pois o editor novo do Confluence Server/Data Center não converte esse texto automaticamente se colado direto no corpo da página.
    - O Nível 2 inclui o resumo de rollout (total/padrão/exceções/implantação), a tabela quick-view de lojas (com badges coloridos por status) e o registro detalhado de cada exceção (painel com metadados + lista de divergências mapeadas). Se não houver nenhuma exceção registrada, o texto gerado indica isso explicitamente em vez de gerar uma seção vazia.
  - **Copiar HTML Limpo** / **Baixar .html** — ocultos por padrão na interface atual (ver decisão de UX abaixo), mas as funções (`copiarHTMLJira()`, `baixarHTML()`) continuam implementadas para uma eventual reativação futura. Geram uma cópia "limpa" do HTML (remove `<script>`, `contenteditable`, `onclick`/`oninput`/`onchange`, sidebar, overlay, toast, menu mobile).
    - *Motivo de estarem ocultos*: ao colar o HTML "limpo" em uma página do Confluence, praticamente todo o estilo visual (Tailwind) se perde — o resultado é funcional, mas visualmente pobre. A alternativa de Wiki Markup, embora exija montagem manual de macros, aproveita melhor os recursos nativos do Confluence.
- **Exportar/Importar projeto (.json)**: baixa/carrega um snapshot local do `innerHTML` do documento. A importação pede confirmação antes de sobrescrever o conteúdo atual.
- **Auto-save na nuvem com debounce**: alterações no documento (detectadas via `MutationObserver`) disparam `google.script.run.salvarEstadoCompleto()` após 3s de inatividade, com uma verificação de segurança adicional a cada 2 minutos. Falhas de salvamento/carregamento exibem um indicador visual de erro (`exibirErroSalvamento()`), e o carregamento inicial mostra um overlay de carregamento.
- **Reset para modelo padrão**: apaga o rascunho salvo e recarrega a página (volta ao HTML original do arquivo).

## Modelo de persistência

O "banco de dados" é uma única chave (`RASCUNHO_MAPEAMENTO_COMPLETO`) nas *User Properties* do Apps Script, por usuário autenticado. O valor salvo é um JSON `{ conteudoHTML, timestamp }`, onde `conteudoHTML` é o `innerHTML` completo do container do documento.

## Limitações conhecidas

- `PropertiesService` tem limite de **9 KB por valor** e **500 KB de armazenamento total por usuário/script**. Como o valor salvo é o HTML inteiro (com todas as classes Tailwind, ícones etc.), projetos com muitas lojas/exceções podem estourar esse limite silenciosamente (sem tratamento de erro — ver item 2 da análise).
- Existe **apenas 1 slot de rascunho por usuário** — um analista que mapeia mais de uma marca no mesmo dia sobrescreve o rascunho anterior sem aviso.
- Não há histórico/versionamento: o auto-save sobrescreve o estado anterior a cada 15s.

---

## Análise técnica e pontos de melhoria

Revisão do estado atual do código (`Index.html` + `Code.gs`), confirmando/atualizando a lista anterior e adicionando novos achados.

> **Status de implementação:** os itens **1 a 6** e **7.4, 7.5, 7.8** desta análise já foram corrigidos no código atual (ver histórico de commits/sessão). O texto abaixo foi mantido como registro da análise original que motivou as correções; onde aplicável, os trechos de código mostrados refletem o estado **anterior** ao fix.

### 1. Dados sensíveis no HTML — ✅ já resolvido no arquivo atual
O arquivo hoje só contém placeholders (`[Nome da Marca]`, `[Ex: 15 lojas]`, `admin@franquiamarca.com.br`, `@Analista`) e exemplos genéricos de hardware (Sunmi, Gertec, Epson, Toledo). Não há CNPJ, nome de cliente real, e-mail real nem dado identificável no template atual. **Ação recomendada**: manter esse cuidado como regra de contribuição (nunca commitar um rascunho exportado com dados reais de cliente) e adicionar isso ao guia de contribuição.

### 2. Falta de tratamento de erro no `google.script.run` — confirmado, ainda presente
As três chamadas (`autoSalvarNoGoogle`, `carregarEstadoGoogle`, `limparRascunhoGoogle`) só definem `.withSuccessHandler(...)`, sem `.withFailureHandler(...)`. Isso significa que:
- Se o `PropertiesService` estourar o limite de 9 KB (bem provável em projetos grandes, ver seção anterior), o auto-save falha **silenciosamente** — o usuário acha que está salvando a cada 15s, mas nada é persistido.
- Erros de sessão expirada, quota do Apps Script, ou falha de rede não geram nenhum feedback visual.

**Correção sugerida**: adicionar `.withFailureHandler(erro => exibirErroSalvamento(erro))` em todas as chamadas, com um toast/indicador de erro visível (ex.: "⚠️ Falha ao salvar, tentando novamente...").

### 3. Bug do cancelamento em `alterarStatusExcecao` — confirmado
```js
function alterarStatusExcecao(el, targetCardId) {
  const status = el.textContent.trim().toUpperCase();
  if (status === "SIM") {
    el.textContent = "NÃO";                 // <- já muda a UI...
    el.className = "bg-slate-100 ...";
    const card = document.getElementById(targetCardId);
    if (card && confirm("Deseja remover o registro detalhado dessa exceção?")) {
      card.remove();
      recalcularContadores();
    }
    // se o usuário clicar "Cancelar" no confirm(), o badge já ficou "NÃO"
    // mas o card de exceção continua existindo -> estado inconsistente
  }
  ...
}
```
Se o usuário clicar **Cancelar** no `confirm()`, o rótulo já foi trocado para "NÃO" e a classe visual já mudou, mesmo que o card de exceção continue no DOM. Isso deixa a tabela e o card dessincronizados (o card mostra a exceção detalhada, mas a badge diz "NÃO").

**Correção sugerida**: só alterar `textContent`/`className` **depois** de confirmar a remoção; se o usuário cancelar, não tocar no elemento:
```js
function alterarStatusExcecao(el, targetCardId) {
  const status = el.textContent.trim().toUpperCase();
  if (status === "SIM") {
    if (!confirm("Deseja remover o registro detalhado dessa exceção?")) return;
    el.textContent = "NÃO";
    el.className = "bg-slate-100 text-slate-600 text-xs font-semibold px-2.5 py-0.5 rounded cursor-pointer select-none";
    const card = document.getElementById(targetCardId);
    if (card) card.remove();
    recalcularContadores();
  } else { ... }
}
```

### 4. Geração de IDs por contagem de elementos — confirmado, com um problema adicional
Duas funções diferentes geram o código da loja (`L00X`) de duas formas diferentes:
- `adicionarLinhaTabela()` → `codigo = tbody.children.length + 1`
- `adicionarNovaExcecao()` → `codigo = container.children.length + 2` (offset diferente, propositalmente compensando a linha de exemplo `L001`, mas frágil)

Como o número é baseado na **contagem atual de filhos**, e não em um contador incremental global nem no maior código já usado:
- Remover uma loja do meio da lista e adicionar outra gera um `id` (`loja-lXXX`) **já existente no DOM** → `document.getElementById` passa a retornar sempre o primeiro elemento com aquele id, e botões de "Ver Exceção"/"Excluir" passam a agir na loja errada.
- Como as duas funções usam contadores independentes (tabela vs. container de exceções), clicar em "Adicionar Loja" e "Adicionar Nova Exceção" em sequências diferentes pode gerar o mesmo código para lojas diferentes.

**Correção sugerida**: manter um contador incremental persistido (ex.: `data-next-id` num elemento pai, ou parte do estado salvo) que só cresce, nunca reaproveitando números removidos; ou gerar IDs a partir de um contador global armazenado em `obterEstadoGeralJSON`/carregado junto com o estado, garantindo unicidade mesmo após exclusões.

### 5. Limpeza do HTML exportado para o Jira — parcialmente resolvido, pode melhorar bastante
`obterHTMLTratado()` hoje remove: `contenteditable`, sidebar, overlay e o toast. Porém a exportação ainda:
- Clona o **`<html>` inteiro**, incluindo `<head>` com `<script src="https://cdn.tailwindcss.com">`, `<script src="https://unpkg.com/lucide@latest">` e o `<style>` com `@import` de fonte do Google — ou seja, ao colar no Jira, o conteúdo tenta carregar 3 recursos externos e reprocessar Tailwind/Lucide, o que normalmente é bloqueado/ignorado pelo editor do Jira e gera HTML poluído.
- Mantém **todos os `<script>` inline** com toda a lógica da aplicação (funções, `setInterval`, chamadas a `google.script.run`) dentro do HTML exportado — isso não faz sentido fora do Apps Script e infla desnecessariamente o conteúdo colado.
- Mantém atributos `onclick="..."` em elementos que não deveriam mais ser interativos no destino final (ex.: `alterarStatus`, `removerLinhaTabela`).
- Não remove os `data-lucide="..."` (os ícones ficam como `<i>` vazios sem o script do Lucide para renderizá-los).

**Correção sugerida**: no `obterHTMLTratado()`, além do que já é feito, remover `<script>`, `<style>` externo (ou substituir por CSS inline mínimo), todos os atributos `onclick`/`oninput`, e trocar os `<i data-lucide="...">` por emoji ou SVG estático — exportando apenas o `<body>`/conteúdo do `#documento-container`, não o `<html>` completo.

### 6. Auto-save a cada 15s (sem debounce) — confirmado
```js
setInterval(autoSalvarNoGoogle, 15000);
```
O auto-save roda **incondicionalmente** a cada 15 segundos, mesmo que nada tenha mudado desde o último save — gerando chamadas desnecessárias ao Apps Script (consumo de cota de execução) e risco de sobrescrever dados de outra aba/sessão aberta pelo mesmo usuário.

**Correção sugerida**: substituir o `setInterval` fixo por um **debounce reativo a mudanças reais** (`input`, `blur`, `DOMSubtree` via `MutationObserver` no `#documento-container`), disparando o save X segundos após a última edição, com um `dirty flag` para não salvar quando nada mudou. Manter um `setInterval` de segurança bem mais espaçado (ex.: a cada 2–5 min) como rede de proteção.

### 7. Novos pontos identificados nesta análise

| # | Problema | Impacto | Sugestão |
|---|----------|---------|----------|
| 7.1 | **Um único slot de rascunho por usuário** (`RASCUNHO_MAPEAMENTO_COMPLETO` é uma chave fixa). Um analista que trabalha em 2+ marcas no mesmo dia sobrescreve o rascunho anterior sem aviso. | Alto — perda silenciosa de trabalho. | Namespacing por projeto/marca (ex.: um ID de projeto na URL/`?projeto=`, chave `RASCUNHO_<id>`), ou lista de projetos salvos. |
| 7.2 | **Limite de 9 KB por propriedade** do `PropertiesService` vs. salvar o HTML inteiro como string. Projetos com várias exceções passam facilmente desse limite. | Alto — falha silenciosa (agravada pelo item 2). | Migrar de "salvar HTML" para um **modelo de dados JSON estruturado** (array de módulos/lojas/exceções) e renderizar o HTML a partir dele; ou salvar em `PropertiesService` fragmentado em várias chaves, ou usar Google Drive/Sheets como storage para documentos grandes. |
| 7.3 | **`innerHTML` bruto salvo/restaurado sem sanitização.** Qualquer HTML digitado/colado num campo `contenteditable` é serializado e, no carregamento, reinserido via `container.innerHTML = ...` sem `DOMPurify` ou equivalente. | Médio — risco de HTML/atributos indesejados persistirem e serem reexecutados (self-XSS), especialmente por ser um app colaborativo. | Sanitizar o HTML antes de salvar e ao carregar (`DOMPurify.sanitize`), restringindo tags/atributos permitidos. |
| 7.4 | **Import de projeto sobrescreve sem confirmação.** `importarArquivoProjeto()` substitui `innerHTML` do documento inteiro assim que o JSON é lido, sem perguntar se o usuário quer descartar o que está em tela. | Médio — perda de dados. | Adicionar `confirm()` antes de sobrescrever, comparando timestamp/mudanças pendentes. |
| 7.5 | **Sem indicador de carregamento inicial.** `carregarEstadoGoogle()` roda no `DOMContentLoaded`, mas não há spinner/skeleton — em cold start do Apps Script (pode levar alguns segundos) o usuário vê o modelo padrão "piscar" antes do rascunho real carregar. | Baixo/Médio — UX. | Mostrar um overlay de carregamento até a resposta do `google.script.run` chegar. |
| 7.6 | **Dependência de 3 CDNs externos** (Tailwind, Lucide, Google Fonts) carregados a cada acesso, sem fallback caso a rede/CDN falhe (comum em ambientes corporativos com proxy/allowlist restritiva). | Médio — pode quebrar a aplicação inteira em rede corporativa restrita. | Avaliar build local do Tailwind (CLI) e vendorizar os ícones usados, eliminando dependência de rede externa. |
| 7.7 | **Nenhum controle de versão** do projeto Apps Script (não há `.clasp.json`/histórico Git). | Médio — dificulta rollback e revisão de mudanças. | Adotar `clasp` + repositório Git (mesmo que privado) para o projeto Apps Script. |
| 7.8 | **Duplicação de lógica de criação de linha/card** entre `adicionarLinhaTabela` e `adicionarNovaExcecao` (HTML quase idêntico digitado 2x). | Baixo — manutenibilidade. | Extrair uma função única `criarLojaCompleta(codigo, nome, uf)` que cria linha + card juntos, usada pelos dois fluxos. |

## Exportação para Wiki Markup (Confluence) — nota técnica

A exportação para Wiki Markup (`gerarWikiMarkupNivel1()`/`copiarWikiMarkupNivel1()` e `gerarWikiMarkupNivel2()`/`copiarWikiMarkupNivel2()` em `Index.html`) não usa nenhuma biblioteca externa: lê os dados diretamente do DOM de cada nível e monta uma string em [sintaxe clássica de wiki markup do Confluence](https://confluence.atlassian.com/doc/confluence-wiki-markup-251003035.html). As duas exportações compartilham os mesmos helpers genéricos:

- `tabelaParaWikiMarkup(tabela, { colunasStatus, colunasIgnorar })`: converte uma `<table>` (thead/tbody) em tabela de wiki markup (`||cabeçalho||` / `|célula|`).
  - `colunasStatus` é um mapa `{ índiceDaColuna: resolverDeCor }` — cada coluna listada tem seu texto convertido em `{status:colour=...|title=...}`, usando o resolvedor de cor informado.
  - `colunasIgnorar` é uma lista de índices de colunas omitidas no texto final (ex.: a coluna "Ações" da Tabela Quick-View, que só tem botões/links sem sentido fora da interface).
- `resolverCorStatus(status)` / `resolverCorExcecao(status)`: mapeiam o texto do badge original para uma cor de `{status}`. Foram separados porque o mesmo texto "SIM" tem semânticas diferentes em cada tabela — no Ecossistema de Módulos, "SIM" é positivo (verde); na coluna "Tem Exceção?" da Tabela Quick-View, "SIM" é um alerta (amarelo), refletindo a cor original do badge na interface.
- `listaParaWikiMarkup(lista, marcador)`: converte um `<ol>`/`<ul>` em itens (`# item` ou `* item`).
- `listaRotuloValorParaWikiMarkup(container)`: converte uma lista de `<div>`s no formato rótulo/valor (não uma `<table>`) em uma tabela `||Item||Valor||`. Usada para "Dados Técnicos e Acessos Globais" no Nível 1.
- `escaparWikiMarkup(texto)`: faz *escape* de `{`, `}`, `[`, `]` em todo texto livre, para que o conteúdo digitado pelo analista não quebre a macro gerada.

**Nível 1 (`gerarWikiMarkupNivel1`)**: lê "Visão Geral do Projeto" (`#campo-nome-marca-projeto`), o banner de instruções, e as tabelas de Ecossistema de Módulos (`#tabela-ecossistema-modulos`), Hardware (`#tabela-hardware-padrao`), Regras de Negócio (`#tabela-regras-negocio`), a lista de Pontos Críticos (`#lista-pontos-criticos`) e os Dados Técnicos (`#lista-dados-tecnicos`).

**Nível 2 (`gerarWikiMarkupNivel2`)**: lê o banner de instruções do Nível 2, os 4 cards de resumo de rollout (`#card-total`, `#card-padrao`, `#card-excecoes`, `#card-implantacao`), a Tabela Quick-View (`#tabela-quickview`, ignorando a coluna "Ações" e colorindo "Status" e "Tem Exceção?" com resolvedores diferentes) e cada card do Registro Detalhado de Exceções (`#container-excecoes`), convertido por `cardExcecaoParaWikiMarkup()` em um título (`h3.`) + painel com metadados (razão, data, analista) + lista de divergências mapeadas. Se não houver nenhum card de exceção, a seção exibe o texto `_Nenhuma exceção registrada até o momento._` em vez de ficar vazia.

Em ambos os casos, o fluxo final é: sincronizar `<textarea>`s sem disparar o observador de auto-save → montar a string → copiar via `navigator.clipboard.writeText()` → exibir um toast informando o próximo passo (colar dentro da macro **Markup** do Confluence).

**Por que não é wiki markup "puro" digitado direto na página:** o Confluence Server 7.19 (versão confirmada em uso — ver `share.linx.com.br`) usa o **editor novo**, que não converte mais `{chave}` digitado como texto simples em uma macro (esse atalho só existia no editor clássico/legado). Por isso o texto gerado precisa ser colado dentro de uma macro específica que interpreta wiki markup (na prática, uma macro "Markup" habilitada no ambiente) — não existe, hoje, uma forma de automatizar 100% a colagem/formatação com um único clique.

## Roadmap sugerido

1. **Curto prazo (baixo esforço, alto impacto)**
   - Corrigir o bug do `confirm()` de cancelamento (#3).
   - Adicionar `.withFailureHandler` em todas as chamadas `google.script.run` (#2).
   - Trocar `setInterval` fixo por debounce + dirty flag (#6).
2. **Médio prazo**
   - Corrigir geração de IDs com contador incremental persistido (#4).
   - Melhorar `obterHTMLTratado()` para remover scripts/estilos externos antes de exportar (#5).
   - Namespacing de rascunhos por projeto (#7.1).
3. **Longo prazo (mudança estrutural)**
   - Migrar o modelo de estado de "HTML serializado" para um **JSON estruturado** (lojas, exceções, módulos como arrays de objetos), resolvendo de uma vez os itens #7.2 e parte do #7.3, e permitindo relatórios/validações futuras (ex.: exportar para planilha, dashboards).
