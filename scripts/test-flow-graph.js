const assert = require('assert');

const { FlowEngine } = require('../server/src/modules/flow/flow.engine');
const { sanitizeFlowGraph, validateFlowGraph } = require('../server/src/modules/flow/flow.graph');

async function run() {
  const invalidGraph = {
    states: [{ id: 'node-a', type: 'message', message: 'Oi' }],
    edges: [{ id: 'edge-a-b', from: 'node-a', to: 'node-b-missing' }],
  };

  const sanitized = sanitizeFlowGraph(invalidGraph);
  assert.strictEqual(sanitized.edges.length, 0, 'sanitizeFlowGraph removes orphan edges');
  assert.strictEqual(sanitized.removedEdges.length, 1, 'sanitizeFlowGraph reports removed edges');

  const invalidPublish = validateFlowGraph(
    { name: 'Fluxo quebrado', ...invalidGraph },
    { requireTrigger: true, requireOutgoing: true, validateContent: true },
  );
  assert.strictEqual(invalidPublish.valid, false, 'publish validation rejects invalid graph');

  const orphanEngine = new FlowEngine(invalidGraph);
  const orphanResult = await orphanEngine.run({ currentNodeId: 'node-a', data: null, context: {} });
  assert.strictEqual(orphanResult.reason, 'missing_node', 'engine ends safely on missing destination');
  assert.strictEqual(orphanResult.responses[0].message, 'Oi', 'engine keeps responses produced before missing node');

  const validEngine = new FlowEngine({
    states: [
      { id: 'start', type: 'trigger' },
      { id: 'message', type: 'message', message: 'Bem-vindo' },
      { id: 'end', type: 'end' },
    ],
    edges: [
      { from: 'start', to: 'message' },
      { from: 'message', to: 'end' },
    ],
  });
  const validResult = await validEngine.run({ currentNodeId: 'start', data: null, context: {} });
  assert.deepStrictEqual(
    validResult.responses.map((item) => item.message),
    ['Bem-vindo'],
    'valid graph executes normally',
  );
  assert.strictEqual(validResult.nextNodeId, 'end', 'valid graph finishes at end node');

  console.log('flow graph tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
