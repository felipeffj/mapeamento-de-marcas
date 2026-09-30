/**
 * Services.gs
 * Camada de regras de negócio
 */

function registrarEventoProjeto_(tipo, mensagem, meta) {
  const entry = pushLog(tipo, mensagem, meta);
  if (!repoSalvarLog(entry)) {
    pushLog('ERROR', 'Não foi possível persistir evento na aba Logs', {
      tipo: tipo,
      mensagem: mensagem
    });
  }
}

function svcListarProjetos() {
  try {
    const projetos = repoListarProjetos();
    return responseOk(projetos);
  } catch (err) {
    pushLog('ERROR', 'svcListarProjetos', { error: err.toString() });
    return responseFail('Falha ao listar projetos', 'Erro ao listar projetos');
  }
}

function svcCarregarProjeto(projetoId) {
  const v = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  try {
    const found = repoBuscarProjetoPorId(projetoId);
    if (!found || !found.registro) {
      return responseFail('Projeto não encontrado', 'Projeto não encontrado');
    }
    return responseOk(found.registro);
  } catch (err) {
    pushLog('ERROR', 'svcCarregarProjeto', { projetoId, error: err.toString() });
    return responseFail('Falha ao carregar projeto', 'Erro ao carregar projeto');
  }
}

function svcCriarProjeto(dadosProjeto) {
  const v = validateProjetoCompleto(dadosProjeto || {});
  if (v.length > 0) return responseFail(v, 'Dados inválidos para criar projeto');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // 10s

    const now = nowISO();
    const id = dadosProjeto.id || generateUUID();

    const projeto = {
      id: id,
      nome: normalizeString(dadosProjeto.nome || dadosProjeto.projectName || 'Novo Projeto'),
      descricao: dadosProjeto.descricao || dadosProjeto.description || '',
      dados: dadosProjeto.dados || dadosProjeto.data || {},
      compartilhamentos: Array.isArray(dadosProjeto.compartilhamentos)
        ? dadosProjeto.compartilhamentos
        : (Array.isArray(dadosProjeto.sharedWith) ? dadosProjeto.sharedWith : []),
      criadoEm: dadosProjeto.criadoEm || now,
      atualizadoEm: now,
      atualizadoPor: Session.getActiveUser().getEmail() || '',
      proprietario: dadosProjeto.proprietario || dadosProjeto.owner || '',
      status: dadosProjeto.status || 'ativo'
    };

    const novoId = repoCriarProjeto(projeto);
    registrarEventoProjeto_('criacao', 'Projeto criado', {
      id: novoId,
      projetoId: novoId,
      nome: projeto.nome
    });

    return responseOk({ id: novoId, projeto: projeto }, 'Projeto criado com sucesso');
  } catch (err) {
    pushLog('ERROR', 'svcCriarProjeto', { error: err.toString() });
    return responseFail('Falha ao criar projeto', 'Erro ao criar projeto');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function svcSalvarProjeto(projetoId, dadosProjeto) {
  const vId = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (vId.length > 0) return responseFail(vId, 'Dados inválidos');

  const vProj = validateProjetoCompleto(dadosProjeto || {});
  if (vProj.length > 0) return responseFail(vProj, 'Dados inválidos para salvar projeto');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);

    const found = repoBuscarProjetoPorId(projetoId);
    if (!found || !found.registro) {
      return responseFail('Projeto não encontrado', 'Projeto não encontrado');
    }

    const existente = found.registro;
    const now = nowISO();

    const projetoAtualizado = {
      id: projetoId,
      nome: normalizeString(
        dadosProjeto.nome || dadosProjeto.projectName || existente.nome || 'Projeto'
      ),
      descricao: dadosProjeto.descricao !== undefined
        ? dadosProjeto.descricao
        : (dadosProjeto.description !== undefined ? dadosProjeto.description : existente.descricao || ''),
      dados: dadosProjeto.dados !== undefined
        ? dadosProjeto.dados
        : (dadosProjeto.data !== undefined ? dadosProjeto.data : existente.dados || {}),
      compartilhamentos: Array.isArray(dadosProjeto.compartilhamentos)
        ? dadosProjeto.compartilhamentos
        : (Array.isArray(dadosProjeto.sharedWith)
          ? dadosProjeto.sharedWith
          : (Array.isArray(existente.compartilhamentos) ? existente.compartilhamentos : [])),
      criadoEm: existente.criadoEm || dadosProjeto.criadoEm || now,
      atualizadoEm: now,
      atualizadoPor: Session.getActiveUser().getEmail() || '',
      proprietario: dadosProjeto.proprietario !== undefined
        ? dadosProjeto.proprietario
        : (dadosProjeto.owner !== undefined ? dadosProjeto.owner : existente.proprietario || ''),
      status: dadosProjeto.status || existente.status || 'ativo'
    };

    repoAtualizarProjeto(found.rowIndex, projetoAtualizado);
    registrarEventoProjeto_('salvamento', 'Conteúdo salvo', {
      id: projetoId,
      projetoId: projetoId,
      nome: projetoAtualizado.nome
    });

    return responseOk({ id: projetoId, projeto: projetoAtualizado }, 'Projeto salvo com sucesso');
  } catch (err) {
    pushLog('ERROR', 'svcSalvarProjeto', { projetoId, error: err.toString() });
    return responseFail('Falha ao salvar projeto', 'Erro ao salvar projeto');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function svcExcluirProjeto(projetoId) {
  const v = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    const ok = repoExcluirProjeto(projetoId);
    if (!ok) return responseFail('Projeto não encontrado ou não pôde ser excluído', 'Não foi possível excluir');
    repoLimparRascunho(projetoId);
    registrarEventoProjeto_('exclusao', 'Projeto excluído', { id: projetoId, projetoId: projetoId });
    return responseOk({ id: projetoId }, 'Projeto excluído com sucesso');
  } catch (err) {
    pushLog('ERROR', 'svcExcluirProjeto', { projetoId, error: err.toString() });
    return responseFail('Falha ao excluir projeto', 'Erro ao excluir projeto');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function svcSalvarRascunho(projetoId, dados) {
  const v = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  try {
    const ok = repoSalvarRascunho(projetoId, dados || {});
    if (!ok) return responseFail('Falha ao salvar rascunho', 'Não foi possível salvar rascunho');
    return responseOk({ id: projetoId }, 'Rascunho salvo');
  } catch (err) {
    pushLog('ERROR', 'svcSalvarRascunho', { projetoId, error: err.toString() });
    return responseFail('Falha ao salvar rascunho', 'Erro ao salvar rascunho');
  }
}

function svcCarregarRascunho(projetoId) {
  const v = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  try {
    const rascunho = repoCarregarRascunho(projetoId);
    // Retorna ok mesmo se null (sem rascunho) p/ não quebrar UX
    return responseOk(rascunho);
  } catch (err) {
    pushLog('ERROR', 'svcCarregarRascunho', { projetoId, error: err.toString() });
    return responseFail('Falha ao carregar rascunho', 'Erro ao carregar rascunho');
  }
}

function svcLimparRascunho(projetoId) {
  const v = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  try {
    repoLimparRascunho(projetoId);
    return responseOk({ id: projetoId }, 'Rascunho limpo');
  } catch (err) {
    pushLog('ERROR', 'svcLimparRascunho', { projetoId, error: err.toString() });
    return responseFail('Falha ao limpar rascunho', 'Erro ao limpar rascunho');
  }
}

function svcResetarProjeto(projetoId, dadosPadrao) {
  const v = validateIdObrigatorio(projetoId, 'ID do projeto');
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const found = repoBuscarProjetoPorId(projetoId);
    if (!found || !found.registro) {
      return responseFail('Projeto não encontrado', 'Projeto não encontrado');
    }

    const existente = found.registro;
    const now = nowISO();
    const dadosPad = dadosPadrao && typeof dadosPadrao === 'object' ? dadosPadrao : {};

    const projetoResetado = {
      id: projetoId,
      nome: existente.nome || 'Projeto',
      descricao: existente.descricao || '',
      dados: deepClone(dadosPad),
      compartilhamentos: Array.isArray(existente.compartilhamentos) ? existente.compartilhamentos : [],
      criadoEm: existente.criadoEm || now,
      atualizadoEm: now,
      proprietario: existente.proprietario || '',
      status: existente.status || 'ativo'
    };

    repoAtualizarProjeto(found.rowIndex, projetoResetado);
    repoLimparRascunho(projetoId);
    registrarEventoProjeto_('reset', 'Projeto resetado', { id: projetoId, projetoId: projetoId });

    return responseOk({ id: projetoId, projeto: projetoResetado }, 'Projeto resetado com sucesso');
  } catch (err) {
    pushLog('ERROR', 'svcResetarProjeto', { projetoId, error: err.toString() });
    return responseFail('Falha ao resetar projeto', 'Erro ao resetar projeto');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function svcCompartilharProjeto(payload) {
  const v = validateCompartilhamento(payload || {});
  if (v.length > 0) return responseFail(v, 'Dados inválidos');

  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    const projetoId = payload.projetoId || payload.id;
    const found = repoBuscarProjetoPorId(projetoId);
    if (!found || !found.registro) {
      return responseFail('Projeto não encontrado', 'Projeto não encontrado');
    }

    const existente = found.registro;
    const compartilhamentos = Array.isArray(existente.compartilhamentos) ? deepClone(existente.compartilhamentos) : [];
    const email = normalizeString(payload.email).toLowerCase();
    const papel = normalizeString(payload.papel || 'leitor').toLowerCase();

    // Evita duplicado
    const idx = compartilhamentos.findIndex(c => {
      const ce = (c.email || '').toString().toLowerCase();
      return ce === email;
    });

    const entry = {
      email: email,
      papel: papel,
      adicionadoEm: nowISO()
    };

    if (idx >= 0) {
      compartilhamentos[idx] = Object.assign({}, compartilhamentos[idx], entry);
    } else {
      compartilhamentos.push(entry);
    }

    const projetoAtualizado = Object.assign({}, existente, {
      compartilhamentos: compartilhamentos,
      atualizadoEm: nowISO()
    });

    repoAtualizarProjeto(found.rowIndex, projetoAtualizado);
    registrarEventoProjeto_('compartilhamento', 'Projeto compartilhado', {
      id: projetoId,
      projetoId: projetoId,
      email: email,
      papel: papel
    });

    return responseOk({ id: projetoId, compartilhamentos }, 'Compartilhamento atualizado');
  } catch (err) {
    pushLog('ERROR', 'svcCompartilharProjeto', { error: err.toString() });
    return responseFail('Falha ao compartilhar projeto', 'Erro ao compartilhar projeto');
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function svcListarLogs(limit) {
  try {
    const mem = getInternalLogs(limit);
    const sheetLogs = repoListarLogs(limit);
    // Prioriza sheet (persistente) + pode mesclar? aqui retorna sheet (limpo)
    const logs = sheetLogs && sheetLogs.length > 0 ? sheetLogs : mem;
    return responseOk(logs);
  } catch (err) {
    return responseFail('Falha ao listar logs', 'Erro ao listar logs');
  }
}

function svcSalvarLogEntry(level, message, meta) {
  try {
    const entry = pushLog(level, message, meta);
    // Persiste em sheet (rotaciona por MAX_ENTRIES)
    repoSalvarLog(entry);
    return responseOk(entry);
  } catch (err) {
    return responseFail('Falha ao salvar log', 'Erro ao salvar log');
  }
}

function svcLimparLogs() {
  try {
    const ok = repoLimparLogs();
    if (!ok) return responseFail('Falha ao limpar logs', 'Não foi possível limpar logs');
    return responseOk(true, 'Logs limpos');
  } catch (err) {
    return responseFail('Falha ao limpar logs', 'Erro ao limpar logs');
  }
}

/**
 * Info diagnóstico
 */
function svcGetDiagnostico() {
  try {
    const props = PropertiesService.getScriptProperties();
    const ssId = props.getProperty('SPREADSHEET_ID') || '';

    let ssInfo = {};
    try {
      const ss = getMainSpreadsheet();
      ssInfo = {
        id: ss.getId(),
        name: ss.getName(),
        url: ss.getUrl()
      };
    } catch (e) {
      ssInfo = { error: e.toString() };
    }

    const diag = {
      timestamp: nowISO(),
      ss: ssInfo,
      scriptPropsSpreadsheetId: ssId ? '(configurado)' : '(não configurado)',
      sheets: [
        APP_CONFIG.SHEETS.PROJETOS,
        APP_CONFIG.SHEETS.DADOS,
        APP_CONFIG.SHEETS.RASCUNHOS,
        APP_CONFIG.SHEETS.LOGS
      ],
      logsCountMem: _internalLogs.length,
      version: 'fase2-modular-v1.0'
    };
    return responseOk(diag);
  } catch (err) {
    return responseFail('Falha ao obter diagnóstico', 'Erro ao obter diagnóstico');
  }
}