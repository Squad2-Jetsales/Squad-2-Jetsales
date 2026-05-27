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

        // Se chegou num nó de input com data, processa o input e avança
        if (node.type === 'input' && data != null) {
            await this.executeNode(node, data);
            nextNodeId = this.getNextNodeId(node.id, data);
            if (nextNodeId === node.id) {
                return { responses, context: this.context, nextNodeId };
            }
            node = this.getNode(nextNodeId);
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
        if (!node) throw new Error(`Node with id ${nodeId} not found`);
        return node;
    }

    getNextNodeId(currentNodeId, userInput) {
        const possibleEdges = this.edges.filter(edge => edge.from === currentNodeId);
        for (const edge of possibleEdges) {
            if (this.evaluateCondition(edge.condition, userInput)) return edge.to;
        }
        return currentNodeId;
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
            case 'wait': // delay real entra na Onda 3 (B-06)
                break;
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