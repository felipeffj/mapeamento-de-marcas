# Mapeamento de Marcas — TOTVS Linx

Aplicação web servida via **Google Apps Script (Web App)** usada pelos analistas de implantação para documentar o *Mapeamento de Marca* de clientes Linx: o padrão de configuração da rede (Nível 1) e as exceções por loja durante o rollout (Nível 2). O documento final pode ser exportado como HTML "limpo" ou como texto em **Wiki Markup**, pronto para colar em uma página do Confluence (Share Jira/Linx Share).

## Sumário

- [Arquitetura](#arquitetura)
- [Estrutura de arquivos](#estrutura-de-arquivos)
- [Como publicar/rodar](#como-publicarrodar)
- [Funcionalidades](#funcionalidades)
- [Modelo de persistência e projetos compartilhados](#modelo-de-persistência-e-projetos-compartilhados)
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
│   Lucide Icons + JS      │ ◀─────────────────────────────── │  listarProjetosComMigracao │
│   inline, single file)   │        callback (json/erro)       │  criarProjeto/abrirProjeto  │
│  Home → Projetos →       │                                  │  salvarProjetoAtual()      │
│  Editor (Nível 1/2)      │                                  │  compartilharProjeto() ...  │
└─────────────────────────┘                                  └───────────────────────────┘
                                                                         │
                                                                         ▼
                                                     Planilha Google "Banco de Projetos"
                                                     (aba Projetos: metadados/ACL;
                                                      aba Dados: conteúdo gzip+base64)
```

- **`Code.gs`**: backend do Google Apps Script. Serve o HTML (`doGet`) e expõe as funções de **gestão de projetos** (`listarProjetos`, `criarProjeto`, `abrirProjeto`, `salvarProjetoAtual`, `compartilharProjeto`, `removerColaborador`, `excluirProjeto`, `resetarProjetoAtual`), com controle de acesso por papel (`dono`/`edicao`/`visualizacao`). O armazenamento é uma Planilha Google criada automaticamente na primeira execução (ver [Modelo de persistência](#modelo-de-persistência-e-projetos-compartilhados)). As funções legadas de rascunho único (`salvarEstadoCompleto`/`carregarEstadoCompleto`/`resetarParaModeloPadrao`) permanecem no arquivo apenas como parte da migração automática de rascunhos antigos.
- **`Index.html`**: front-end monolítico (HTML + CSS via Tailwind CDN + JS inline), agora com **três áreas de navegação**: `#area-home` (dashboard inicial), `#area-projetos` (lista de projetos próprios/compartilhados) e `#area-projeto-atual` (o editor de Nível 1/Nível 2, como antes). O estado do "documento" continua vivendo no DOM (`contenteditable`) dentro de `#documento-container`; o que muda é que esse HTML agora está sempre associado a um `projetoId` explícito, e não a "o rascunho do usuário logado".

## Estrutura de arquivos

```
mapeamento-de-marcas/
├── Code.gs        # Backend Apps Script (doGet + gestão de projetos compartilhados)
└── Index.html     # Front-end único: Home, Projetos, sidebar, Nível 1, Nível 2, scripts
```

## Como publicar/rodar

1. Criar um projeto no [Google Apps Script](https://script.google.com) (ou usar `clasp`).
2. Copiar `Code.gs` para o arquivo de script e `Index.html` como arquivo HTML.
3. Implantar como **Aplicativo da Web** (`Deploy > New deployment > Web app`):
   - Executar como: **usuário que acessa** — necessário para que `Session.getActiveUser().getEmail()` identifique corretamente cada analista (dono/colaborador de cada projeto). Se implantado como "eu" (o proprietário do script), todos os acessos seriam atribuídos ao mesmo e-mail e o compartilhamento por usuário deixaria de funcionar.
   - Quem tem acesso: conforme política do domínio/organização (funciona de forma confiável dentro do domínio Google Workspace, ex.: contas corporativas `@totvs.com.br`/`@linx.com.br`; para contas totalmente externas ao domínio, `getActiveUser()` pode retornar vazio).
4. Na primeira execução de qualquer usuário, o app cria automaticamente uma planilha chamada **"Mapeamento de Marcas - Banco de Projetos"** no Google Drive da conta que a criar primeiro — é ali que todos os projetos, colaboradores e conteúdos ficam armazenados. Não é necessário criar essa planilha manualmente. Como essa planilha nasce **privada** (pertence a quem a criou), o próprio script tenta compartilhá-la automaticamente com todo o domínio Workspace (permissão de edição) logo após criá-la — isso é o que permite que qualquer colega da organização consiga abrir/gravar projetos, mesmo sem ser o dono da planilha. Se o domínio não permitir esse compartilhamento automático (ex.: política restritiva de administrador), será necessário compartilhar essa planilha manualmente pelo Google Drive (com edição, para todo o domínio ou para os e-mails específicos dos analistas) — caso contrário, quem não tiver acesso à planilha verá um erro claro ao abrir a lista de projetos, em vez de a lista simplesmente aparecer vazia.
5. Acessar a URL gerada — a tela inicial é a **Home**, de onde o analista cria ou abre seus projetos (ver [Modelo de persistência](#modelo-de-persistência-e-projetos-compartilhados)).

> Recomenda-se usar [`clasp`](https://github.com/google/clasp) para versionar este projeto em Git e sincronizar com o Apps Script (`clasp push` / `clasp pull`), já que hoje o projeto não tem nenhum controle de versão nem pipeline de deploy.

## Funcionalidades

- **Home**: tela inicial ao abrir o app — atalhos para criar um novo projeto ou ver a lista de projetos recentes.
- **Meus Projetos**: lista todos os projetos onde o usuário logado é dono ou colaborador, com o papel de cada um (Dono / Pode editar / Somente leitura), data/autor da última atualização, e ações de Abrir, Compartilhar (só dono) e Excluir (só dono).
- **Compartilhamento por e-mail**: o dono de um projeto pode conceder acesso a outro analista informando o e-mail dele e escolhendo o papel — **Pode editar** (útil para a dupla projeto/implantação trabalhar no mesmo documento) ou **Somente leitura** (acompanhamento sem risco de alteração acidental). Colaboradores em modo somente leitura têm os campos bloqueados (`contenteditable` desligado) e as ações de exportação/import ocultas.
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
  - **Copiar Wiki Markup (Nível 1)** e **Copiar Wiki Markup (Nível 2)** — botões ativos na sidebar (ocultos para colaboradores em modo somente leitura). Geram, a partir dos dados atuais de cada nível, um texto em [sintaxe clássica de wiki markup do Confluence](https://confluence.atlassian.com/doc/confluence-wiki-markup-251003035.html) (`{panel}`, `{status}`, `{warning}`, `{note}`, `{expand}`, tabelas `||...||`) e copiam para a área de transferência. Devem ser colados dentro da macro **Markup** do Confluence (inserida manualmente pelo usuário via `+`/Inserir → Markup), pois o editor novo do Confluence Server/Data Center não converte esse texto automaticamente se colado direto no corpo da página.
    - O Nível 1 inclui a tabela estruturada da Visão Geral do Projeto (Informações da Marca, Responsáveis TOTVS e Escopo), o painel de Descrição da Operação, Ecossistema de Módulos, Pontos Críticos, Jornada de Venda e Fluxo (diagrama monoespaçado em `{code}` + tabela de parâmetros operacionais), Dados Técnicos, Hardware e Regras de Negócio.
    - O Nível 2 inclui o resumo de rollout (total/padrão/exceções/implantação), a tabela quick-view de lojas (com badges coloridos por status) e o registro detalhado de cada exceção (painel com metadados + lista de divergências mapeadas). Se não houver nenhuma exceção registrada, o texto gerado indica isso explicitamente em vez de gerar uma seção vazia.
  - **Copiar HTML Limpo** / **Baixar .html** — ocultos por padrão na interface atual (ver decisão de UX abaixo), mas as funções (`copiarHTMLJira()`, `baixarHTML()`) continuam implementadas para uma eventual reativação futura. Exportam apenas o conteúdo de `#documento-container` (não a página inteira), envolvido num HTML mínimo e autocontido — sem CDNs externos, sem `<script>`, sem `contenteditable`/`onclick`/`oninput`/`onchange` e sem os atributos `data-lucide` (que ficariam como ícones "mortos" sem o script do Lucide).
    - *Motivo de estarem ocultos*: ao colar o HTML "limpo" em uma página do Confluence, praticamente todo o estilo visual (Tailwind) se perde — o resultado é funcional, mas visualmente pobre. A alternativa de Wiki Markup, embora exija montagem manual de macros, aproveita melhor os recursos nativos do Confluence.
- **Exportar/Importar backup do projeto (.json)**: baixa/carrega um snapshot local do `innerHTML` do documento **do projeto atualmente aberto**. A importação pede confirmação antes de sobrescrever o conteúdo atual, e o HTML lido do arquivo passa por `sanitizarHTMLDocumento()` antes de ser reinserido (ver nota de segurança abaixo). Oculto para colaboradores em modo somente leitura.
- **Auto-save na nuvem com debounce**: alterações no documento (detectadas via `MutationObserver`) disparam `google.script.run.salvarProjetoAtual(id, json)` após 3s de inatividade, com uma verificação de segurança adicional a cada 2 minutos. Falhas de salvamento/carregamento exibem um indicador visual de erro (`exibirErroSalvamento()`), e o carregamento inicial mostra um overlay de carregamento. O cabeçalho do projeto mostra sempre quem salvou por último e quando (`"Atualizado em ... por ..."`), para que a dupla se organize manualmente sobre quem está editando (ver [concorrência](#modelo-de-persistência-e-projetos-compartilhados) abaixo). O HTML restaurado (do banco de projetos ou de um `.json` importado) passa por `sanitizarHTMLDocumento()` antes de ser inserido de volta no DOM.
- **Reset para modelo padrão**: apaga o conteúdo salvo do projeto **atualmente aberto** (mantendo dono/colaboradores) e recarrega a página. Oculto para colaboradores em modo somente leitura.

> **Nota de segurança:** `sanitizarHTMLDocumento(html)` remove `<script>`/`<style>`/`<iframe>`/`<object>`/`<embed>` e qualquer atributo de evento (`on*`) que não seja uma chamada a uma das funções internas conhecidas do app (`alterarStatus`, `alterarStatusOperacional`, `alterarStatusExcecao`, `adicionarLinhaTabela`, `adicionarNovaExcecao`, `removerLinhaTabela`, `removerExcecao`, `recalcularContadores`), além de hrefs/srcs com esquema `javascript:`. Isso reduz o risco de um HTML colado num campo `contenteditable` (ou um `.json` de projeto compartilhado) reintroduzir um handler malicioso ao ser recarregado, sem quebrar os `onclick` legítimos dos badges/botões gerados dinamicamente.

## Modelo de persistência e projetos compartilhados

O "banco de dados" é uma **Planilha Google** ("Mapeamento de Marcas - Banco de Projetos"), criada automaticamente na primeira execução e referenciada por `PropertiesService.getScriptProperties()` (visível a todos os usuários do script, ao contrário das antigas *User Properties*, que eram isoladas por conta). Ela tem duas abas:

- **`Projetos`** (metadados/ACL): 1 linha por projeto — `ID`, `Nome`, `DonoEmail`, `ColaboradoresJSON` (lista de `{ email, papel }`, onde `papel` é `"edicao"` ou `"visualizacao"`), `CriadoEm`, `AtualizadoEm`, `AtualizadoPorEmail`.
- **`Dados`**: 1 linha por projeto — `ProjetoID`, `ConteudoBase64` (o JSON `{ conteudoHTML, timestamp }` do documento, **comprimido com gzip e codificado em base64**, reaproveitando `comprimirEcodificar_()`/`descomprimir_()` já existentes).

**Identidade do usuário**: `obterUsuarioAtual()` usa `Session.getActiveUser().getEmail()` (com *fallback* para `Session.getEffectiveUser()`), o que funciona de forma confiável quando o app é implantado dentro do domínio Google Workspace da organização.

**Papéis de acesso** (checados em toda leitura/escrita no backend, não só escondidos na UI):
- **Dono**: quem criou o projeto — pode editar, compartilhar, remover colaboradores e excluir.
- **Pode editar**: colaborador convidado com permissão de edição — pode ler e salvar, mas não compartilhar/excluir.
- **Somente leitura**: colaborador convidado apenas para acompanhar — o front-end bloqueia `contenteditable`, `textarea`s e oculta as exportações; o backend também rejeita `salvarProjetoAtual()` para esse papel, mesmo que a chamada seja forçada manualmente.

**Concorrência**: dois analistas com acesso de edição podem abrir o mesmo projeto ao mesmo tempo. Não há bloqueio otimista nem travamento — a estratégia adotada é **"o último a salvar sobrescreve"**, com o cabeçalho do projeto sempre exibindo quem salvou por último e quando, para a dupla se organizar manualmente sobre quem edita cada parte no momento (mesmo modelo de risco que planilhas/documentos compartilhados sem controle de versão).

**Migração automática de rascunhos antigos**: usuários que já tinham um rascunho no modelo anterior (`PropertiesService.getUserProperties()`, um único rascunho por conta) não perdem nada — na primeira vez que a lista de projetos é carregada, `migrarRascunhoLegadoSeNecessario_()` detecta o rascunho legado e cria automaticamente um projeto ("Meu Projeto (migrado)") com esse conteúdo, sem exigir nenhuma ação manual.

Ver [nota técnica sobre compressão/chunking](#persistência-com-compressão-gzip-e-chunking--nota-técnica) para detalhes de como o conteúdo de cada projeto é comprimido antes de ser salvo na aba `Dados`.

## Limitações conhecidas

- **Sem histórico/versionamento**: o auto-save (por debounce, ~3s após a última edição) sobrescreve o estado anterior a cada save — não há como ver "quem mudou o quê" além do rótulo "Atualizado em ... por ...".
- **Concorrência simples ("último a salvar vence")**: não há bloqueio de edição nem merge de alterações concorrentes. Para o padrão de uso real (dupla projeto/implantação, raramente editando o mesmo campo no mesmo segundo), isso foi avaliado como aceitável — ver decisão registrada na análise técnica.
- **Dependência de `Session.getActiveUser()`**: em implantações fora do domínio Google Workspace da organização (usuários totalmente externos/anônimos), esse identificador pode vir vazio, impedindo a criação/abertura de projetos.
- **Compartilhamento automático da planilha de projetos depende de permissão de domínio**: o script tenta compartilhar a planilha-base com todo o domínio assim que a cria (ver [Como publicar/rodar](#como-publicarrodar)); se a política do Workspace bloquear esse compartilhamento automático, um administrador precisa liberar acesso manualmente pelo Drive — sem isso, colaboradores sem acesso à planilha recebem um erro claro ao tentar listar/abrir projetos (em vez de simplesmente não a verem).
- **Planilha única como "banco de dados"**: cada linha da aba `Dados` guarda o conteúdo comprimido de um projeto inteiro em uma única célula. O limite de 50.000 caracteres por célula do Google Sheets é, na prática, muito folgado para o tamanho típico do documento (mesmo grande, gzip reduz ~80%), mas projetos com centenas de lojas/exceções poderiam, em teoria, se aproximar desse limite — não há fatiamento entre células/linhas implementado para esse caso hoje.


---

## Análise técnica e pontos de melhoria

Revisão do estado atual do código (`Index.html` + `Code.gs`), em 2026-09-18, confirmando o que já foi corrigido em sessões anteriores e o que ainda é uma pendência real.

### ✅ Itens já corrigidos e confirmados no código atual

| # | Item | Onde foi corrigido |
|---|------|---------------------|
| 1 | **Dados sensíveis no HTML.** O arquivo só contém placeholders (`[Nome da Marca]`, `admin@franquiamarca.com.br`, `@Analista`) e exemplos genéricos de hardware. Nenhum CNPJ, cliente real ou e-mail real. | Template já sanitizado. |
| 2 | **Falta de tratamento de erro no `google.script.run`.** As chamadas de persistência (`autoSalvarNoGoogle`, `abrirProjetoNaTela`, `limparRascunhoGoogle`, `carregarListaProjetos`, etc.) têm `.withFailureHandler(...)`, exibindo um indicador visual de erro (`exibirErroSalvamento()`) em vez de falhar silenciosamente. | `autoSalvarNoGoogle`, `abrirProjetoNaTela`, `limparRascunhoGoogle` |
| 3 | **Bug do cancelamento em `alterarStatusExcecao`.** O `confirm()` agora é chamado **antes** de qualquer alteração de `textContent`/`className`; se o usuário cancelar, o badge e o card de exceção permanecem exatamente como estavam (sem dessincronia). | `alterarStatusExcecao` |
| 4 | **Geração de IDs por contagem de elementos.** Substituído por `obterProximoCodigoLoja()`, que calcula o próximo código a partir do **maior número já usado** na tabela (não da contagem de filhos) e garante, com um laço de verificação, que o `id` gerado ainda não existe no DOM — elimina colisão de IDs ao remover/adicionar lojas fora de ordem. | `obterProximoCodigoLoja` |
| 6 | **Auto-save incondicional a cada 15s.** Substituído por auto-save reativo por **debounce** (`marcarComoAlterado()` + `MutationObserver` no `#documento-container`, salva ~3s após a última edição real) com uma rede de segurança bem mais espaçada (a cada 2 min, só se houver algo pendente). | `marcarComoAlterado`, `autoSalvarNoGoogle`, `AUTO_SAVE_DEBOUNCE_MS`/`AUTO_SAVE_SEGURANCA_MS` |
| 7.4 | **Import de projeto sobrescrevia sem confirmação.** `importarArquivoProjeto()` agora exibe um `confirm()` antes de sobrescrever o documento em tela. | `importarArquivoProjeto` |
| 7.5 | **Sem indicador de carregamento inicial.** A abertura de um projeto (`abrirProjetoNaTela()`) exibe um overlay (`exibirCarregando()`/`ocultarCarregando()`) até a resposta do `google.script.run` chegar. | `abrirProjetoNaTela` |
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

> **Nota (2026-09-22):** a descrição abaixo documenta a solução original, quando a persistência ainda era um único rascunho por usuário em `PropertiesService`. Com a migração para **projetos compartilhados** (item 7.1, ver [Modelo de persistência](#modelo-de-persistência-e-projetos-compartilhados)), o armazenamento passou a ser uma **célula de Planilha Google** (até 50.000 caracteres, sem necessidade de fatiamento). A etapa de **compressão gzip** (passo 1 abaixo) continua sendo usada da mesma forma; os passos 2–4 (fatiamento em chunks e chave `RASCUNHO_*`) só permanecem ativos para ler/migrar rascunhos antigos, nunca mais são escritos para um usuário que já tenha ao menos um projeto.

A solução implementada em `Code.gs` **não exige nenhuma dependência externa nem migração para um novo modelo de dados** — usa apenas recursos nativos do Apps Script:
1. O JSON salvo é comprimido com **`Utilities.gzip()`** (gzip nativo do Apps Script) e codificado em base64 antes de ser persistido. Testado com o HTML real do projeto: **~80% de redução** (41 KB → ~8 KB), graças à repetição de classes Tailwind.
2. *(Modelo legado)* O resultado comprimido era **fatiado em múltiplos "chunks"** (`RASCUNHO_CHUNK_0`, `RASCUNHO_CHUNK_1`, ...) de até 8000 caracteres cada, cobrindo também projetos grandes o bastante para ultrapassar os 9 KB mesmo após a compressão (várias lojas/exceções). Uma chave de metadado (`RASCUNHO_META`) registra quantos chunks foram usados na última gravação.
3. *(Modelo legado)* Ao salvar um documento **menor** que o anterior, os chunks "órfãos" da gravação antiga eram removidos (evita lixo acumulado).
4. **Compatibilidade com rascunhos antigos**: se não existir `RASCUNHO_META` (usuário que já tinha um rascunho salvo no formato antigo, sem compressão), a migração automática cai de volta para a chave legada `RASCUNHO_MAPEAMENTO_COMPLETO`, sem quebrar o carregamento. Essa chave legada nunca mais é escrita — o próximo save do usuário já migra para o novo formato de projeto na Planilha Google.
5. **Validado com uma simulação funcional** (mock de `PropertiesService`/`Utilities` com `zlib` do Node, replicando a mesma lógica): roundtrip de salvar/carregar com documento pequeno e grande (multi-chunk), limpeza de chunks órfãos ao salvar um documento menor, fallback para o formato legado e reset — todos os cenários passaram. Não foi possível testar chamando o `Utilities.gzip()` real do Apps Script (só roda no ambiente do Google), mas a lógica é a mesma.

Ver [nota técnica completa](#persistência-com-compressão-gzip-e-chunking--nota-técnica) para mais detalhes de implementação.

### ✅ Implementado nesta revisão (2026-09-22) — Projetos multiusuário compartilhados

**7.1. Um único slot de rascunho por usuário — revisitado e agora implementado.** A decisão anterior (não implementar, por não ser um problema prático) foi revista a pedido do time: o padrão real de trabalho é em **dupla** (analista de projeto + analista de implantação), e o Exportar/Importar `.json` manual não resolvia a colaboração simultânea no mesmo documento. Foi implementado um modelo completo de **projetos com dono e colaboradores**:
- Telas **Home** e **Meus Projetos**, com criação, abertura, compartilhamento e exclusão de projetos.
- Backend migrado de `PropertiesService.getUserProperties()` (isolado por conta) para uma **Planilha Google compartilhada** entre todos os usuários do script, com controle de acesso por papel (`dono`/`edicao`/`visualizacao`) validado tanto no front-end (oculta/bloqueia UI) quanto no backend (rejeita chamadas sem permissão).
- **Migração automática**: rascunhos únicos já existentes no modelo antigo viram um projeto automaticamente na primeira visita à lista de projetos, sem exigir nenhuma ação manual do analista.
- Ver [Modelo de persistência e projetos compartilhados](#modelo-de-persistência-e-projetos-compartilhados) para os detalhes completos da nova arquitetura.

### 🟡 Pendências reais que ainda restam (mudanças de arquitetura maiores)

| # | Problema | Impacto | Sugestão |
|---|----------|---------|----------|
| 7.6 | **Dependência de 3 CDNs externos** (Tailwind, Lucide, Google Fonts) carregados a cada acesso, sem fallback caso a rede/CDN falhe (comum em ambientes corporativos com proxy/allowlist restritiva). | Médio — pode quebrar a aplicação inteira em rede corporativa restrita. | Avaliar build local do Tailwind (CLI) e vendorizar os ícones usados, eliminando dependência de rede externa. |
| 7.7 | **Nenhum controle de versão** do projeto Apps Script (não há `.clasp.json`/histórico Git). | Médio — dificulta rollback e revisão de mudanças. | Adotar `clasp` + repositório Git (mesmo que privado) para o projeto Apps Script. |
| 7.9 | **Concorrência simples ("último a salvar vence")** entre dois colaboradores editando o mesmo projeto ao mesmo tempo. Aceito como suficiente para o padrão de uso atual (ver decisão registrada no [Modelo de persistência](#modelo-de-persistência-e-projetos-compartilhados)), mas não há bloqueio nem merge de alterações concorrentes. | Baixo, dado o padrão de uso em dupla — risco cresceria se o número de colaboradores simultâneos por projeto aumentasse. | Se necessário no futuro: bloqueio otimista simples (registrar "em edição por X" com expiração) antes de partir para algo mais complexo como merge de campos. |

Os itens 7.6, 7.7 e 7.9 exigem decisões de arquitetura/processo (build de assets, workflow de deploy, modelo de concorrência) e ainda não foram implementados — ver seção [Roadmap sugerido](#roadmap-sugerido) para a proposta de próximos passos.

## Persistência com compressão gzip e chunking — nota técnica

Implementado inteiramente em `Code.gs`, sem nenhuma dependência externa (usa apenas `Utilities`, nativo do Apps Script). Resolve o item 7.2 da análise técnica, e o mesmo mecanismo de compressão passou a ser reaproveitado por projeto (célula da aba `Dados`) desde a implementação de projetos compartilhados (item 7.1).

**Por que era necessário:** o estado salvo é o `innerHTML` completo do documento (Nível 1 + Nível 2, com todas as classes Tailwind). Mesmo um projeto simples (só o Nível 1 preenchido, sem nenhuma loja de exceção) já gera um HTML de ~40 KB — muito acima do limite de **9 KB por valor** do antigo `PropertiesService` (limite que motivou a compressão originalmente; a migração para Planilha Google elevou bastante essa margem, já que uma célula suporta até 50.000 caracteres, mas a compressão continua valendo a pena para reduzir o tamanho salvo e o tráfego entre front-end e backend).

**Como funciona (`comprimirEcodificar_` / `descomprimir_`, usadas por `salvarProjetoAtual` / `abrirProjeto`):**

1. **Compressão**: o JSON recebido (`{ conteudoHTML, timestamp }`) é comprimido com `Utilities.gzip()` e o resultado binário é codificado em base64 com `Utilities.base64Encode()` — texto HTML com muitas classes Tailwind repetidas comprime muito bem (~80% de redução medida com o template real do projeto: 41 KB → ~8 KB).
2. **Armazenamento**: a string base64 comprimida é salva em uma única célula (`ConteudoBase64`) na linha do projeto correspondente na aba `Dados` — sem necessidade de fatiamento em múltiplas propriedades, já que uma célula de planilha comporta até 50.000 caracteres (bem acima do que a compressão gera na prática).
3. **Compatibilidade com rascunhos antigos**: o formato antigo, fatiado em `RASCUNHO_CHUNK_N` (chunks de 8000 caracteres) dentro de `PropertiesService.getUserProperties()`, continua existindo apenas como origem da migração automática (`migrarRascunhoLegadoSeNecessario_()`) — nunca mais é escrito para um usuário que já tenha pelo menos um projeto no novo modelo.

**Validação**: como `Utilities.gzip`/`Utilities.base64Encode` só existem no runtime do Apps Script (não é possível rodá-los localmente), a lógica foi validada por uma simulação funcional em Node.js, substituindo `PropertiesService`/`Utilities` por mocks equivalentes (usando o módulo `zlib` para gzip real) e executando o código de `Code.gs` num sandbox de `vm`. Cenários testados com sucesso: roundtrip de salvar/carregar com documento pequeno e grande, fallback para o formato legado, e migração automática para o modelo de projetos.

## Exportação para Wiki Markup (Confluence) — nota técnica

A exportação para Wiki Markup (`gerarWikiMarkupNivel1()`/`copiarWikiMarkupNivel1()` e `gerarWikiMarkupNivel2()`/`copiarWikiMarkupNivel2()` em `Index.html`) não usa nenhuma biblioteca externa: lê os dados diretamente do DOM de cada nível e monta uma string em [sintaxe clássica de wiki markup do Confluence](https://confluence.atlassian.com/doc/confluence-wiki-markup-251003035.html). As duas exportações compartilham os mesmos helpers genéricos:

- `tabelaParaWikiMarkup(tabela, { colunasStatus, colunasIgnorar })`: converte uma `<table>` (thead/tbody) em tabela de wiki markup (`||cabeçalho||` / `|célula|`).
  - `colunasStatus` é um mapa `{ índiceDaColuna: resolverDeCor }` — cada coluna listada tem seu texto convertido em `{status:colour=...|title=...}`, usando o resolvedor de cor informado.
  - `colunasIgnorar` é uma lista de índices de colunas omitidas no texto final (ex.: a coluna "Ações" da Tabela Quick-View, que só tem botões/links sem sentido fora da interface).
- `resolverCorStatus(status)` / `resolverCorExcecao(status)`: mapeiam o texto do badge original para uma cor de `{status}`. Foram separados porque o mesmo texto "SIM" tem semânticas diferentes em cada tabela — no Ecossistema de Módulos, "SIM" é positivo (verde); na coluna "Tem Exceção?" da Tabela Quick-View, "SIM" é um alerta (amarelo), refletindo a cor original do badge na interface.
- `listaParaWikiMarkup(lista, marcador)`: converte um `<ol>`/`<ul>` em itens (`# item` ou `* item`).
- `listaRotuloValorParaWikiMarkup(container)`: converte uma lista de `<div>`s no formato rótulo/valor (não uma `<table>`) em uma tabela `||Item||Valor||`. Usada para "Dados Técnicos e Acessos Globais" no Nível 1.
- `jornadaVendaParaWikiMarkup()`: extrai a seção "Jornada de Venda e Fluxo" convertendo o fluxo em ASCII para um bloco monoespaçado `{code:title=Diagrama do Fluxo de Venda}` (sem escapar colchetes ou setas para manter o desenho intacto) e os parâmetros de horário/usuários/turnos para uma tabela `||Parâmetro Operacional||Configuração Padrão||`.
- `escaparWikiMarkup(texto)`: faz *escape* de `{`, `}`, `[`, `]` em todo texto livre, para que o conteúdo digitado pelo analista não quebre a macro gerada.
- `obterNomeMarca()`: extrai o nome da marca com resiliência estrutural. Tenta pelo ID oficial (`campo-nome-marca-projeto`); se ausente (ex.: edição do `contenteditable` que removeu a tag `<span>` ou rascunho legado), localiza o card correspondente pelo rótulo semântico na seção de Visão Geral. Preserva textos válidos preenchidos pelo usuário com colchetes (ex.: `[Franquia VIP]`), descartando apenas o placeholder padrão literal (`[Nome da Marca]`).
- `obterElementoSecao(idPreferencial, termoTitulo, seletorInterno, containerRaiz)`: busca elementos estruturais pelo ID direto com fallback semântico pelo título da `<section>`, evitando que tabelas ou listas fiquem vazias caso IDs sejam perdidos ou alterados.
- `assegurarIdsEstruturais()`: verifica e reinjeta os IDs necessários nas tags correspondentes do DOM, recuperando rascunhos antigos salvos sem IDs.
- `restaurarConteudoDocumento(htmlRestaurado)`: restauração segura do HTML por aba (`#content-nivel1` e `#content-nivel2`). Se um rascunho salvo contiver apenas uma das abas (ex.: rascunho legado que só possuía o Nível 2), a outra aba de fábrica é **preservada** e não sobrescrita, eliminando o risco de perda do Nível 1.

**Nível 1 (`gerarWikiMarkupNivel1`)**: lê "Visão Geral do Projeto" (via `obterNomeMarca()`), o banner de instruções, e as seções de Ecossistema de Módulos, Pontos Críticos, Jornada de Venda e Fluxo (`jornadaVendaParaWikiMarkup`), Dados Técnicos, Hardware e Regras de Negócio (com fallbacks semânticos via `obterElementoSecao`).

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
   - Compressão gzip na persistência, resolvendo o limite de 9 KB por valor (#7.2).
   - **Projetos multiusuário compartilhados** (#7.1): Home + Meus Projetos, dono/colaboradores por e-mail com papéis Pode editar/Somente leitura, backend migrado para Planilha Google, migração automática de rascunhos antigos.
2. **Aceito como suficiente para o padrão de uso atual**
   - Concorrência "último a salvar vence" entre colaboradores do mesmo projeto (#7.9) — ver [Modelo de persistência](#modelo-de-persistência-e-projetos-compartilhados) para o raciocínio.
3. **Em aberto — próximos passos sugeridos**
   - **Vendorizar as 3 dependências de CDN** (#7.6): substituir `cdn.tailwindcss.com` por um CSS compilado localmente (Tailwind CLI, gerado uma vez e embutido no `<style>`), inlinar como SVG estático os ícones Lucide efetivamente usados (eliminando o `<script src="unpkg.com/lucide">`), e trocar o `@import` de fonte do Google Fonts por uma pilha de fontes de sistema (ou hospedar o arquivo de fonte junto ao projeto). Reduz a dependência de rede em ambientes corporativos restritivos.
   - **Adotar `clasp` + Git** (#7.7): inicializar um repositório Git para este projeto e configurar `clasp` (`clasp clone`/`clasp push`/`clasp pull`) para sincronizar com o Apps Script, permitindo histórico de commits, revisão de mudanças e rollback — hoje o único "histórico" é a memória de quem editou o script diretamente no editor do Apps Script.
   - **Migração para modelo de dados estruturado** (JSON com arrays de módulos/lojas/exceções, renderizando o HTML a partir dele): continua sendo uma melhoria de longo prazo que habilitaria relatórios, validações de dados e exportações adicionais (ex.: planilha, dashboard) — considerar apenas se o app crescer em complexidade a ponto de justificar o esforço de reescrita.
   - **Bloqueio otimista de edição por projeto**: se o uso em dupla evoluir para mais colaboradores simultâneos, avaliar um indicador de "em edição por X" com expiração automática, antes de partir para algo mais complexo como merge de campos.

