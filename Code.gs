function doGet() {
  var html = HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Mapeamento de Marcas - V2')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  
  html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
  return html;
}

// --- Persistência do rascunho ---------------------------------------------
// O PropertiesService limita cada valor a 9 KB. Como o estado salvo é o HTML
// inteiro do documento (facilmente 40+ KB só com o Nível 1 preenchido), o
// valor bruto já ultrapassa esse limite na prática. Por isso o JSON recebido
// é comprimido com gzip nativo do Apps Script (Utilities.gzip — sem
// dependência de biblioteca externa) e codificado em base64 antes de ser
// salvo; HTML com muitas classes Tailwind repetidas comprime muito bem
// (~80% de redução em testes com o template real). O resultado comprimido
// ainda é fatiado em pedaços (chunks) de propriedades separadas, para
// suportar projetos grandes o suficiente para ultrapassar mesmo o limite de
// 9 KB já comprimido (várias lojas/exceções).
var PROP_META = 'RASCUNHO_META';
var PROP_CHUNK_PREFIX = 'RASCUNHO_CHUNK_';
var PROP_LEGADO = 'RASCUNHO_MAPEAMENTO_COMPLETO'; // formato antigo (string única, sem compressão)
var TAMANHO_CHUNK = 8000; // caracteres por propriedade, com folga sob o limite de 9 KB

// Salva o estado completo do projeto no Google Apps Script
function salvarEstadoCompleto(dadosJson) {
  var userProperties = PropertiesService.getUserProperties();

  var comprimidoBase64 = comprimirEcodificar_(dadosJson);
  var chunks = fatiarEmChunks_(comprimidoBase64, TAMANHO_CHUNK);

  limparChunks_(userProperties);

  for (var i = 0; i < chunks.length; i++) {
    userProperties.setProperty(PROP_CHUNK_PREFIX + i, chunks[i]);
  }
  userProperties.setProperty(PROP_META, JSON.stringify({ chunks: chunks.length }));

  // Remove o formato legado (string única sem compressão), caso exista: o
  // estado atual já foi totalmente migrado para o novo formato.
  userProperties.deleteProperty(PROP_LEGADO);

  return "Projeto salvo automaticamente às " + new Date().toLocaleTimeString();
}

// Carrega o último estado salvo. Suporta tanto o formato novo
// (comprimido/fatiado) quanto o formato legado (string única sem
// compressão), para não quebrar rascunhos já salvos antes desta mudança.
function carregarEstadoCompleto() {
  var userProperties = PropertiesService.getUserProperties();
  var metaTexto = userProperties.getProperty(PROP_META);

  if (metaTexto) {
    var meta = JSON.parse(metaTexto);
    var partes = [];
    for (var i = 0; i < meta.chunks; i++) {
      partes.push(userProperties.getProperty(PROP_CHUNK_PREFIX + i) || '');
    }
    return descomprimir_(partes.join(''));
  }

  // Fallback: rascunho salvo antes da migração para o formato comprimido.
  return userProperties.getProperty(PROP_LEGADO) || null;
}

// Limpa o rascunho (novo formato e legado) se o usuário quiser resetar para
// o modelo original.
function resetarParaModeloPadrao() {
  var userProperties = PropertiesService.getUserProperties();
  limparChunks_(userProperties);
  userProperties.deleteProperty(PROP_META);
  userProperties.deleteProperty(PROP_LEGADO);
  return true;
}

// --- Helpers internos de compressão/fatiamento -----------------------------

function comprimirEcodificar_(texto) {
  var blob = Utilities.newBlob(texto, 'application/json');
  var gzipBlob = Utilities.gzip(blob);
  return Utilities.base64Encode(gzipBlob.getBytes());
}

function descomprimir_(base64) {
  var bytes = Utilities.base64Decode(base64);
  var gzipBlob = Utilities.newBlob(bytes, 'application/x-gzip');
  var blob = Utilities.ungzip(gzipBlob);
  return blob.getDataAsString();
}

function fatiarEmChunks_(texto, tamanho) {
  var chunks = [];
  for (var i = 0; i < texto.length; i += tamanho) {
    chunks.push(texto.substring(i, i + tamanho));
  }
  if (chunks.length === 0) chunks.push(''); // garante ao menos 1 chunk (documento vazio)
  return chunks;
}

// Remove todos os chunks de uma gravação anterior, com base na contagem
// registrada em PROP_META (evita deixar chunks "órfãos" quando um novo save
// precisa de menos pedaços do que o anterior).
function limparChunks_(userProperties) {
  var metaTexto = userProperties.getProperty(PROP_META);
  if (!metaTexto) return;
  var meta = JSON.parse(metaTexto);
  for (var i = 0; i < meta.chunks; i++) {
    userProperties.deleteProperty(PROP_CHUNK_PREFIX + i);
  }
}

// --- Projetos compartilhados (multi-usuário) -------------------------------
// O modelo acima (PropertiesService.getUserProperties()) é, por definição,
// isolado por conta Google: não há como um segundo analista (ex.: o de
// implantação) enxergar ou editar o mesmo rascunho, nem existe o conceito de
// "vários projetos nomeados" — só um rascunho por pessoa.
//
// Para suportar múltiplos projetos por analista e o trabalho em dupla
// (compartilhamento entre o analista de projeto e o de implantação), o
// armazenamento passa a ser uma Planilha Google, criada automaticamente na
// primeira execução e referenciada via ScriptProperties (visível a todos os
// usuários do script, ao contrário de UserProperties). Uma planilha suporta
// muito mais dados no total do que os ~500 KB de PropertiesService, o que
// seria insuficiente para dezenas de projetos reais ao longo do tempo.
//
// Estrutura da planilha:
//   - Aba "Projetos": 1 linha por projeto — ID, Nome, DonoEmail,
//     ColaboradoresJSON (lista de {email, papel}), CriadoEm, AtualizadoEm,
//     AtualizadoPorEmail.
//   - Aba "Dados": 1 linha por projeto — ProjetoID, ConteudoBase64 (o mesmo
//     JSON do documento, comprimido com gzip/base64 via comprimirEcodificar_,
//     reaproveitando as funções já existentes acima).
//
// Papéis possíveis: "dono" (criador, pode compartilhar/excluir/editar),
// "edicao" (pode editar e salvar) e "visualizacao" (somente leitura; o
// front-end bloqueia edição e exportações para esse papel).

var PLANILHA_ID_PROP = 'PROJETOS_SPREADSHEET_ID';
var ABA_PROJETOS = 'Projetos';
var ABA_DADOS = 'Dados';
var CABECALHO_PROJETOS = ['ID', 'Nome', 'DonoEmail', 'ColaboradoresJSON', 'CriadoEm', 'AtualizadoEm', 'AtualizadoPorEmail'];
var CABECALHO_DADOS = ['ProjetoID', 'ConteudoBase64'];

// Identifica o usuário atual pelo e-mail da conta Google logada. Funciona de
// forma confiável quando o Apps Script é implantado dentro do domínio
// Google Workspace da organização (ex.: contas @totvs.com.br / @linx.com.br);
// para usuários totalmente externos ao domínio, getActiveUser() pode vir
// vazio — nesse caso o compartilhamento não tem como funcionar.
function obterUsuarioAtual() {
  var email = '';
  try { email = Session.getActiveUser().getEmail(); } catch (e) {}
  if (!email) {
    try { email = Session.getEffectiveUser().getEmail(); } catch (e) {}
  }
  return email || '';
}

// Obtém (ou cria, na primeira execução) a planilha usada como base de dados
// de projetos, com as duas abas já com cabeçalho.
function obterPlanilhaProjetos_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PLANILHA_ID_PROP);

  if (id) {
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      // Planilha referenciada não existe mais (ex.: removida manualmente);
      // cai para recriação abaixo.
    }
  }

  var planilha = SpreadsheetApp.create('Mapeamento de Marcas - Banco de Projetos');
  props.setProperty(PLANILHA_ID_PROP, planilha.getId());

  var abaProjetos = planilha.getSheets()[0];
  abaProjetos.setName(ABA_PROJETOS);
  abaProjetos.appendRow(CABECALHO_PROJETOS);

  var abaDados = planilha.insertSheet(ABA_DADOS);
  abaDados.appendRow(CABECALHO_DADOS);

  return planilha;
}

function obterAba_(nomeAba) {
  return obterPlanilhaProjetos_().getSheetByName(nomeAba);
}

// Localiza a linha de um projeto pelo ID. Retorna { linha (1-based), valores }.
function localizarLinhaProjeto_(abaProjetos, projetoId) {
  var dados = abaProjetos.getDataRange().getValues();
  for (var i = 1; i < dados.length; i++) {
    if (dados[i][0] === projetoId) return { linha: i + 1, valores: dados[i] };
  }
  return null;
}

// Determina o papel do e-mail informado sobre um projeto já localizado:
// "dono", "edicao", "visualizacao" ou null (sem acesso).
function determinarPapel_(linhaProjeto, email) {
  if (!linhaProjeto) return null;
  if (linhaProjeto.valores[2] === email) return 'dono';

  var colaboradores = [];
  try { colaboradores = JSON.parse(linhaProjeto.valores[3] || '[]'); } catch (e) {}
  for (var i = 0; i < colaboradores.length; i++) {
    if (colaboradores[i].email === email) return colaboradores[i].papel;
  }
  return null;
}

// Lista os projetos onde o usuário atual é dono ou colaborador, com o papel
// de cada um, ordenados do mais recentemente atualizado para o mais antigo.
function listarProjetos() {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var dados = abaProjetos.getDataRange().getValues();
  var resultado = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var colaboradores = [];
    try { colaboradores = JSON.parse(linha[3] || '[]'); } catch (e) {}

    var papel = null;
    if (linha[2] === email) {
      papel = 'dono';
    } else {
      for (var j = 0; j < colaboradores.length; j++) {
        if (colaboradores[j].email === email) { papel = colaboradores[j].papel; break; }
      }
    }
    if (!papel) continue;

    resultado.push({
      id: linha[0],
      nome: linha[1],
      dono: linha[2],
      colaboradores: colaboradores,
      criadoEm: linha[4],
      atualizadoEm: linha[5],
      atualizadoPor: linha[6],
      meuPapel: papel
    });
  }

  resultado.sort(function (a, b) { return new Date(b.atualizadoEm) - new Date(a.atualizadoEm); });
  return resultado;
}

// Cria um projeto novo (vazio — o front-end usa o modelo padrão já embutido
// no HTML) com o usuário atual como dono.
function criarProjeto(nome) {
  var email = obterUsuarioAtual();
  if (!email) throw new Error('Não foi possível identificar seu usuário Google. Verifique se você está logado.');

  var id = Utilities.getUuid();
  var agora = new Date().toISOString();
  var nomeFinal = (nome || '').trim() || 'Novo Projeto';

  obterAba_(ABA_PROJETOS).appendRow([id, nomeFinal, email, '[]', agora, agora, email]);

  return {
    id: id, nome: nomeFinal, dono: email, colaboradores: [],
    criadoEm: agora, atualizadoEm: agora, atualizadoPor: email, meuPapel: 'dono'
  };
}

// Abre um projeto: valida acesso e retorna metadados + conteúdo (já
// descomprimido). conteudoJson vem null para projetos recém-criados, sem
// nenhum save ainda — o front-end mantém o modelo padrão do HTML nesse caso.
function abrirProjeto(projetoId) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);
  var papel = determinarPapel_(linhaProjeto, email);

  if (!papel) throw new Error('Você não tem acesso a este projeto (ou ele foi excluído).');

  var abaDados = obterAba_(ABA_DADOS);
  var dadosDados = abaDados.getDataRange().getValues();
  var conteudoBase64 = null;
  for (var i = 1; i < dadosDados.length; i++) {
    if (dadosDados[i][0] === projetoId) { conteudoBase64 = dadosDados[i][1] || null; break; }
  }

  return {
    projeto: {
      id: linhaProjeto.valores[0],
      nome: linhaProjeto.valores[1],
      dono: linhaProjeto.valores[2],
      colaboradores: JSON.parse(linhaProjeto.valores[3] || '[]'),
      criadoEm: linhaProjeto.valores[4],
      atualizadoEm: linhaProjeto.valores[5],
      atualizadoPor: linhaProjeto.valores[6],
      meuPapel: papel
    },
    conteudoJson: conteudoBase64 ? descomprimir_(conteudoBase64) : null
  };
}

// Salva o conteúdo de um projeto específico. Exige papel "dono" ou "edicao";
// "visualizacao" é rejeitado mesmo que o front-end tente chamar por engano.
function salvarProjetoAtual(projetoId, dadosJson) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);
  var papel = determinarPapel_(linhaProjeto, email);

  if (papel !== 'dono' && papel !== 'edicao') {
    throw new Error('Você não tem permissão de edição neste projeto.');
  }

  var comprimido = comprimirEcodificar_(dadosJson);

  var abaDados = obterAba_(ABA_DADOS);
  var dadosDados = abaDados.getDataRange().getValues();
  var linhaDados = -1;
  for (var i = 1; i < dadosDados.length; i++) {
    if (dadosDados[i][0] === projetoId) { linhaDados = i + 1; break; }
  }

  if (linhaDados > 0) {
    abaDados.getRange(linhaDados, 2).setValue(comprimido);
  } else {
    abaDados.appendRow([projetoId, comprimido]);
  }

  var agora = new Date().toISOString();
  abaProjetos.getRange(linhaProjeto.linha, 6, 1, 2).setValues([[agora, email]]);

  return { atualizadoEm: agora, atualizadoPor: email };
}

// Reseta o conteúdo salvo de um projeto (volta ao modelo padrão embutido no
// HTML), preservando o projeto, o dono e os colaboradores. Exige papel
// "dono" ou "edicao", igual ao salvarProjetoAtual.
function resetarProjetoAtual(projetoId) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);
  var papel = determinarPapel_(linhaProjeto, email);

  if (papel !== 'dono' && papel !== 'edicao') {
    throw new Error('Você não tem permissão de edição neste projeto.');
  }

  var abaDados = obterAba_(ABA_DADOS);
  var dadosDados = abaDados.getDataRange().getValues();
  for (var i = dadosDados.length - 1; i >= 1; i--) {
    if (dadosDados[i][0] === projetoId) abaDados.deleteRow(i + 1);
  }

  var agora = new Date().toISOString();
  abaProjetos.getRange(linhaProjeto.linha, 6, 1, 2).setValues([[agora, email]]);

  return true;
}

// Concede (ou atualiza) o acesso de um colaborador. Só o dono pode chamar.
function compartilharProjeto(projetoId, emailColaborador, papelConcedido) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);

  if (!linhaProjeto || linhaProjeto.valores[2] !== email) {
    throw new Error('Apenas o dono do projeto pode compartilhá-lo.');
  }
  if (['edicao', 'visualizacao'].indexOf(papelConcedido) === -1) {
    throw new Error('Papel inválido: use "edicao" ou "visualizacao".');
  }

  emailColaborador = (emailColaborador || '').trim().toLowerCase();
  if (!emailColaborador || emailColaborador === email.toLowerCase()) {
    throw new Error('Informe o e-mail de outro usuário.');
  }

  var colaboradores = JSON.parse(linhaProjeto.valores[3] || '[]');
  var existente = null;
  for (var i = 0; i < colaboradores.length; i++) {
    if (colaboradores[i].email.toLowerCase() === emailColaborador) { existente = colaboradores[i]; break; }
  }
  if (existente) existente.papel = papelConcedido;
  else colaboradores.push({ email: emailColaborador, papel: papelConcedido });

  abaProjetos.getRange(linhaProjeto.linha, 4).setValue(JSON.stringify(colaboradores));
  return colaboradores;
}

// Remove o acesso de um colaborador. Só o dono pode chamar.
function removerColaborador(projetoId, emailColaborador) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);

  if (!linhaProjeto || linhaProjeto.valores[2] !== email) {
    throw new Error('Apenas o dono do projeto pode gerenciar colaboradores.');
  }

  var colaboradores = JSON.parse(linhaProjeto.valores[3] || '[]');
  var alvo = (emailColaborador || '').trim().toLowerCase();
  colaboradores = colaboradores.filter(function (c) { return c.email.toLowerCase() !== alvo; });

  abaProjetos.getRange(linhaProjeto.linha, 4).setValue(JSON.stringify(colaboradores));
  return colaboradores;
}

// Exclui um projeto (linha de metadados + linha de conteúdo). Só o dono
// pode chamar; colaboradores não podem excluir o projeto de outra pessoa.
function excluirProjeto(projetoId) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);

  if (!linhaProjeto || linhaProjeto.valores[2] !== email) {
    throw new Error('Apenas o dono do projeto pode excluí-lo.');
  }

  abaProjetos.deleteRow(linhaProjeto.linha);

  var abaDados = obterAba_(ABA_DADOS);
  var dadosDados = abaDados.getDataRange().getValues();
  for (var i = dadosDados.length - 1; i >= 1; i--) {
    if (dadosDados[i][0] === projetoId) abaDados.deleteRow(i + 1);
  }

  return true;
}

// Migração automática do modelo antigo (rascunho único em
// PropertiesService.getUserProperties(), anterior ao conceito de projetos):
// se o usuário ainda tem um rascunho legado e nenhum projeto próprio, um
// projeto é criado automaticamente a partir dele, preservando o trabalho já
// feito antes desta mudança sem exigir nenhuma ação manual do analista.
function migrarRascunhoLegadoSeNecessario_() {
  var userProperties = PropertiesService.getUserProperties();
  var metaTexto = userProperties.getProperty(PROP_META);
  var legado = userProperties.getProperty(PROP_LEGADO);

  if (!metaTexto && !legado) return; // nada a migrar

  if (listarProjetos().length > 0) return; // já tem projeto(s) no novo modelo; não migra de novo

  var conteudoJson;
  if (metaTexto) {
    var meta = JSON.parse(metaTexto);
    var partes = [];
    for (var i = 0; i < meta.chunks; i++) {
      partes.push(userProperties.getProperty(PROP_CHUNK_PREFIX + i) || '');
    }
    conteudoJson = descomprimir_(partes.join(''));
  } else {
    conteudoJson = legado;
  }

  var novoProjeto = criarProjeto('Meu Projeto (migrado)');
  salvarProjetoAtual(novoProjeto.id, conteudoJson);

  limparChunks_(userProperties);
  userProperties.deleteProperty(PROP_META);
  userProperties.deleteProperty(PROP_LEGADO);
}

// Ponto de entrada usado pelo front-end: garante a migração do rascunho
// legado (se houver) e devolve a lista de projetos já atualizada.
function listarProjetosComMigracao() {
  migrarRascunhoLegadoSeNecessario_();
  return listarProjetos();
}