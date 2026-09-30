/**
 * Handlers.gs
 * Funções expostas ao frontend (google.script.run)
 * MANTÉM nomes existentes para compatibilidade retroativa
 */

function pingAutorizacao() {
  let authorizationInfo;
  try {
    authorizationInfo = ScriptApp.getAuthorizationInfo(ScriptApp.AuthMode.FULL);
  } catch (err) {
    pushLog('ERROR', 'pingAutorizacao(authorization)', { error: err.toString() });
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      message: 'Este aplicativo precisa de autorização para acessar os projetos.'
    };
  }

  if (authorizationInfo.getAuthorizationStatus() === ScriptApp.AuthorizationStatus.REQUIRED) {
    return {
      ok: false,
      code: 'AUTH_REQUIRED',
      authorizationUrl: authorizationInfo.getAuthorizationUrl(),
      webAppUrl: ScriptApp.getService().getUrl(),
      message: 'Este aplicativo precisa de autorização para acessar os projetos.'
    };
  }

  try {
    const scriptProperties = PropertiesService.getScriptProperties();
    const scriptPropertyValue = scriptProperties.getProperty('SPREADSHEET_ID');
    const spreadsheetId = getSpreadsheetId();
    const spreadsheet = spreadsheetId
      ? SpreadsheetApp.openById(spreadsheetId)
      : SpreadsheetApp.getActiveSpreadsheet();

    if (!spreadsheet) {
      const scriptPropertyKeys = Object.keys(scriptProperties.getProperties());
      let userPropertyConfigured = false;
      let documentPropertyConfigured = false;

      try {
        const userPropertyValue = PropertiesService.getUserProperties()
          .getProperty('SPREADSHEET_ID');
        userPropertyConfigured = Boolean(userPropertyValue && userPropertyValue.trim());
      } catch (err) {
        pushLog('WARN', 'pingAutorizacao(userProperties)', { error: err.toString() });
      }

      try {
        const documentPropertyValue = PropertiesService.getDocumentProperties()
          .getProperty('SPREADSHEET_ID');
        documentPropertyConfigured = Boolean(
          documentPropertyValue && documentPropertyValue.trim()
        );
      } catch (err) {
        pushLog('WARN', 'pingAutorizacao(documentProperties)', { error: err.toString() });
      }

      return {
        ok: false,
        code: 'CONFIGURATION_ERROR',
        message: 'A execução atual do aplicativo não encontrou uma planilha de projetos.',
        diagnostics: {
          scriptPropertyExists: scriptPropertyValue !== null,
          scriptPropertyHasValue: Boolean(
            scriptPropertyValue && scriptPropertyValue.trim()
          ),
          similarScriptPropertyKeyExists: scriptPropertyKeys.some(
            key => key !== 'SPREADSHEET_ID' &&
              key.trim().toUpperCase() === 'SPREADSHEET_ID'
          ),
          userPropertyHasValue: userPropertyConfigured,
          documentPropertyHasValue: documentPropertyConfigured,
          activeSpreadsheetAvailable: false,
          runtimeProjectId: ScriptApp.getScriptId()
        }
      };
    }

    return responseOk({
      authorized: true,
      webAppUrl: ScriptApp.getService().getUrl()
    });
  } catch (err) {
    pushLog('ERROR', 'pingAutorizacao(spreadsheet)', { error: err.toString() });
    return {
      ok: false,
      code: 'PROJECT_ACCESS_DENIED',
      message: 'A conta atual não conseguiu acessar a planilha de projetos.'
    };
  }
}

// Projetos
function listarProjetos() {
  try {
    return svcListarProjetos();
  } catch (err) {
    pushLog('ERROR', 'listarProjetos(handler)', { error: err.toString() });
    return responseFail('Erro interno', 'Falha ao listar projetos');
  }
}

function listarProjetosComMigracao() {
  const result = svcListarProjetos();
  if (!result || !result.ok) {
    const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : '';
    throw new Error(errors || 'Falha ao listar projetos');
  }

  const emailAtual = safeString(Session.getActiveUser().getEmail()).trim().toLowerCase();
  return result.data.map(projeto => {
    const compartilhamentos = Array.isArray(projeto.compartilhamentos)
      ? projeto.compartilhamentos
      : [];
    const compartilhamentoAtual = compartilhamentos.find(item =>
      safeString(item.email).trim().toLowerCase() === emailAtual
    );
    const proprietario = safeString(projeto.proprietario || projeto.owner).trim();
    const papel = proprietario.toLowerCase() === emailAtual
      ? 'dono'
      : compartilhamentoAtual
        ? (['editor', 'edicao'].includes(safeString(compartilhamentoAtual.papel).toLowerCase())
          ? 'edicao'
          : 'visualizacao')
        : 'visualizacao';

    return Object.assign({}, projeto, {
      dono: proprietario || 'Não informado',
      meuPapel: papel,
      atualizadoPor: projeto.atualizadoPor || ''
    });
  }).filter(projeto =>
    projeto.meuPapel !== 'visualizacao' ||
    projeto.compartilhamentos.some(item =>
      safeString(item.email).trim().toLowerCase() === emailAtual
    )
  );
}

function carregarProjeto(projetoId) {
  try {
    return svcCarregarProjeto(projetoId);
  } catch (err) {
    pushLog('ERROR', 'carregarProjeto(handler)', { projetoId, error: err.toString() });
    return responseFail('Erro interno', 'Falha ao carregar projeto');
  }
}

function abrirProjeto(projetoId) {
  const result = svcCarregarProjeto(projetoId);
  if (!result || !result.ok || !result.data) {
    const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : '';
    throw new Error(errors || 'Falha ao carregar projeto');
  }

  const projeto = result.data;
  const emailAtual = safeString(Session.getActiveUser().getEmail()).trim().toLowerCase();
  const compartilhamentoAtual = (projeto.compartilhamentos || []).find(item =>
    safeString(item.email).trim().toLowerCase() === emailAtual
  );
  const proprietario = safeString(projeto.proprietario || projeto.owner).trim();
  const meuPapel = proprietario.toLowerCase() === emailAtual
    ? 'dono'
    : compartilhamentoAtual
      ? (['editor', 'edicao'].includes(safeString(compartilhamentoAtual.papel).toLowerCase())
        ? 'edicao'
        : 'visualizacao')
      : 'visualizacao';

  return {
    projeto: Object.assign({}, projeto, {
      dono: proprietario || 'Não informado',
      meuPapel: meuPapel,
      colaboradores: projeto.compartilhamentos || []
    }),
    conteudoJson: safeJsonStringify(projeto.dados || {})
  };
}

function criarProjeto(dadosProjeto) {
  const legado = typeof dadosProjeto === 'string';
  const dados = legado
    ? {
      nome: dadosProjeto,
      proprietario: safeString(Session.getActiveUser().getEmail()).trim().toLowerCase()
    }
    : dadosProjeto;
  try {
    const result = svcCriarProjeto(dados || {});
    if (!legado) return result;
    if (!result || !result.ok || !result.data || !result.data.projeto) {
      const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : '';
      throw new Error(errors || 'Falha ao criar projeto');
    }
    return Object.assign({}, result.data.projeto, {
      dono: result.data.projeto.proprietario || 'Não informado',
      meuPapel: 'dono',
      colaboradores: []
    });
  } catch (err) {
    pushLog('ERROR', 'criarProjeto(handler)', { error: err.toString() });
    if (legado) throw err;
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
function compartilharProjeto(payload, email, papel) {
  const legado = arguments.length > 1;
  const request = legado
    ? {
      projetoId: payload,
      email: email,
      papel: ['visualizacao', 'leitor'].includes(safeString(papel).toLowerCase())
        ? 'leitor'
        : 'editor'
    }
    : payload;
  try {
    const result = svcCompartilharProjeto(request);
    if (!legado) return result;
    if (!result || !result.ok || !result.data) {
      const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : '';
      throw new Error(errors || 'Falha ao compartilhar projeto');
    }
    return result.data.compartilhamentos;
  } catch (err) {
    pushLog('ERROR', 'compartilharProjeto(handler)', { error: err.toString() });
    if (legado) throw err;
    return responseFail('Erro interno', 'Falha ao compartilhar projeto');
  }
}

function removerColaborador(projetoId, email) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const found = repoBuscarProjetoPorId(projetoId);
    if (!found || !found.registro) throw new Error('Projeto não encontrado');

    const compartilhamentos = (found.registro.compartilhamentos || []).filter(item =>
      safeString(item.email).trim().toLowerCase() !== safeString(email).trim().toLowerCase()
    );
    repoAtualizarProjeto(found.rowIndex, Object.assign({}, found.registro, {
      compartilhamentos: compartilhamentos,
      atualizadoEm: nowISO()
    }));
    return compartilhamentos;
  } catch (err) {
    pushLog('ERROR', 'removerColaborador(handler)', {
      projetoId: projetoId,
      error: err.toString()
    });
    throw err;
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }
}

function salvarProjetoAtual(projetoId, conteudoJson) {
  const loaded = svcCarregarProjeto(projetoId);
  if (!loaded || !loaded.ok || !loaded.data) {
    const errors = loaded && Array.isArray(loaded.errors) ? loaded.errors.join('; ') : '';
    throw new Error(errors || 'Falha ao carregar projeto para salvar');
  }

  const projeto = loaded.data;
  const dados = typeof conteudoJson === 'string'
    ? safeJsonParse(conteudoJson, {})
    : (conteudoJson || {});
  const saved = svcSalvarProjeto(projetoId, {
    nome: projeto.nome,
    descricao: projeto.descricao,
    dados: dados,
    compartilhamentos: projeto.compartilhamentos || [],
    proprietario: projeto.proprietario || '',
    status: projeto.status || 'ativo'
  });
  if (!saved || !saved.ok || !saved.data) {
    const errors = saved && Array.isArray(saved.errors) ? saved.errors.join('; ') : '';
    throw new Error(errors || 'Falha ao salvar projeto');
  }

  return {
    atualizadoEm: saved.data.projeto.atualizadoEm,
    atualizadoPor: safeString(Session.getActiveUser().getEmail())
  };
}

function resetarProjetoAtual(projetoId) {
  const result = svcResetarProjeto(projetoId, {});
  if (!result || !result.ok) {
    const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : '';
    throw new Error(errors || 'Falha ao resetar projeto');
  }
  return result;
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

function obterDiagnosticoSistema() {
  const result = svcGetDiagnostico();
  if (!result || !result.ok) {
    const errors = result && Array.isArray(result.errors) ? result.errors.join('; ') : '';
    throw new Error(errors || 'Falha ao obter diagnóstico');
  }

  const projects = listarProjetosComMigracao();
  const logsResult = svcListarLogs(30);
  const logs = logsResult && logsResult.ok && Array.isArray(logsResult.data)
    ? logsResult.data
    : [];

  return Object.assign({}, result.data, {
    usuario: safeString(Session.getActiveUser().getEmail()) || '(desconhecido)',
    total_projetos_do_usuario: projects.length,
    projetos: projects.map(projeto => ({
      id: projeto.id,
      nome: projeto.nome,
      dono: projeto.dono,
      meu_papel: projeto.meuPapel,
      colaboradores_qtd: (projeto.compartilhamentos || []).length,
      criado_em: projeto.criadoEm || '',
      atualizado_em: projeto.atualizadoEm || ''
    })),
    logs: {
      sucesso: true,
      total: logs.length,
      logs: logs.map(log => ({
        data_hora: log.ts || '',
        usuario: '',
        tipo: log.level || 'INFO',
        id_projeto: log.meta && log.meta.projetoId || '',
        descricao: log.message || '',
        extra: log.meta || null
      }))
    }
  });
}

function logarErro_(projetoId, mensagem, detalhes) {
  return salvarLog('ERROR', mensagem, {
    projetoId: projetoId || null,
    detalhes: detalhes || {}
  });
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