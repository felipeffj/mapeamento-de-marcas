/**
 * Utils.gs
 * Funções utilitárias genéricas
 */

/**
 * Normaliza string: trim + remove espaços duplicados
 */
function normalizeString(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim().replace(/\s+/g, ' ');
}

/**
 * Verifica se valor está vazio (string, array, objeto)
 */
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/**
 * Gera UUID v4 simples (compatível GAS)
 */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

/**
 * Formata data ISO (YYYY-MM-DDTHH:mm:ss.sssZ) ou local
 */
function toISOStringSafe(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (isNaN(d.getTime())) return new Date().toISOString();
    return d.toISOString();
  } catch (err) {
    return new Date().toISOString();
  }
}

/**
 * Retorna timestamp em ISO
 */
function nowISO() {
  return new Date().toISOString();
}

/**
 * Deep clone seguro (JSON)
 */
function deepClone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj || {}));
  } catch (err) {
    return obj || {};
  }
}

/**
 * Sanitiza objeto removendo campos undefined/null vazios opcionais
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const result = {};
  Object.keys(obj).forEach(key => {
    const val = obj[key];
    if (val !== undefined && val !== null) {
      result[key] = val;
    }
  });
  return result;
}

/**
 * Converte qualquer valor p/ string segura
 */
function safeString(val, fallback = '') {
  if (val === null || val === undefined) return fallback;
  return String(val);
}

/**
 * Tenta fazer parse JSON com fallback
 */
function safeJsonParse(str, fallback = {}) {
  try {
    if (isEmpty(str)) return fallback;
    const parsed = JSON.parse(str);
    return parsed || fallback;
  } catch (err) {
    return fallback;
  }
}

/**
 * Stringifica JSON com fallback
 */
function safeJsonStringify(obj, fallback = '{}') {
  try {
    if (obj === undefined || obj === null) return fallback;
    return JSON.stringify(obj);
  } catch (err) {
    return fallback;
  }
}

/**
 * Logger interno (memória + prepara p/ salvar em Sheet)
 */
const _internalLogs = [];
function pushLog(level, message, meta) {
  const entry = {
    ts: nowISO(),
    level: level || 'INFO',
    message: safeString(message),
    meta: meta || {}
  };
  _internalLogs.push(entry);
  if (_internalLogs.length > 100) {
    _internalLogs.shift();
  }
  return entry;
}

function getInternalLogs(limit) {
  const l = limit || 30;
  return _internalLogs.slice(-l).reverse();
}

function clearInternalLogs() {
  _internalLogs.length = 0;
}

/**
 * Helpers de resposta padronizada (API interna)
 */
function responseOk(data, message) {
  return {
    ok: true,
    data: data === undefined ? null : data,
    errors: [],
    message: message || ''
  };
}

function responseFail(errors, message) {
  const errs = Array.isArray(errors) ? errors : (errors ? [errors] : []);
  return {
    ok: false,
    data: null,
    errors: errs,
    message: message || ''
  };
}