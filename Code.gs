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
//
// IMPORTANTE: como o Web App precisa rodar como "Executar como: usuário que
// acessa o app" (para Session.getActiveUser() identificar cada analista),
// SpreadsheetApp.create() cria o arquivo na conta de quem quer que tenha
// disparado esta função pela primeira vez — e esse arquivo nasce PRIVADO,
// visível só para quem o criou. Sem compartilhá-lo explicitamente, qualquer
// outro colaborador que tentar abrir esse mesmo ID via openById() recebe um
// erro de permissão. Por isso, logo após criar a planilha, ela é
// compartilhada com todo o domínio Workspace (mesma premissa de
// Session.getActiveUser() já documentada no README) com permissão de edição.
//
// Um LockService evita que dois usuários, ambos vendo a propriedade vazia ao
// mesmo tempo (ex.: primeiro acesso concorrente de dois analistas), criem
// duas planilhas em paralelo.
function obterPlanilhaProjetos_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PLANILHA_ID_PROP);

  if (id) {
    // Se a planilha já foi registrada, SEMPRE tentamos abri-la — nunca
    // recriamos silenciosamente aqui. Um erro de abertura quase sempre é
    // falta de compartilhamento (não "a planilha sumiu"), e recriar do zero
    // faria o app inteiro passar a apontar para uma planilha nova e vazia,
    // "perdendo" todos os projetos existentes para todo mundo.
    try {
      return SpreadsheetApp.openById(id);
    } catch (e) {
      throw new Error(
        'Não foi possível acessar a planilha de projetos (ID ' + id + '). ' +
        'Provavelmente ela não está compartilhada com o seu usuário. ' +
        'Peça para quem administra o script compartilhar essa planilha (Google Drive) ' +
        'com edição para o seu domínio/e-mail. Detalhe técnico: ' + e.message
      );
    }
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Reconfirma dentro do lock: outro usuário pode ter criado a planilha
    // enquanto esperávamos.
    id = props.getProperty(PLANILHA_ID_PROP);
    if (id) return SpreadsheetApp.openById(id);

    var planilha = SpreadsheetApp.create('Mapeamento de Marcas - Banco de Projetos');

    // Compartilha com todo o domínio (edição) para que qualquer colega da
    // mesma organização consiga abrir/gravar nessa planilha, independente
    // de quem a criou.
    try {
      DriveApp.getFileById(planilha.getId()).setSharing(DriveApp.Access.DOMAIN, DriveApp.Access.EDIT);
    } catch (e) {
      // Se o domínio não permitir esse nível de sharing (conta pessoal, por
      // exemplo), a planilha continua funcional para o próprio dono; os
      // demais usuários precisarão receber acesso manual pelo Drive.
    }

    var abaProjetos = planilha.getSheets()[0];
    abaProjetos.setName(ABA_PROJETOS);
    abaProjetos.appendRow(CABECALHO_PROJETOS);

    var abaDados = planilha.insertSheet(ABA_DADOS);
    abaDados.appendRow(CABECALHO_DADOS);

    props.setProperty(PLANILHA_ID_PROP, planilha.getId());
    return planilha;
  } finally {
    lock.releaseLock();
  }
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
// "dono", "edicao", "visualizacao" ou null (sem acesso). Comparação é
// case-insensitive porque o Google pode devolver o e-mail do usuário com
// capitalização diferente da que foi digitada por quem compartilhou.
function determinarPapel_(linhaProjeto, email) {
  if (!linhaProjeto) return null;
  var emailNormalizado = (email || '').toLowerCase();
  if ((linhaProjeto.valores[2] || '').toLowerCase() === emailNormalizado) return 'dono';

  var colaboradores = [];
  try { colaboradores = JSON.parse(linhaProjeto.valores[3] || '[]'); } catch (e) {}
  for (var i = 0; i < colaboradores.length; i++) {
    if ((colaboradores[i].email || '').toLowerCase() === emailNormalizado) return colaboradores[i].papel;
  }
  return null;
}

// Lista os projetos onde o usuário atual é dono ou colaborador, com o papel
// de cada um, ordenados do mais recentemente atualizado para o mais antigo.
function listarProjetos() {
  var email = (obterUsuarioAtual() || '').toLowerCase();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var dados = abaProjetos.getDataRange().getValues();
  var resultado = [];

  for (var i = 1; i < dados.length; i++) {
    var linha = dados[i];
    var colaboradores = [];
    try { colaboradores = JSON.parse(linha[3] || '[]'); } catch (e) {}

    var papel = null;
    if ((linha[2] || '').toLowerCase() === email) {
      papel = 'dono';
    } else {
      for (var j = 0; j < colaboradores.length; j++) {
        if ((colaboradores[j].email || '').toLowerCase() === email) { papel = colaboradores[j].papel; break; }
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
  try {
    var email = obterUsuarioAtual();
    if (!email) throw new Error('Não foi possível identificar seu usuário Google. Verifique se você está logado.');

    var id = Utilities.getUuid();
    var agora = new Date().toISOString();
    var nomeFinal = (nome || '').trim() || 'Novo Projeto';

    obterAba_(ABA_PROJETOS).appendRow([id, nomeFinal, email, '[]', agora, agora, email]);

    logarCriacaoProjeto_(id, nomeFinal);

    return {
      id: id, nome: nomeFinal, dono: email, colaboradores: [],
      criadoEm: agora, atualizadoEm: agora, atualizadoPor: email, meuPapel: 'dono'
    };
  } catch (e) {
    var detalhes = {
      mensagem_erro: e.message,
      stack: e.stack,
      timestamp: new Date().toISOString()
    };
    logarErro_('', 'Erro ao criar projeto: ' + e.message, detalhes);
    throw e;
  }
}

// Abre um projeto: valida acesso e retorna metadados + conteúdo (já
// descomprimido). conteudoJson vem null para projetos recém-criados, sem
// nenhum save ainda — o front-end mantém o modelo padrão do HTML nesse caso.
function abrirProjeto(projetoId) {
  try {
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
  } catch (e) {
    var detalhes = {
      projetoId: projetoId,
      mensagem_erro: e.message,
      stack: e.stack,
      timestamp: new Date().toISOString()
    };
    logarErro_(projetoId, 'Erro ao abrir projeto: ' + e.message, detalhes);
    throw e;
  }
}

// Salva o conteúdo de um projeto específico. Exige papel "dono" ou "edicao";
// "visualizacao" é rejeitado mesmo que o front-end tente chamar por engano.
function salvarProjetoAtual(projetoId, dadosJson) {
  try {
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

    logarSalvamento_(projetoId);

    return { atualizadoEm: agora, atualizadoPor: email };
  } catch (e) {
    var detalhes = {
      projetoId: projetoId,
      mensagem_erro: e.message,
      stack: e.stack,
      timestamp: new Date().toISOString()
    };
    logarErro_(projetoId, 'Erro ao salvar projeto: ' + e.message, detalhes);
    throw e;
  }
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

// Renomeia um projeto. Exige papel "dono" ou "edicao".
function renomearProjeto(projetoId, novoNome) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);
  var papel = determinarPapel_(linhaProjeto, email);

  if (papel !== 'dono' && papel !== 'edicao') {
    throw new Error('Você não tem permissão para renomear este projeto.');
  }

  var nomeFinal = (novoNome || '').trim();
  if (!nomeFinal) {
    throw new Error('Informe um nome válido para o projeto.');
  }

  abaProjetos.getRange(linhaProjeto.linha, 2).setValue(nomeFinal);
  
  var agora = new Date().toISOString();
  abaProjetos.getRange(linhaProjeto.linha, 6, 1, 2).setValues([[agora, email]]);

  return { nome: nomeFinal, atualizadoEm: agora, atualizadoPor: email };
}

// Concede (ou atualiza) o acesso de um colaborador. Só o dono pode chamar.
// Adiciona timeout handling para evitar loops infinitos em case de lock contention.
function compartilharProjeto(projetoId, emailColaborador, papelConcedido) {
  try {
    var email = obterUsuarioAtual();
    var abaProjetos = obterAba_(ABA_PROJETOS);
    var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);

    if (!linhaProjeto || (linhaProjeto.valores[2] || '').toLowerCase() !== email.toLowerCase()) {
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
    
    var acao = existente ? 'atualizado' : 'adicionado';
    logarCompartilhamento_(projetoId, emailColaborador, acao, papelConcedido);
    
    return colaboradores;
  } catch (e) {
    var detalhes = {
      projetoId: projetoId,
      emailColaborador: emailColaborador,
      mensagem_erro: e.message,
      stack: e.stack,
      timestamp: new Date().toISOString()
    };
    logarErro_(projetoId, 'Erro ao compartilhar projeto: ' + e.message, detalhes);
    throw e;
  }
}

// Remove o acesso de um colaborador. Só o dono pode chamar.
function removerColaborador(projetoId, emailColaborador) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);

  if (!linhaProjeto || (linhaProjeto.valores[2] || '').toLowerCase() !== email.toLowerCase()) {
    throw new Error('Apenas o dono do projeto pode gerenciar colaboradores.');
  }

  var colaboradores = JSON.parse(linhaProjeto.valores[3] || '[]');
  var alvo = (emailColaborador || '').trim().toLowerCase();
  colaboradores = colaboradores.filter(function (c) { return c.email.toLowerCase() !== alvo; });

  abaProjetos.getRange(linhaProjeto.linha, 4).setValue(JSON.stringify(colaboradores));
  
  logarCompartilhamento_(projetoId, emailColaborador, 'removido', null);
  
  return colaboradores;
}

// Exclui um projeto (linha de metadados + linha de conteúdo). Só o dono
// pode chamar; colaboradores não podem excluir o projeto de outra pessoa.
function excluirProjeto(projetoId) {
  var email = obterUsuarioAtual();
  var abaProjetos = obterAba_(ABA_PROJETOS);
  var linhaProjeto = localizarLinhaProjeto_(abaProjetos, projetoId);

  if (!linhaProjeto || (linhaProjeto.valores[2] || '').toLowerCase() !== email.toLowerCase()) {
    throw new Error('Apenas o dono do projeto pode excluí-lo.');
  }

  var nomeProjeto = linhaProjeto.valores[1];
  abaProjetos.deleteRow(linhaProjeto.linha);

  var abaDados = obterAba_(ABA_DADOS);
  var dadosDados = abaDados.getDataRange().getValues();
  for (var i = dadosDados.length - 1; i >= 1; i--) {
    if (dadosDados[i][0] === projetoId) abaDados.deleteRow(i + 1);
  }

  logarExclusaoProjeto_(projetoId, nomeProjeto);

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

// ============================================================================
// FUNÇÃO DE TESTE MANUAL — NÃO é chamada pelo front-end (google.script.run).
// Serve para validar a lógica de permissão/compartilhamento sem depender de
// uma segunda conta Google real. Simula um "e-mail de colaborador fictício"
// diretamente contra a planilha, sem passar por Session.getActiveUser().
//
// Como rodar: no editor do Apps Script, selecione esta função no dropdown ao
// lado do botão "Executar" (ou digite o nome abaixo) e clique em "Executar".
// Depois abra "Ver > Registros de execução" (ou Ctrl+Enter) para ver o resultado
// de cada verificação. Ao final, o projeto de teste criado é excluído
// automaticamente.
//
// O que NÃO é coberto por este teste: se o deploy está configurado como
// "Executar como: usuário que acessa" (isso só se confirma com uma segunda
// conta Google acessando a URL publicada de verdade — ver README, seção
// "Como publicar/rodar").
function testarLogicaDeCompartilhamento() {
  var meuEmail = obterUsuarioAtual();
  var colaboradorFicticio = 'colaborador.teste@totvs.com.br';
  var colaboradorMaiusculo = colaboradorFicticio.toUpperCase(); // valida case-insensitive
  var semAcesso = 'alguem.sem.acesso@totvs.com.br';

  Logger.log('--- Iniciando teste de lógica de compartilhamento ---');
  Logger.log('Usuário atual (dono do projeto de teste): ' + meuEmail);

  var projeto = criarProjeto('__TESTE_COMPARTILHAMENTO__');
  Logger.log('Projeto de teste criado: ' + projeto.id);

  try {
    // 1) Dono deve ter papel "dono".
    var abaProjetos = obterAba_(ABA_PROJETOS);
    var linha = localizarLinhaProjeto_(abaProjetos, projeto.id);
    assertIgual_('Papel do dono', determinarPapel_(linha, meuEmail), 'dono');

    // 2) Sem compartilhamento, e-mail fictício não deve ter acesso.
    assertIgual_('Papel de quem não tem acesso', determinarPapel_(linha, semAcesso), null);

    // 3) Compartilha como "edicao" e confere o papel resolvido.
    compartilharProjeto(projeto.id, colaboradorFicticio, 'edicao');
    linha = localizarLinhaProjeto_(abaProjetos, projeto.id);
    assertIgual_('Papel após compartilhar (edicao)', determinarPapel_(linha, colaboradorFicticio), 'edicao');

    // 4) Case-insensitive: mesmo e-mail em maiúsculas deve resolver igual.
    assertIgual_('Papel com e-mail em maiúsculas', determinarPapel_(linha, colaboradorMaiusculo), 'edicao');

    // 5) Atualiza o papel para "visualizacao" e confere.
    compartilharProjeto(projeto.id, colaboradorFicticio, 'visualizacao');
    linha = localizarLinhaProjeto_(abaProjetos, projeto.id);
    assertIgual_('Papel após atualizar para visualizacao', determinarPapel_(linha, colaboradorFicticio), 'visualizacao');

    // 6) Remove o colaborador e confere que perde o acesso.
    removerColaborador(projeto.id, colaboradorFicticio);
    linha = localizarLinhaProjeto_(abaProjetos, projeto.id);
    assertIgual_('Papel após remover colaborador', determinarPapel_(linha, colaboradorFicticio), null);

    // 7) listarProjetos() do dono deve incluir o projeto de teste.
    var meusProjetos = listarProjetos();
    var encontrado = meusProjetos.some(function (p) { return p.id === projeto.id; });
    assertIgual_('Projeto de teste aparece em listarProjetos() do dono', encontrado, true);

    Logger.log('--- Todos os testes passaram. ---');
  } finally {
    excluirProjeto(projeto.id);
    Logger.log('Projeto de teste excluído (limpeza concluída).');
  }
}

function assertIgual_(rotulo, valorObtido, valorEsperado) {
  var ok = valorObtido === valorEsperado;
  Logger.log((ok ? 'OK   ' : 'FALHA') + ' — ' + rotulo + ' | esperado=' + valorEsperado + ' obtido=' + valorObtido);
  if (!ok) throw new Error('Teste falhou: ' + rotulo + ' (esperado ' + valorEsperado + ', obtido ' + valorObtido + ')');
}

// ============================================================================
// SISTEMA DE LOGGING ESTRUTURADO
// ============================================================================
// Registra eventos de ação (compartilhamento, criação, exclusão, etc) em uma
// aba "Logs" para auditoria e debugging. Acesse a aba "Logs" na planilha de
// banco de dados para ver o histórico completo de ações.

var ABA_LOGS = 'Logs';

function logarAcao_(tipo, idProjeto, descricao, extra) {
  try {
    var planilha = obterPlanilhaProjetos_();
    var abaLogs = planilha.getSheetByName(ABA_LOGS);
    if (!abaLogs) {
      abaLogs = planilha.insertSheet(ABA_LOGS);
      // Criar cabeçalho
      abaLogs.appendRow(['Data/Hora', 'Usuário', 'Tipo', 'ID Projeto', 'Descrição', 'Extra (JSON)']);
    }

    var agora = new Date();
    var usuario = obterUsuarioAtual();
    var extra_json = extra ? JSON.stringify(extra) : '';

    abaLogs.appendRow([agora, usuario, tipo, idProjeto || '', descricao || '', extra_json]);
  } catch (e) {
    Logger.log('Aviso: Erro ao registrar log — ' + e.message);
    // Não lance erro; logging é secundário, não deve quebrar a funcionalidade
  }
}

function logarCompartilhamento_(idProjeto, emailColaborador, acao, papel) {
  logarAcao_('compartilhamento', idProjeto, acao + ' ' + emailColaborador, { papel: papel });
}

function logarCriacaoProjeto_(idProjeto, nomeProjeto) {
  logarAcao_('criacao_projeto', idProjeto, 'Projeto criado: ' + nomeProjeto);
}

function logarExclusaoProjeto_(idProjeto, nomeProjeto) {
  logarAcao_('exclusao_projeto', idProjeto, 'Projeto excluído: ' + nomeProjeto);
}

function logarSalvamento_(idProjeto) {
  logarAcao_('salvamento', idProjeto, 'Conteúdo salvo');
}

function logarErro_(idProjeto, mensagem, detalhes) {
  logarAcao_('erro', idProjeto || '', mensagem, detalhes);
}

// --- FUNÇÕES DE ACESSO A LOGS E DEBUGGING ---
// Retorna os últimos N logs registrados (útil para debugging)
function obterLogsRecentes(limite) {
  limite = limite || 50;
  try {
    var planilha = obterPlanilhaProjetos_();
    var abaLogs = planilha.getSheetByName(ABA_LOGS);
    if (!abaLogs) {
      return { erro: 'Aba de logs não encontrada', logs: [] };
    }

    var dados = abaLogs.getDataRange().getValues();
    var logs = [];
    
    for (var i = Math.max(1, dados.length - limite); i < dados.length; i++) {
      logs.push({
        data_hora: dados[i][0],
        usuario: dados[i][1],
        tipo: dados[i][2],
        id_projeto: dados[i][3],
        descricao: dados[i][4],
        extra: dados[i][5] ? JSON.parse(dados[i][5]) : null
      });
    }
    
    return { sucesso: true, total: dados.length - 1, logs: logs };
  } catch (e) {
    return { erro: e.message, logs: [] };
  }
}

// Retorna diagnostico completo do sistema (projetos, usuários, status de logs)
function obterDiagnosticoSistema() {
  try {
    var usuario = obterUsuarioAtual();
    var meusProjetos = listarProjetos();
    var logsRecentes = obterLogsRecentes(30);
    
    return {
      usuario: usuario,
      total_projetos_do_usuario: meusProjetos.length,
      projetos: meusProjetos.map(function (p) {
        return {
          id: p.id,
          nome: p.nome,
          meu_papel: p.meuPapel,
          dono: p.dono,
          colaboradores_qtd: p.colaboradores.length,
          criado_em: p.criadoEm,
          atualizado_em: p.atualizadoEm
        };
      }),
      logs: logsRecentes,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return {
      erro: e.message,
      stack: e.stack,
      timestamp: new Date().toISOString()
    };
  }
}