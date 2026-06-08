class FlowEngine {
    constructor(flow) {
        this.flow   = flow;
        this.edges  = flow.edges;
        this.states = flow.states;
    }

    async run({ currentNodeId, data, context = {} }) {
        this.context = context;

        let node       = this.getNode(currentNodeId);
        let responses  = [];
        let safety     = 0;
        let nextNodeId = currentNodeId;
        if (!node) {
            return this.finishMissingNode(currentNodeId, responses);
        }

        // Se chegou num nó de input com data, processa o input e avança
        if (node.type === 'input' && data != null) {
            await this.executeNode(node, data);
            nextNodeId = this.getNextNodeId(node.id, data);
            if (nextNodeId === node.id) {
                return { responses, context: this.context, nextNodeId };
            }
            node = this.getNode(nextNodeId);
            if (!node) {
                return this.finishMissingNode(nextNodeId, responses);
            }
        }

        // Avança pelos nós automáticos (message, set, api, etc.)
        // Para quando encontra input (aguarda usuário) ou end (fluxo encerrado)
        while (node.type !== 'input' && node.type !== 'end' && safety < 20) {
            await this.executeNode(node, data);

            const response = this.buildResponse(node);
            if (response.message) responses.push(response);

            nextNodeId = this.getNextNodeId(node.id, data);
            if (nextNodeId === node.id) break; // sem transição válida

            node   = this.getNode(nextNodeId);
            if (!node) {
                return this.finishMissingNode(nextNodeId, responses);
            }
            safety++;
        }

        if (safety === 20) {
            throw new Error('Safety limit reached, possible infinite loop detected');
        }

        // Inclui a mensagem do nó final (input ou end)
        const finalResponse = this.buildResponse(node);
        if (finalResponse.message) responses.push(finalResponse);

        nextNodeId = node.id;

        return { responses, context: this.context, nextNodeId };
    }

    getNode(nodeId) {
        const node = this.states.find(state => state.id === nodeId);
        if (!node) {
            console.warn(`[flow-engine] Node with id ${nodeId} not found; ending flow safely`);
            return null;
        }
        return node;
    }

    finishMissingNode(nodeId, responses) {
        return {
            responses,
            context: this.context,
            nextNodeId: null,
            isComplete: true,
            completed: true,
            reason: 'missing_node',
            missingNodeId: nodeId || null,
        };
    }

    getNextNodeId(currentNodeId, userInput) {
        const currentNode = this.getNode(currentNodeId);
        if (!currentNode) return currentNodeId;
        const possibleEdges = this.edges.filter(edge => edge.from === currentNodeId);

        // Condition node decide pelo source_handle ('true'/'false') desenhado
        // no editor — a condição vive no node (field/operator/value), não na
        // edge. Sem isso o engine seguia sempre pela primeira edge (B-05).
        if (currentNode.type === 'condition') {
            const handle = this.evaluateNodeCondition(currentNode, userInput) ? 'true' : 'false';
            const match = possibleEdges.find(e => e.sourceHandle === handle);
            if (match) return match.to;
            // Fallback: handle sem edge desenhada → primeira disponível ou para
            return possibleEdges[0]?.to || currentNodeId;
        }

        for (const edge of possibleEdges) {
            if (this.evaluateCondition(edge.condition, userInput)) return edge.to;
        }
        return currentNodeId;
    }

    // Avalia a condição declarada no node (Condition). `field` é o nome da
    // variável no contexto (ou 'input' para usar o último input do usuário).
    evaluateNodeCondition(node, userInput) {
        const cond = node.condition;
        if (!cond || !cond.operator) return false;

        const fieldName = cond.field || 'input';
        const rawValue = fieldName === 'input' ? userInput : this.context[fieldName];
        if (rawValue == null) return false;

        const op = String(cond.operator).trim().toLowerCase();
        const a  = String(rawValue).trim().toLowerCase();
        const b  = String(cond.value ?? '').trim().toLowerCase();

        switch (op) {
            case '==':
            case 'equals':     return a === b;
            case '!=':
            case 'not_equals': return a !== b;
            case 'contains':   return a.includes(b);
            case '>':
            case 'gt':         return Number(rawValue) >  Number(cond.value);
            case '<':
            case 'lt':         return Number(rawValue) <  Number(cond.value);
            default:           return a.includes(b);
        }
    }

    evaluateCondition(condition, input) {
        if (!condition) return true;
        if (input == null) return false;
        if (typeof condition === 'function') return condition(input, this.context);
        if (typeof condition === 'string') {
            return String(input).toLowerCase().includes(condition.toLowerCase());
        }
        return false;
    }

    buildResponse(node) {
        let message = node.message || null;
        if (message) {
            message = message.replace(/\{\{(\w+)\}\}/g, (_, key) => {
                return this.context[key.trim()] || `{{${key}}}`;
            });
        }
        return { message, options: node.options || null, delay: node.delay || 0 };
    }

    async executeNode(node, input) {
        if (!node) return;
        switch (node.type) {
            case 'input':
                if (node.variable) this.context[node.variable] = input;
                break;
            case 'message':
            case 'choice':
            case 'trigger':
            case 'condition':
                break;
            case 'wait': {
                // Bloqueia o engine pelo delay configurado, com teto de 60s
                // (decisão de produto da Fase 2 — wait > 60s vira fila
                // assíncrona na Fase 3 pra não segurar o request).
                const ms = Math.min(Number(node.delay) || 0, 60_000);
                if (ms > 0) await new Promise((resolve) => setTimeout(resolve, ms));
                break;
            }
            case 'api':
                if (node.url && node.saveAs) {
                    const res  = await fetch(node.url);
                    const data = await res.json();
                    this.context[node.saveAs] = data;
                }
                break;
            case 'set':
                this.context[node.key] = node.value;
                break;
            default:
                console.warn(`Unknown node type: ${node.type}`);
        }
    }
}

module.exports = { FlowEngine };
