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
  - **Copiar HTML Limpo** / **Baixar .html** — ocultos por padrão na interface atual (ver decisão de UX abaixo), mas as funções (`copiarHTMLJira()`, `baixarHTML()`) continuam implementadas para uma eventual reativação futura. Exportam apenas o conteúdo de `#documento-container` (não a página inteira), envolvido num HTML mínimo e autocontido — sem CDNs externos, sem `<script>`, sem `contenteditable`/`onclick`/`oninput`/`onchange` e sem os atributos `data-lucide` (que ficariam como ícones "mortos" sem o script do Lucide).
    - *Motivo de estarem ocultos*: ao colar o HTML "limpo" em uma página do Confluence, praticamente todo o estilo visual (Tailwind) se perde — o resultado é funcional, mas visualmente pobre. A alternativa de Wiki Markup, embora exija montagem manual de macros, aproveita melhor os recursos nativos do Confluence.
- **Exportar/Importar projeto (.json)**: baixa/carrega um snapshot local do `innerHTML` do documento. A importação pede confirmação antes de sobrescrever o conteúdo atual, e o HTML lido do arquivo passa por `sanitizarHTMLDocumento()` antes de ser reinserido (ver nota de segurança abaixo).
- **Auto-save na nuvem com debounce**: alterações no documento (detectadas via `MutationObserver`) disparam `google.script.run.salvarEstadoCompleto()` após 3s de inatividade, com uma verificação de segurança adicional a cada 2 minutos. Falhas de salvamento/carregamento exibem um indicador visual de erro (`exibirErroSalvamento()`), e o carregamento inicial mostra um overlay de carregamento. O HTML recebido do Apps Script também passa por `sanitizarHTMLDocumento()` antes de ser reinserido no documento.
- **Reset para modelo padrão**: apaga o rascunho salvo e recarrega a página (volta ao HTML original do arquivo).

> **Nota de segurança:** `sanitizarHTMLDocumento(html)` remove `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` e qualquer atributo de evento (`on*`) que não seja uma chamada a uma das funções internas conhecidas do app (`alterarStatus`, `alterarStatusOperacional`, `alterarStatusExcecao`, `adicionarLinhaTabela`, `adicionarNovaExcecao`, `removerLinhaTabela`, `removerExcecao`, `recalcularContadores`), além de hrefs/srcs com esquema `javascript:`. Isso reduz o risco de um HTML colado num campo `contenteditable` (ou um `.json` de projeto compartilhado) reintroduzir um handler malicioso ao ser recarregado, sem quebrar os `onclick` legítimos dos badges/botões gerados dinamicamente.

## Modelo de persistência

O "banco de dados" é uma única chave (`RASCUNHO_MAPEAMENTO_COMPLETO`) nas *User Properties* do Apps Script, por usuário autenticado. O valor salvo é um JSON `{ conteudoHTML, timestamp }`, onde `conteudoHTML` é o `innerHTML` completo do container do documento.

## Limitações conhecidas

- `PropertiesService` tem limite de **9 KB por valor** e **500 KB de armazenamento total por usuário/script**. Como o valor salvo é o HTML inteiro (com todas as classes Tailwind, ícones etc.), projetos com muitas lojas/exceções podem estourar esse limite — hoje o `.withFailureHandler` ao menos avisa o usuário visualmente (ver item 7.2 da análise, ainda pendente na raiz do problema).
- Existe **apenas 1 slot de rascunho por usuário** — um analista que mapeia mais de uma marca no mesmo dia sobrescreve o rascunho anterior sem aviso (ver item 7.1 da análise).
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

### 🟡 Pendências reais que ainda restam (mudanças de arquitetura, fora do escopo de um fix pontual)

| # | Problema | Impacto | Sugestão |
|---|----------|---------|----------|
| 7.1 | **Um único slot de rascunho por usuário** (`RASCUNHO_MAPEAMENTO_COMPLETO` é uma chave fixa em `Code.gs`). Um analista que trabalha em 2+ marcas no mesmo dia sobrescreve o rascunho anterior sem aviso. | Alto — perda silenciosa de trabalho. | Namespacing por projeto/marca (ex.: um ID de projeto na URL/`?projeto=`, chave `RASCUNHO_<id>`), ou lista de projetos salvos. |
| 7.2 | **Limite de 9 KB por propriedade** do `PropertiesService` vs. salvar o HTML inteiro como string. Projetos com várias exceções passam facilmente desse limite. | Alto — falha silenciosa (o `.withFailureHandler` agora ao menos avisa o usuário, mas o limite em si continua existindo). | Migrar de "salvar HTML" para um **modelo de dados JSON estruturado** (array de módulos/lojas/exceções) e renderizar o HTML a partir dele; ou fragmentar em várias chaves no `PropertiesService`, ou usar Drive/Sheets como storage para documentos grandes. |
| 7.6 | **Dependência de 3 CDNs externos** (Tailwind, Lucide, Google Fonts) carregados a cada acesso, sem fallback caso a rede/CDN falhe (comum em ambientes corporativos com proxy/allowlist restritiva). | Médio — pode quebrar a aplicação inteira em rede corporativa restrita. | Avaliar build local do Tailwind (CLI) e vendorizar os ícones usados, eliminando dependência de rede externa. |
| 7.7 | **Nenhum controle de versão** do projeto Apps Script (não há `.clasp.json`/histórico Git). | Médio — dificulta rollback e revisão de mudanças. | Adotar `clasp` + repositório Git (mesmo que privado) para o projeto Apps Script. |

Os itens 7.1, 7.2, 7.6 e 7.7 exigem decisões de arquitetura (modelo de dados, storage, processo de deploy) e não foram implementados automaticamente nesta revisão — recomenda-se discuti-los antes de qualquer mudança, dado o impacto em como o app persiste e é publicado.

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
