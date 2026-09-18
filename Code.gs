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