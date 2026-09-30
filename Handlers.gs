/**
 * Handlers.gs
 * Funções expostas ao frontend (google.script.run)
 * MANTÉM nomes existentes para compatibilidade retroativa
 */

// Projetos
function listarProjetos() {
  try {
    return svcListarProjetos();
  } catch (err) {
    pushLog('ERROR', 'listarProjetos(handler)', { error: err.toString() });
    return responseFail('Erro interno', 'Falha ao listar projetos');
  }
}

function carregarProjeto(projetoId) {
  try {
    return svcCarregarProjeto(projetoId);
  } catch (err) {
    pushLog('ERROR', 'carregarProjeto(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao carregar projeto');
  }
}

function criarProjeto(dadosProjeto) {
  try {
    return svcCriarProjeto(dadosProjeto);
  } catch (err) {
    pushLog('ERROR', 'criarProjeto(handler)', { error: err.toString() });
    return responseFail('Erro interno', 'Falha ao criar projeto');
  }
}

// Compat: alguns frontends podem chamar com (id, dados)
function salvarProjeto(projetoIdOrDados, dadosProjetoOpt) {
  try {
    // Suporta ambas assinaturas: salvarProjeto(dados) OU salvarProjeto(id, dados)
    let projetoId;
    let dadosProjeto;

    if (projetoIdOrDados && typeof projetoIdOrDados === 'object' && !dadosProjetoOpt) {
      // Chamada: salvarProjeto(dadosProjeto)
      dadosProjeto = projetoIdOrDados;
      projetoId = dadosProjeto.id || dadosProjeto.projetoId;
    } else {
      // Chamada: salvarProjeto(projetoId, dadosProjeto)
      projetoId = projetoIdOrDados;
      dadosProjeto = dadosProjetoOpt || {};
    }

    if (isEmpty(projetoId)) {
      return responseFail('ID do projeto é obrigatório', 'Dados inválidos');
    }
    return svcSalvarProjeto(projetoId, dadosProjeto);
  } catch (err) {
    pushLog('ERROR', 'salvarProjeto(handler)', { error: err.toString() });
    return responseFail('Erro interno', 'Falha ao salvar projeto');
  }
}

function excluirProjeto(projetoId) {
  try {
    return svcExcluirProjeto(projetoId);
  } catch (err) {
    pushLog('ERROR', 'excluirProjeto(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao excluir projeto');
  }
}

// Rascunhos (auto-save)
function salvarRascunho(projetoId, dados) {
  try {
    return svcSalvarRascunho(projetoId, dados);
  } catch (err) {
    pushLog('ERROR', 'salvarRascunho(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao salvar rascunho');
  }
}

function carregarRascunho(projetoId) {
  try {
    return svcCarregarRascunho(projetoId);
  } catch (err) {
    pushLog('ERROR', 'carregarRascunho(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao carregar rascunho');
  }
}

function limparRascunho(projetoId) {
  try {
    return svcLimparRascunho(projetoId);
  } catch (err) {
    pushLog('ERROR', 'limparRascunho(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao limpar rascunho');
  }
}

// Compat antigo: limparRascunhoGoogle (usado no sidebar)
function limparRascunhoGoogle(projetoId) {
  try {
    if (isEmpty(projetoId)) {
      return responseFail('ID do projeto é obrigatório', 'Dados inválidos');
    }
    return svcLimparRascunho(projetoId);
  } catch (err) {
    pushLog('ERROR', 'limparRascunhoGoogle(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao limpar rascunho');
  }
}

// Resetar projeto p/ modelo padrão
function resetarProjeto(projetoId, dadosPadrao) {
  try {
    return svcResetarProjeto(projetoId, dadosPadrao);
  } catch (err) {
    pushLog('ERROR', 'resetarProjeto(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao resetar projeto');
  }
}

// Compartilhamento
function compartilharProjeto(payload) {
  try {
    return svcCompartilharProjeto(payload);
  } catch (err) {
    pushLog('ERROR', 'compartilharProjeto(handler)', { error: err.toString() });
    return responseFail('Erro interno', 'Falha ao compartilhar projeto');
  }
}

// Logs / Diagnóstico
function listarLogs(limit) {
  try {
    return svcListarLogs(limit);
  } catch (err) {
    return responseFail('Erro interno', 'Falha ao listar logs');
  }
}

function salvarLog(level, message, meta) {
  try {
    return svcSalvarLogEntry(level, message, meta);
  } catch (err) {
    return responseFail('Erro interno', 'Falha ao salvar log');
  }
}

function limparLogs() {
  try {
    return svcLimparLogs();
  } catch (err) {
    return responseFail('Erro interno', 'Falha ao limpar logs');
  }
}

function getDiagnostico() {
  try {
    return svcGetDiagnostico();
  } catch (err) {
    return responseFail('Erro interno', 'Falha ao obter diagnóstico');
  }
}

// Alias p/ compatibilidade (se front chamar nomes diferentes)
function limparLogsDiagnostico() {
  return limparLogs();
}

function exportarLogsBruto() {
  // Mantido p/ compatibilidade: retorna logs completos
  try {
    const res = svcListarLogs(100);
    return res;
  } catch (err) {
    return responseFail('Erro interno', 'Falha ao exportar logs');
  }
}

// Helper de setup (opcional Fase 3)
function configurarSpreadsheet(spreadsheetId) {
  try {
    if (isEmpty(spreadsheetId)) {
      return responseFail('Spreadsheet ID obrigatório', 'Dados inválidos');
    }
    const r = setSpreadsheetId(spreadsheetId);
    return responseOk(r, 'Spreadsheet configurado');
  } catch (err) {
    return responseFail('Erro interno', 'Falha ao configurar spreadsheet');
  }
}