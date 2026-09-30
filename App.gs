/**
 * App.gs
 * Ponto de entrada da aplicação (Web App)
 */

function doGet(e) {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Modelos de Mapeamento de Marcas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL); // Seguro p/ standalone
}

/**
 * Helper para incluir partials HTML (Styles.html / Scripts.html)
 * Usado no template: <?!= include('Styles') ?>
 */
function include(filename) {
  if (isEmpty(filename)) return '';
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    pushLog('ERROR', 'include falhou', { filename, error: err.toString() });
    return '';
  }
}