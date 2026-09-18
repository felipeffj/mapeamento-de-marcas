function doGet() {
  var html = HtmlService.createHtmlOutputFromFile('Index')
      .setTitle('Mapeamento de Marcas - V2')
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  
  html.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  
  return html;
}

// Salva o estado completo do projeto no Google Apps Script
function salvarEstadoCompleto(dadosJson) {
  var userProperties = PropertiesService.getUserProperties();
  userProperties.setProperty('RASCUNHO_MAPEAMENTO_COMPLETO', dadosJson);
  return "Projeto salvo automaticamente às " + new Date().toLocaleTimeString();
}

// Carrega o último estado salvo
function carregarEstadoCompleto() {
  var userProperties = PropertiesService.getUserProperties();
  return userProperties.getProperty('RASCUNHO_MAPEAMENTO_COMPLETO') || null;
}

// Limpa o rascunho se o usuário quiser resetar para o modelo original
function resetarParaModeloPadrao() {
  var userProperties = PropertiesService.getUserProperties();
  userProperties.deleteProperty('RASCUNHO_MAPEAMENTO_COMPLETO');
  return true;
}