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

function getProjetosSheet() {
  const ss = getMainSpreadsheet();
  return _ensureSheet(ss, APP_CONFIG.SHEETS.PROJETOS, [
    'id',
    'nome',
    'descricao',
    'dados',
    'compartilhamentos',
    'criadoEm',
    'atualizadoEm',
    'proprietario',
    'status'
  ]);
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
    'ts',
    'level',
    'message',
    'meta'
  ]);
}

/**
 * Converte linha (objeto via getValues+headers) p/ registro
 */
function _rowToProjeto(row, headers) {
  const obj = {};
  headers.forEach((h, i) => {
    obj[h] = row[i];
  });
  return obj;
}

function repoListarProjetos() {
  try {
    const sheet = getProjetosSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return [];

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    const projetos = values
      .filter(r => r && r[0]) // tem ID
      .map(r => {
        const p = _rowToProjeto(r, headers);
        // Parse JSON
        p.dados = safeJsonParse(p.dados, {});
        p.compartilhamentos = safeJsonParse(p.compartilhamentos, []);
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
    return [];
  }
}

function repoBuscarProjetoPorId(id) {
  if (isEmpty(id)) return null;
  try {
    const sheet = getProjetosSheet();
    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) return null;

    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const values = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();

    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row && String(row[0]) === String(id)) {
        const p = _rowToProjeto(row, headers);
        p.dados = safeJsonParse(p.dados, {});
        p.compartilhamentos = safeJsonParse(p.compartilhamentos, []);
        return { registro: p, rowIndex: i + 2 }; // +header
      }
    }
    return null;
  } catch (err) {
    pushLog('ERROR', 'repoBuscarProjetoPorId falhou', { id, error: err.toString() });
    return null;
  }
}

function repoCriarProjeto(projeto) {
  try {
    const sheet = getProjetosSheet();
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    const now = nowISO();

    const row = [
      projeto.id || generateUUID(),
      normalizeString(projeto.nome || ''),
      projeto.descricao || '',
      safeJsonStringify(projeto.dados || {}),
      safeJsonStringify(projeto.compartilhamentos || []),
      projeto.criadoEm || now,
      projeto.atualizadoEm || now,
      projeto.proprietario || '',
      projeto.status || 'ativo'
    ];

    sheet.appendRow(row);
    return row[0];
  } catch (err) {
    pushLog('ERROR', 'repoCriarProjeto falhou', { error: err.toString() });
    throw err;
  }
}

function repoAtualizarProjeto(rowIndex, projeto) {
  try {
    if (!rowIndex || rowIndex < 2) throw new Error('rowIndex inválido');
    const sheet = getProjetosSheet();
    const now = nowISO();

    sheet.getRange(rowIndex, 2).setValue(normalizeString(projeto.nome || ''));
    sheet.getRange(rowIndex, 3).setValue(projeto.descricao || '');
    sheet.getRange(rowIndex, 4).setValue(safeJsonStringify(projeto.dados || {}));
    sheet.getRange(rowIndex, 5).setValue(safeJsonStringify(projeto.compartilhamentos || []));
    // criadoEm (col6) não altera
    sheet.getRange(rowIndex, 7).setValue(projeto.atualizadoEm || now);
    sheet.getRange(rowIndex, 8).setValue(projeto.proprietario || '');
    sheet.getRange(rowIndex, 9).setValue(projeto.status || 'ativo');
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
    const sheet = getProjetosSheet();
    sheet.deleteRow(found.rowIndex);
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
    sheet.appendRow([
      entry.ts || nowISO(),
      entry.level || 'INFO',
      safeString(entry.message),
      safeJsonStringify(entry.meta || {})
    ]);
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

    const values = sheet.getRange(start, 1, count, 4).getValues();
    const logs = values.map(r => ({
      ts: r[0],
      level: r[1],
      message: r[2],
      meta: safeJsonParse(r[3], {})
    })).reverse();
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