/**
 * SheetRepository.gs
 * Camada de acesso a dados (Google Planilhas)
 */

function _ensureSheet(ss, sheetName, headers) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (Array.isArray(headers) && headers.length > 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function _ensureDatabaseSheets_() {
  const ss = getMainSpreadsheet();
  const projetos = _ensureSheet(ss, APP_CONFIG.SHEETS.PROJETOS, [
    'ID',
    'Nome',
    'DonoEmail',
    'ColaboradoresJSON',
    'CriadoEm',
    'AtualizadoEm',
    'AtualizadoPorEmail'
  ]);
  const dados = _ensureSheet(ss, APP_CONFIG.SHEETS.DADOS, [
    'ProjetoID',
    'ConteudoBase64'
  ]);
  _ensureSheet(ss, APP_CONFIG.SHEETS.LOGS, [
    'Data/Hora',
    'Usuário',
    'Tipo',
    'ID Projeto',
    'Descrição',
    'Extra (JSON)'
  ]);

  _migrateInlineProjectData_(projetos, dados);
  return { projetos, dados };
}

function _migrateInlineProjectData_(projetosSheet, dadosSheet) {
  const lastColumn = projetosSheet.getLastColumn();
  if (lastColumn < 1 || projetosSheet.getLastRow() < 1) return;

  const headers = projetosSheet.getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(header => safeString(header).trim());
  const headerMap = {};
  headers.forEach((header, index) => {
    headerMap[header.toLowerCase()] = index;
  });

  const idIndex = headerMap.id;
  const nomeIndex = headerMap.nome;
  const dadosIndex = headerMap.dados;
  if (idIndex === undefined || nomeIndex === undefined || dadosIndex === undefined) {
    const expectedHeaders = ['ID', 'Nome', 'DonoEmail', 'ColaboradoresJSON'];
    const compatible = expectedHeaders.every((header, index) =>
      safeString(headers[index]).toLowerCase() === header.toLowerCase()
    );
    if (!compatible) {
      throw new Error(
        'Cabeçalho incompatível na aba Projetos. Esperado o formato com metadados separados da aba Dados.'
      );
    }
    return;
  }

  const lastRow = projetosSheet.getLastRow();
  if (lastRow <= 1) {
    projetosSheet.getRange(1, 1, 1, lastColumn).clearContent();
    projetosSheet.getRange(1, 1, 1, 7).setValues([[
      'ID', 'Nome', 'DonoEmail', 'ColaboradoresJSON',
      'CriadoEm', 'AtualizadoEm', 'AtualizadoPorEmail'
    ]]);
    return;
  }

  const rows = projetosSheet.getRange(2, 1, lastRow - 1, lastColumn).getValues();
  const dadosLastRow = dadosSheet.getLastRow();
  const existingDataIds = new Set(
    dadosLastRow > 1
      ? dadosSheet.getRange(2, 1, dadosLastRow - 1, 1).getValues()
        .map(row => safeString(row[0]))
      : []
  );
  const metadata = [];
  const newProjectData = [];

  rows.forEach(row => {
    const id = safeString(row[idIndex]).trim();
    if (!id) return;

    const inlineData = row[dadosIndex];
    if (inlineData && !existingDataIds.has(id)) {
      const projectData = typeof inlineData === 'string'
        ? safeJsonParse(inlineData, null)
        : inlineData;
      if (projectData === null) {
        throw new Error('Dados JSON inválidos no projeto ' + id + '; migração interrompida sem remover a origem.');
      }
      newProjectData.push([id, _compressProjectData_(projectData)]);
    }

    metadata.push([
      id,
      row[nomeIndex] || '',
      row[headerMap.proprietario] || row[headerMap.owner] || '',
      _normalizeCollaborators_(row[headerMap.compartilhamentos] || row[headerMap.sharedwith]),
      row[headerMap.criadoem] || nowISO(),
      row[headerMap.atualizadoem] || nowISO(),
      row[headerMap.atualizadoporemail] || row[headerMap.atualizadopor] || ''
    ]);
  });

  if (newProjectData.length) {
    dadosSheet.getRange(dadosSheet.getLastRow() + 1, 1, newProjectData.length, 2)
      .setValues(newProjectData);
  }

  projetosSheet.getRange(1, 1, lastRow, lastColumn).clearContent();
  projetosSheet.getRange(1, 1, 1, 7).setValues([[
    'ID', 'Nome', 'DonoEmail', 'ColaboradoresJSON',
    'CriadoEm', 'AtualizadoEm', 'AtualizadoPorEmail'
  ]]);
  if (metadata.length) {
    projetosSheet.getRange(2, 1, metadata.length, 7).setValues(metadata);
  }
}

function _normalizeCollaborators_(value) {
  let parsed = value;
  if (typeof value === 'string') {
    const serialized = value.trim();
    if (!serialized) return '[]';
    try {
      parsed = JSON.parse(serialized);
    } catch (err) {
      throw new Error('ColaboradoresJSON inválido; migração interrompida sem remover a origem.');
    }
  }
  if (!Array.isArray(parsed)) {
    throw new Error('ColaboradoresJSON deve ser uma lista; migração interrompida sem remover a origem.');
  }
  return safeJsonStringify(parsed.map(item => ({
    email: safeString(item && item.email).trim().toLowerCase(),
    papel: ['edicao', 'editor'].includes(
      safeString(item && item.papel).trim().toLowerCase()
    ) ? 'edicao' : 'visualizacao'
  })));
}

function _compressProjectData_(data) {
  const json = typeof data === 'string' ? data : safeJsonStringify(data);
  const gzipBlob = Utilities.gzip(
    Utilities.newBlob(json, 'application/json')
  );
  return Utilities.base64Encode(gzipBlob.getBytes());
}

function _decompressProjectData_(encoded) {
  if (isEmpty(encoded)) return {};
  const bytes = Utilities.base64Decode(String(encoded));
  const json = Utilities.ungzip(
    Utilities.newBlob(bytes, 'application/x-gzip')
  ).getDataAsString();
  return safeJsonParse(json, {});
}

function _readProjectDataMap_(sheet) {
  const lastRow = sheet.getLastRow();
  const result = {};
  if (lastRow <= 1) return result;

  sheet.getRange(2, 1, lastRow - 1, 2).getValues().forEach(row => {
    const id = safeString(row[0]);
    if (id) result[id] = _decompressProjectData_(row[1]);
  });
  return result;
}

function _saveProjectData_(sheet, projectId, data) {
  const id = safeString(projectId);
  const lastRow = sheet.getLastRow();
  const rows = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, 1).getValues()
    : [];
  const rowIndex = rows.findIndex(row => safeString(row[0]) === id);
  const values = [[id, _compressProjectData_(data || {})]];
  if (rowIndex >= 0) {
    sheet.getRange(rowIndex + 2, 1, 1, 2).setValues(values);
  } else {
    sheet.appendRow(values[0]);
  }
}

function getProjetosSheet() {
  return _ensureDatabaseSheets_().projetos;
}

function getDadosSheet() {
  return _ensureDatabaseSheets_().dados;
}

function getRascunhosSheet() {
  const ss = getMainSpreadsheet();
  return _ensureSheet(ss, APP_CONFIG.SHEETS.RASCUNHOS, [
    'id',
    'dados',
    'atualizadoEm'
  ]);
}

function getLogsSheet() {
  const ss = getMainSpreadsheet();
  return _ensureSheet(ss, APP_CONFIG.SHEETS.LOGS, [
    'Data/Hora',
    'Usuário',
    'Tipo',
    'ID Projeto',
    'Descrição',
    'Extra (JSON)'
  ]);
}

/**
 * Converte linha (objeto via getValues+headers) p/ registro
 */
function _rowToProjeto(row, headers) {
  const source = {};
  headers.forEach((h, i) => {
    source[safeString(h).trim().toLowerCase()] = row[i];
  });
  const id = source.id;
  const compartilhamentos = source.colaboradoresjson !== undefined
    ? source.colaboradoresjson
    : source.compartilhamentos;
  return {
    id: id,
    nome: source.nome || '',
    descricao: source.descricao || '',
    dados: {},
    compartilhamentos: safeJsonParse(compartilhamentos, []),
    criadoEm: source.criadoem || '',
    atualizadoEm: source.atualizadoem || '',
    proprietario: source.donoemail || source.proprietario || source.owner || '',
    atualizadoPor: source.atualizadoporemail || source.atualizadopor || '',
    status: source.status || 'ativo'
  };
}

function repoListarProjetos() {
  try {
    const sheets = _ensureDatabaseSheets_();
    const sheet = sheets.projetos;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    const projectData = _readProjectDataMap_(sheets.dados);

    const projetos = values
      .filter(r => r && r[0]) // tem ID
      .map(r => {
        const p = _rowToProjeto(r, headers);
        p.dados = projectData[safeString(p.id)] || {};
        return p;
      })
      .sort((a, b) => {
        const ta = new Date(a.atualizadoEm || a.criadoEm || 0).getTime();
        const tb = new Date(b.atualizadoEm || b.criadoEm || 0).getTime();
        return tb - ta;
      });

    return projetos;
  } catch (err) {
    pushLog('ERROR', 'repoListarProjetos falhou', { error: err.toString() });
    throw err;
  }
}

function repoBuscarProjetoPorId(id) {
  if (isEmpty(id)) return null;
  try {
    const sheets = _ensureDatabaseSheets_();
    const sheet = sheets.projetos;
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row && String(row[0]) === String(id)) {
        const p = _rowToProjeto(row, headers);
        p.dados = _readProjectDataMap_(sheets.dados)[safeString(p.id)] || {};
        return { registro: p, rowIndex: i + 2 }; // +header
      }
    }
    return null;
  } catch (err) {
    pushLog('ERROR', 'repoBuscarProjetoPorId falhou', { id, error: err.toString() });
    throw err;
  }
}

function repoCriarProjeto(projeto) {
  try {
    const sheets = _ensureDatabaseSheets_();
    const now = nowISO();
    const id = projeto.id || generateUUID();
    const metadataRow = [
      id,
      normalizeString(projeto.nome || ''),
      projeto.proprietario || '',
      safeJsonStringify(projeto.compartilhamentos || []),
      projeto.criadoEm || now,
      projeto.atualizadoEm || now,
      projeto.atualizadoPor || ''
    ];

    _saveProjectData_(sheets.dados, id, projeto.dados || {});
    sheets.projetos.appendRow(metadataRow);
    return id;
  } catch (err) {
    pushLog('ERROR', 'repoCriarProjeto falhou', { error: err.toString() });
    throw err;
  }
}

function repoAtualizarProjeto(rowIndex, projeto) {
  try {
    if (!rowIndex || rowIndex < 2) throw new Error('rowIndex inválido');
    const sheets = _ensureDatabaseSheets_();
    const now = nowISO();

    _saveProjectData_(sheets.dados, projeto.id, projeto.dados || {});
    sheets.projetos.getRange(rowIndex, 2, 1, 6).setValues([[
      normalizeString(projeto.nome || ''),
      projeto.proprietario || '',
      safeJsonStringify(projeto.compartilhamentos || []),
      projeto.criadoEm || now,
      projeto.atualizadoEm || now,
      projeto.atualizadoPor || ''
    ]]);
    return true;
  } catch (err) {
    pushLog('ERROR', 'repoAtualizarProjeto falhou', { rowIndex, error: err.toString() });
    throw err;
  }
}

function repoExcluirProjeto(id) {
  try {
    const found = repoBuscarProjetoPorId(id);
    if (!found || !found.rowIndex) return false;
    const sheets = _ensureDatabaseSheets_();
    const lastRow = sheets.dados.getLastRow();
    if (lastRow > 1) {
      const ids = sheets.dados.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (safeString(ids[i][0]) === safeString(id)) {
          sheets.dados.deleteRow(i + 2);
        }
      }
    }
    sheets.projetos.deleteRow(found.rowIndex);
    return true;
  } catch (err) {
    pushLog('ERROR', 'repoExcluirProjeto falhou', { id, error: err.toString() });
    return false;
  }
}

/**
 * Rascunho (draft) por projetoId
 */
function repoSalvarRascunho(projetoId, dados) {
  if (isEmpty(projetoId)) return false;
  try {
    const sheet = getRascunhosSheet();
    const lastRow = sheet.getLastRow();
    const now = nowISO();

    if (lastRow > 1) {
      const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (ids[i][0] && String(ids[i][0]) === String(projetoId)) {
          const rowIdx = i + 2;
          sheet.getRange(rowIdx, 2).setValue(safeJsonStringify(dados || {}));
          sheet.getRange(rowIdx, 3).setValue(now);
          return true;
        }
      }
    }
    // Não encontrou, append
    sheet.appendRow([projetoId, safeJsonStringify(dados || {}), now]);
    return true;
  } catch (err) {
    pushLog('ERROR', 'repoSalvarRascunho falhou', { projetoId, error: err.toString() });
    return false;
  }
}

function repoCarregarRascunho(projetoId) {
  if (isEmpty(projetoId)) return null;
  try {
    const sheet = getRascunhosSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;

    const values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row && String(row[0]) === String(projetoId)) {
        return safeJsonParse(row[1], null);
      }
    }
    return null;
  } catch (err) {
    pushLog('ERROR', 'repoCarregarRascunho falhou', { projetoId, error: err.toString() });
    return null;
  }
}

function repoLimparRascunho(projetoId) {
  if (isEmpty(projetoId)) return false;
  try {
    const sheet = getRascunhosSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return false;

    const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (let i = 0; i < ids.length; i++) {
      if (ids[i][0] && String(ids[i][0]) === String(projetoId)) {
        sheet.deleteRow(i + 2);
        return true;
      }
    }
    return false;
  } catch (err) {
    pushLog('ERROR', 'repoLimparRascunho falhou', { projetoId, error: err.toString() });
    return false;
  }
}

/**
 * Logs
 */
function repoSalvarLog(entry) {
  try {
    const sheet = getLogsSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(header => safeString(header).trim().toLowerCase());
    const row = headers.map(header => {
      if (header === 'data/hora' || header === 'ts') return entry.ts || nowISO();
      if (header === 'usuário' || header === 'usuario') {
        try { return Session.getActiveUser().getEmail() || ''; } catch (err) { return ''; }
      }
      if (header === 'tipo' || header === 'level') return entry.level || 'INFO';
      if (header === 'id projeto') return entry.meta && entry.meta.projetoId || '';
      if (header === 'descrição' || header === 'descricao' || header === 'message') {
        return safeString(entry.message);
      }
      if (header === 'extra (json)' || header === 'meta') {
        return safeJsonStringify(entry.meta || {});
      }
      return '';
    });
    sheet.appendRow(row);
    // Mantém últimos MAX_ENTRIES (opcional: limpa excesso)
    const lastRow = sheet.getLastRow();
    const max = APP_CONFIG.LOGS.MAX_ENTRIES;
    if (lastRow > max + 1) {
      const excess = lastRow - (max + 1);
      sheet.deleteRows(2, excess);
    }
    return true;
  } catch (err) {
    // Não propaga erro de log
    return false;
  }
}

function repoListarLogs(limit) {
  try {
    const sheet = getLogsSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    const l = limit || APP_CONFIG.LOGS.MAX_ENTRIES;
    const start = Math.max(2, lastRow - l + 1);
    const count = lastRow - start + 1;
    if (count <= 0) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(header => safeString(header).trim().toLowerCase());
    const values = sheet.getRange(start, 1, count, sheet.getLastColumn()).getValues();
    const logs = values.map(row => {
      const valueFor = aliases => {
        const index = headers.findIndex(header => aliases.includes(header));
        return index < 0 ? '' : row[index];
      };
      const metaValue = valueFor(['extra (json)', 'meta']);
      return {
        ts: valueFor(['data/hora', 'ts']),
        level: valueFor(['tipo', 'level']) || 'INFO',
        message: valueFor(['descrição', 'descricao', 'message']),
        meta: safeJsonParse(metaValue, {})
      };
    }).reverse();
    return logs;
  } catch (err) {
    return [];
  }
}

function repoLimparLogs() {
  try {
    const sheet = getLogsSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
    clearInternalLogs();
    return true;
  } catch (err) {
    return false;
  }
}