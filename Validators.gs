/**
 * Validators.gs
 * Validações de dados no servidor
 */

function validateProjetoBasico(projeto) {
  const errors = [];

  if (!projeto || typeof projeto !== 'object') {
    errors.push('Dados do projeto inválidos');
    return errors;
  }

  // Nome do projeto
  const nome = normalizeString(projeto.nome || projeto.projectName || '');
  if (isEmpty(nome)) {
    errors.push('Nome do projeto é obrigatório');
  } else if (nome.length > APP_CONFIG.LIMITS.MAX_NOME_PROJETO) {
    errors.push(`Nome do projeto excede ${APP_CONFIG.LIMITS.MAX_NOME_PROJETO} caracteres`);
  }

  // Descrição opcional
  const descricao = projeto.descricao || projeto.description || '';
  if (typeof descricao === 'string' && descricao.length > APP_CONFIG.LIMITS.MAX_DESCRICAO) {
    errors.push(`Descrição excede ${APP_CONFIG.LIMITS.MAX_DESCRICAO} caracteres`);
  }

  // Dados (pode ser objeto/string)
  // Não obriga estrutura rígida aqui (flexível p/ manter compatibilidade com modelo atual)

  return errors;
}

function validateProjetoCompleto(projeto) {
  const errors = validateProjetoBasico(projeto);

  // ID opcional na criação/edição
  const id = projeto.id || projeto.projetoId;
  if (id && typeof id === 'string' && id.length > 100) {
    errors.push('ID do projeto inválido');
  }

  return errors;
}

function validateCompartilhamento(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    errors.push('Dados de compartilhamento inválidos');
    return errors;
  }

  const projetoId = payload.projetoId || payload.id;
  if (isEmpty(projetoId)) {
    errors.push('ID do projeto é obrigatório para compartilhar');
  }

  const email = normalizeString(payload.email || '');
  if (isEmpty(email)) {
    errors.push('E-mail do colaborador é obrigatório');
  } else {
    // Validação básica de e-mail
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      errors.push('E-mail do colaborador inválido');
    }
  }

  const papel = normalizeString(payload.papel || payload.role || 'leitor');
  const papeisValidos = ['proprietario', 'editor', 'leitor'];
  if (!papeisValidos.includes(papel.toLowerCase())) {
    errors.push('Papel inválido. Use: proprietario, editor ou leitor');
  }

  return errors;
}

function validateIdObrigatorio(id, campoNome) {
  const errors = [];
  const nomeCampo = campoNome || 'ID';
  if (isEmpty(id)) {
    errors.push(`${nomeCampo} é obrigatório`);
  }
  return errors;
}