import type { Edge, Node } from "@xyflow/react";
import type { FlowNodeData, FlowNodeType } from "@/types/domain";

export interface RFNodeData extends Record<string, unknown> {
  domainType: FlowNodeType;
  data: FlowNodeData;
}

export interface SanitizedEdges {
  edges: Edge[];
  removedEdges: Edge[];
}

export function removeNodesAndConnectedEdges(
  nodes: Node[],
  edges: Edge[],
  nodeIdsToRemove: Iterable<string>,
): { nodes: Node[]; edges: Edge[]; removedEdges: Edge[] } {
  const deletedIds = new Set(nodeIdsToRemove);
  if (deletedIds.size === 0) return { nodes, edges, removedEdges: [] };

  const nextNodes = nodes.filter((node) => !deletedIds.has(node.id));
  const { edges: nextEdges, removedEdges } = sanitizeReactFlowEdges(
    nextNodes,
    edges.filter((edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target)),
  );

  return { nodes: nextNodes, edges: nextEdges, removedEdges };
}

export function sanitizeReactFlowEdges(nodes: Node[], edges: Edge[]): SanitizedEdges {
  const nodeIds = new Set(nodes.map((node) => node.id).filter(Boolean));
  const nextEdges: Edge[] = [];
  const removedEdges: Edge[] = [];

  for (const edge of edges) {
    if (!edge.source || !edge.target || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      removedEdges.push(edge);
      continue;
    }
    nextEdges.push(edge);
  }

  return { edges: nextEdges, removedEdges };
}

function nodeType(node: Node): FlowNodeType | undefined {
  return (node.data as Partial<RFNodeData> | undefined)?.domainType;
}

function nodeData(node: Node): FlowNodeData {
  return ((node.data as Partial<RFNodeData> | undefined)?.data ?? {}) as FlowNodeData;
}

function nodeLabel(node: Node): string {
  const data = nodeData(node);
  return data.label || nodeType(node) || node.id || "bloco";
}

function unique(errors: string[]): string[] {
  return Array.from(new Set(errors));
}

export function validateFlowGraph(nodes: Node[], edges: Edge[]): string[] {
  const errors: string[] = [];

  if (nodes.length === 0) {
    errors.push("Adicione pelo menos um bloco ao fluxo.");
    return errors;
  }

  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (!node.id) {
      errors.push("Existe um bloco sem identificador. Recrie o bloco antes de publicar.");
      continue;
    }
    if (nodeIds.has(node.id)) {
      errors.push("Existem blocos com identificadores duplicados. Recrie um deles antes de publicar.");
    }
    nodeIds.add(node.id);
  }

  const { edges: validEdges, removedEdges } = sanitizeReactFlowEdges(nodes, edges);
  if (removedEdges.length > 0) {
    errors.push("Existe uma conexão apontando para um bloco que não existe mais. Remova e conecte novamente o fluxo.");
  }

  const triggers = nodes.filter((node) => nodeType(node) === "trigger");
  if (triggers.length === 0) errors.push("Adicione um nó de Início.");
  if (triggers.length > 1) errors.push("Mantenha apenas um nó de Início no fluxo.");

  const outgoingByNode = new Map<string, number>();
  for (const edge of validEdges) {
    outgoingByNode.set(edge.source, (outgoingByNode.get(edge.source) ?? 0) + 1);
  }

  for (const node of nodes) {
    const type = nodeType(node);
    const data = nodeData(node);

    if (!type) {
      errors.push(`Bloco "${node.id}" está sem tipo.`);
      continue;
    }

    if (type !== "end" && (outgoingByNode.get(node.id) ?? 0) === 0) {
      errors.push(`Bloco "${nodeLabel(node)}" não tem saída.`);
    }

    if ((type === "message" || type === "capture") && !String(data.text ?? "").trim()) {
      errors.push(`Bloco "${nodeLabel(node)}" precisa de uma mensagem.`);
    }

    if (type === "capture" && !String(data.variable ?? "").trim()) {
      errors.push(`Bloco "${nodeLabel(node)}" precisa informar a variável de captura.`);
    }

    if (type === "menu") {
      const options = data.options ?? [];
      if (options.length === 0) errors.push(`Menu "${nodeLabel(node)}" precisa de pelo menos uma opção.`);
      if (options.some((option) => !String(option.label ?? "").trim())) {
        errors.push(`Menu "${nodeLabel(node)}" tem opção sem texto.`);
      }
    }

    if (type === "condition") {
      const condition = data.condition;
      if (!condition?.field || !condition?.operator || condition.value === undefined) {
        errors.push(`Condição "${nodeLabel(node)}" está incompleta.`);
      }
    }
  }

  return unique(errors);
}
