function asId(value) {
  if (value === undefined || value === null) return '';
  return String(value).trim();
}

function getStateId(state) {
  return asId(state?.id);
}

function getStateLabel(state) {
  return asId(state?.data?.label || state?.label || state?.id);
}

function getStateMessage(state) {
  return asId(state?.message ?? state?.data?.message ?? state?.data?.text);
}

function getEdgeSource(edge) {
  return asId(edge?.from ?? edge?.source ?? edge?.sourceNodeId ?? edge?.source_node_id);
}

function getEdgeTarget(edge) {
  return asId(edge?.to ?? edge?.target ?? edge?.targetNodeId ?? edge?.target_node_id);
}

function getStateRefs(states) {
  const refs = new Set();
  const ids = new Set();
  const labels = new Set();

  for (const state of states) {
    const id = getStateId(state);
    const label = getStateLabel(state);
    if (id) {
      refs.add(id);
      ids.add(id);
    }
    if (label) {
      refs.add(label);
      labels.add(label);
    }
  }

  return { refs, ids, labels };
}

function sanitizeFlowGraph({ states = [], edges = [] } = {}) {
  const stateRows = Array.isArray(states) ? states : [];
  const edgeRows = Array.isArray(edges) ? edges : [];
  const sanitizedStates = [];
  const removedStates = [];

  for (const state of stateRows) {
    if (getStateId(state)) {
      sanitizedStates.push(state);
    } else {
      removedStates.push(state);
    }
  }

  const { refs } = getStateRefs(sanitizedStates);
  const sanitizedEdges = [];
  const removedEdges = [];

  for (const edge of edgeRows) {
    const source = getEdgeSource(edge);
    const target = getEdgeTarget(edge);
    const reason =
      !source || !target
        ? 'missing_endpoint'
        : !refs.has(source) || !refs.has(target)
          ? 'missing_node'
          : null;

    if (reason) {
      removedEdges.push({ edge, source, target, reason });
    } else {
      sanitizedEdges.push(edge);
    }
  }

  return {
    states: sanitizedStates,
    edges: sanitizedEdges,
    removedStates,
    removedEdges,
    warnings: buildSanitizeWarnings(removedStates, removedEdges),
  };
}

function buildSanitizeWarnings(removedStates, removedEdges) {
  const warnings = [];
  if (removedStates.length > 0) {
    warnings.push(`${removedStates.length} node(s) sem id foram ignorados.`);
  }
  if (removedEdges.length > 0) {
    warnings.push(`${removedEdges.length} edge(s) orfas foram removidas.`);
  }
  return warnings;
}

function validateFlowGraph(flowData = {}, options = {}) {
  const {
    requireName = true,
    requireTrigger = false,
    requireOutgoing = false,
    validateContent = false,
  } = options;

  const errors = [];
  const states = Array.isArray(flowData.states) ? flowData.states : [];
  const edges = Array.isArray(flowData.edges) ? flowData.edges : [];

  if (requireName && (!flowData.name || String(flowData.name).trim() === '')) {
    errors.push('Nome do fluxo e obrigatorio');
  }
  if (!Array.isArray(flowData.states)) errors.push('States deve ser um array');
  if (!Array.isArray(flowData.edges)) errors.push('Edges deve ser um array');
  if (states.length === 0) errors.push('Fluxo deve ter pelo menos um estado');

  const ids = new Set();
  for (const state of states) {
    const id = getStateId(state);
    if (!id) {
      errors.push('Fluxo contem node sem id');
      continue;
    }
    if (ids.has(id)) errors.push(`Node duplicado: ${id}`);
    ids.add(id);
  }

  const sanitized = sanitizeFlowGraph({ states, edges });
  if (sanitized.removedEdges.length > 0) {
    errors.push('Existe uma conexao apontando para um bloco que nao existe mais.');
  }

  if (requireTrigger) {
    const triggers = states.filter((state) => state.type === 'trigger');
    if (triggers.length === 0) errors.push('Fluxo deve ter um node de inicio');
    if (triggers.length > 1) errors.push('Fluxo deve ter apenas um node de inicio');
  }

  if (requireOutgoing) {
    const outgoing = new Set(sanitized.edges.map((edge) => getEdgeSource(edge)));
    for (const state of states) {
      const type = state.type;
      const label = getStateLabel(state) || getStateId(state);
      if (type !== 'end' && !outgoing.has(getStateId(state)) && !outgoing.has(label)) {
        errors.push(`Bloco "${label}" nao tem saida.`);
      }
    }
  }

  if (validateContent) {
    for (const state of states) {
      const label = getStateLabel(state) || getStateId(state);
      if (['message', 'capture'].includes(state.type) && !getStateMessage(state)) {
        errors.push(`Bloco "${label}" precisa de uma mensagem.`);
      }
      if (state.type === 'capture' && !asId(state.variable ?? state.data?.variable)) {
        errors.push(`Bloco "${label}" precisa informar a variavel de captura.`);
      }
      if (state.type === 'menu') {
        const options = state.options ?? state.data?.options ?? [];
        if (!Array.isArray(options) || options.length === 0) {
          errors.push(`Menu "${label}" precisa de pelo menos uma opcao.`);
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors: Array.from(new Set(errors)),
    sanitized,
  };
}

module.exports = {
  asId,
  getEdgeSource,
  getEdgeTarget,
  getStateId,
  getStateLabel,
  getStateRefs,
  sanitizeFlowGraph,
  validateFlowGraph,
};
