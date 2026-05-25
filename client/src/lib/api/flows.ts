import { api } from "./client";
import type { Flow, FlowEdge, FlowNode, FlowNodeType, FlowWithGraph } from "@/types/domain";

type BackendEnvelope<T> = {
  success?: boolean;
  data?: T;
  count?: number;
};

type RawFlow = {
  id: string;
  chatbotId?: string;
  chatbot_id?: string;
  name: string;
  status: Flow["status"];
  version: number;
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  nodes?: RawFlowNode[];
  states?: RawFlowNode[];
  edges?: RawFlowEdge[];
};

type RawFlowNode = {
  id: string;
  flowId?: string;
  flow_id?: string;
  type: FlowNodeType;
  data?: Record<string, unknown>;
  label?: string;
  message?: string;
  variable?: string;
  options?: unknown[];
  condition?: FlowNode["data"]["condition"];
  delay?: number;
  positionX?: number;
  position_x?: number;
  positionY?: number;
  position_y?: number;
};

type RawFlowEdge = {
  id: string;
  flowId?: string;
  flow_id?: string;
  sourceNodeId?: string;
  source_node_id?: string;
  targetNodeId?: string;
  target_node_id?: string;
  sourceHandle?: string | null;
  source_handle?: string | null;
  conditionType?: string;
  condition_type?: string;
  conditionValue?: string;
  condition_value?: string;
  condition?: {
    operator?: string;
    value?: string;
  } | null;
};

type FlowSessionResponse = {
  sessionId: string;
  responses: Array<{ message?: string | null; options?: unknown; delay?: number }>;
  context?: Record<string, unknown>;
  isComplete?: boolean;
};

export interface CreateFlowNodeInput {
  flowId: string;
  type: FlowNodeType;
  data: FlowNode["data"];
  positionX: number;
  positionY: number;
}

export interface CreateFlowEdgeInput {
  flowId: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string | null;
  conditionType?: string;
  conditionValue?: string;
}

function unwrap<T>(payload: T | BackendEnvelope<T>): T {
  if (payload && typeof payload === "object" && "data" in (payload as Record<string, unknown>)) {
    return (payload as BackendEnvelope<T>).data as T;
  }
  return payload as T;
}

function mapFlowNode(row: RawFlowNode): FlowNode {
  const data = row.data ?? {};

  return {
    id: row.id,
    flowId: row.flowId ?? row.flow_id ?? "",
    type: row.type,
    data: {
      label: (data.label as string | undefined) ?? row.label,
      text: (data.text as string | undefined) ?? (data.message as string | undefined) ?? row.message,
      variable: (data.variable as string | undefined) ?? row.variable,
      options: (data.options as FlowNode["data"]["options"] | undefined) ?? (row.options as FlowNode["data"]["options"] | undefined),
      condition:
        (data.condition as FlowNode["data"]["condition"] | undefined) ??
        row.condition ??
        undefined,
      waitMs:
        typeof data.waitMs === "number"
          ? data.waitMs
          : typeof data.delay === "number"
            ? data.delay
            : typeof row.delay === "number"
              ? row.delay
              : undefined,
      captureField: data.captureField as FlowNode["data"]["captureField"] | undefined,
    },
    positionX: Number(row.positionX ?? row.position_x ?? 0),
    positionY: Number(row.positionY ?? row.position_y ?? 0),
  };
}

function mapFlowEdge(row: RawFlowEdge): FlowEdge {
  return {
    id: row.id,
    flowId: row.flowId ?? row.flow_id ?? "",
    sourceNodeId: row.sourceNodeId ?? row.source_node_id ?? "",
    targetNodeId: row.targetNodeId ?? row.target_node_id ?? "",
    sourceHandle: row.sourceHandle ?? row.source_handle ?? null,
    conditionType: row.conditionType ?? row.condition_type ?? row.condition?.operator ?? undefined,
    conditionValue: row.conditionValue ?? row.condition_value ?? row.condition?.value ?? undefined,
  };
}

function mapFlow(row: RawFlow): Flow {
  return {
    id: row.id,
    chatbotId: row.chatbotId ?? row.chatbot_id ?? "",
    name: row.name,
    status: row.status,
    version: Number(row.version ?? 1),
    createdAt: row.createdAt ?? row.created_at ?? "",
    updatedAt: row.updatedAt ?? row.updated_at ?? "",
  };
}

function mapFlowWithGraph(row: RawFlow): FlowWithGraph {
  const nodes = (row.nodes ?? row.states ?? []).map(mapFlowNode);
  const edges = (row.edges ?? []).map(mapFlowEdge);
  return {
    ...mapFlow(row),
    nodes,
    edges,
  };
}

function toBackendState(node: FlowNode) {
  return {
    id: node.id,
    label: node.data.label ?? node.id,
    type: node.type,
    message: node.data.text ?? null,
    variable: node.data.variable ?? null,
    options: node.data.options ?? null,
    condition: node.data.condition ?? null,
    delay: node.data.waitMs ?? 0,
    position_x: node.positionX,
    position_y: node.positionY,
  };
}

function toBackendEdge(edge: FlowEdge) {
  const condition =
    edge.conditionType && edge.conditionValue !== undefined
      ? { operator: edge.conditionType, value: edge.conditionValue }
      : null;

  return {
    from: edge.sourceNodeId,
    to: edge.targetNodeId,
    source_handle: edge.sourceHandle ?? null,
    condition,
    condition_type: edge.conditionType ?? null,
    condition_value: edge.conditionValue ?? null,
  };
}

export const flowsApi = {
  async get(id: string): Promise<FlowWithGraph> {
    const payload = await api.get<RawFlow | BackendEnvelope<RawFlow>>(`/flows/${id}`);
    return mapFlowWithGraph(unwrap(payload));
  },

  async update(id: string, input: Partial<Pick<Flow, "name" | "status">>): Promise<Flow> {
    const payload = await api.patch<RawFlow | BackendEnvelope<RawFlow>>(`/flows/${id}`, input);
    return mapFlow(unwrap(payload));
  },

  async publish(id: string): Promise<Flow> {
    const payload = await api.post<RawFlow | BackendEnvelope<RawFlow>>(`/flows/${id}/publish`);
    return mapFlow(unwrap(payload));
  },

  async bulkUpdate(id: string, payload: { nodes: FlowNode[]; edges: FlowEdge[] }): Promise<{ ok: true }> {
    await api.put(`/flows/${id}/graph`, {
      states: payload.nodes.map(toBackendState),
      edges: payload.edges.map(toBackendEdge),
    });
    return { ok: true };
  },

  createNode: (input: CreateFlowNodeInput) => api.post<FlowNode>("/flow-nodes", input),
  updateNode: (id: string, input: Partial<FlowNode>) => api.patch<FlowNode>(`/flow-nodes/${id}`, input),
  deleteNode: (id: string) => api.delete<void>(`/flow-nodes/${id}`),
  createEdge: (input: CreateFlowEdgeInput) => api.post<FlowEdge>("/flow-edges", input),
  deleteEdge: (id: string) => api.delete<void>(`/flow-edges/${id}`),

  async startSession(flowId: string, userId = "preview-user"): Promise<FlowSessionResponse> {
    const payload = await api.post<FlowSessionResponse | BackendEnvelope<FlowSessionResponse>>(
      `/flows/${flowId}/sessions`,
      { userId },
    );
    return unwrap(payload);
  },

  async processInput(sessionId: string, input: string): Promise<FlowSessionResponse> {
    const payload = await api.post<FlowSessionResponse | BackendEnvelope<FlowSessionResponse>>(
      `/flows/sessions/${sessionId}/input`,
      { input },
    );
    return unwrap(payload);
  },

  async endSession(sessionId: string): Promise<void> {
    await api.post(`/flows/sessions/${sessionId}/end`);
  },
};
