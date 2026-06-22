const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });

const db = require('../server/src/database');
const { sanitizeFlowGraph } = require('../server/src/modules/flow/flow.graph');
const { ensureActiveFlowForChatbot } = require('../server/src/modules/chatbot/active-flow.helper');

function isProductionLike() {
  return process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
}

async function sanitizeFlows(trx) {
  const flows = await trx('flows').select('id');
  let flowsCorrected = 0;
  let edgesRemoved = 0;

  for (const flow of flows) {
    const [states, edges] = await Promise.all([
      trx('flow_nodes').where({ flow_id: flow.id }),
      trx('flow_edges').where({ flow_id: flow.id }),
    ]);

    const sanitized = sanitizeFlowGraph({ states, edges });
    const edgeIdsToRemove = sanitized.removedEdges
      .map((item) => item.edge?.id)
      .filter(Boolean);

    if (edgeIdsToRemove.length > 0) {
      await trx('flow_edges').whereIn('id', edgeIdsToRemove).del();
      flowsCorrected += 1;
      edgesRemoved += edgeIdsToRemove.length;
    }
  }

  return {
    flowsAnalyzed: flows.length,
    flowsCorrected,
    edgesRemoved,
  };
}

async function backfillActiveFlows(trx) {
  const chatbots = await trx('chatbots').whereNull('active_flow_id');
  let corrected = 0;

  for (const chatbot of chatbots) {
    const updated = await ensureActiveFlowForChatbot(trx, chatbot);
    if (updated?.active_flow_id) corrected += 1;
  }

  return {
    chatbotsAnalyzed: chatbots.length,
    chatbotsCorrected: corrected,
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (isProductionLike() && !args.has('--yes-production')) {
    console.error('Refusing to modify production-like database without --yes-production.');
    process.exitCode = 2;
    return;
  }

  const report = await db.transaction(async (trx) => {
    const flowReport = await sanitizeFlows(trx);
    const chatbotReport = await backfillActiveFlows(trx);
    return { ...flowReport, ...chatbotReport };
  });

  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.destroy();
  });
