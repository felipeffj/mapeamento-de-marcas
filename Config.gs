/**
 * Config.gs
 * Configurações, chaves e constantes da aplicação
 */

const APP_CONFIG = {
  // Nomes das abas da planilha
  SHEETS: {
    PROJETOS: 'Projetos',
    DADOS: 'Dados',
    RASCUNHOS: 'Rascunhos',
    LOGS: 'Logs',
    CONFIG: 'Config'
  },

  // Configurações de logs
  LOGS: {
    MAX_ENTRIES: 30
  },

  // Timeouts/limites
  LIMITS: {
    MAX_NOME_PROJETO: 120,
    MAX_DESCRICAO: 500
  }
};

/**
 * Retorna ID da planilha configurada.
 * Prioriza PropertiesService (ScriptProperties). Se não existir, retorna fallback (hardcode opcional).
 * NOTA: Na Fase 3 vamos migrar 100% para PropertiesService.
 */
function getSpreadsheetId() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SPREADSHEET_ID');
  
  if (id && id.trim() !== '') {
    return id.trim();
  }
  
  // Fallback: manter compatibilidade com implementação atual (se houver)
  // Evite hardcode definitivo aqui. Prefira setar via PropertiesService.
  return '';
}

/**
 * Define o ID da planilha nas Properties (útil p/ Fase 3)
 */
function setSpreadsheetId(spreadsheetId) {
  if (!spreadsheetId) return { ok: false, message: 'Spreadsheet ID é obrigatório' };
  const props = PropertiesService.getScriptProperties();
  props.setProperty('SPREADSHEET_ID', spreadsheetId.trim());
  return { ok: true };
}

/**
 * Obtém a planilha principal da aplicação
 */
function getMainSpreadsheet() {
  const spreadsheetId = getSpreadsheetId();
  
  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (err) {
      throw new Error('Não foi possível abrir a planilha pelo ID configurado. Verifique SPREADSHEET_ID nas Script Properties.');
    }
  }
  
  // Fallback: tenta planilha ativa (compatibilidade com código atual)
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    if (ss) return ss;
  } catch (err) {
    // ignora
  }
  
  throw new Error('Planilha não encontrada. Configure SPREADSHEET_ID em PropertiesService.getScriptProperties() ou tenha uma planilha ativa.');
}