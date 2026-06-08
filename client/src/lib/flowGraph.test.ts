import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { removeNodesAndConnectedEdges, sanitizeReactFlowEdges, validateFlowGraph, type RFNodeData } from "./flowGraph";

function node(id: string, domainType: RFNodeData["domainType"], data: RFNodeData["data"] = {}): Node {
  return {
    id,
    type: domainType,
    position: { x: 0, y: 0 },
    data: { domainType, data },
  };
}

function edge(id: string, source: string, target: string): Edge {
  return { id, source, target };
}

describe("flowGraph", () => {
  it("removes edges connected to deleted nodes", () => {
    const graph = removeNodesAndConnectedEdges(
      [node("start", "trigger"), node("message", "message", { text: "Oi" }), node("end", "end")],
      [edge("a", "start", "message"), edge("b", "message", "end")],
      ["message"],
    );

    expect(graph.nodes.map((item) => item.id)).toEqual(["start", "end"]);
    expect(graph.edges).toEqual([]);
  });

  it("detects orphan edges before publish/test", () => {
    const sanitized = sanitizeReactFlowEdges(
      [node("start", "trigger"), node("message", "message", { text: "Oi" })],
      [edge("orphan", "start", "missing")],
    );

    expect(sanitized.edges).toEqual([]);
    expect(sanitized.removedEdges).toHaveLength(1);
    expect(validateFlowGraph([node("start", "trigger")], [edge("orphan", "start", "missing")])).toContain(
      "Existe uma conexão apontando para um bloco que não existe mais. Remova e conecte novamente o fluxo.",
    );
  });

  it("accepts a complete minimal graph", () => {
    const nodes = [
      node("start", "trigger"),
      node("message", "message", { text: "Bem-vindo" }),
      node("end", "end"),
    ];
    const edges = [edge("a", "start", "message"), edge("b", "message", "end")];

    expect(validateFlowGraph(nodes, edges)).toEqual([]);
  });
});
