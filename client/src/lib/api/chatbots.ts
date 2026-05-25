import { api } from "./client";
import type { Chatbot, ChatbotType, Flow, FlowEdge, FlowNode } from "@/types/domain";

type RawChatbot = {
  id: string;
  organizationId?: string;
  organization_id?: string;
  activeFlowId?: string | null;
  active_flow_id?: string | null;
  name: string;
  description?: string;
  type: ChatbotType;
  isActive?: boolean;
  is_active?: boolean;
  aiConfig?: Chatbot["aiConfig"];
  ai_config?: Chatbot["aiConfig"];
  createdAt?: string;
  created_at?: string;
  updatedAt?: string;
  updated_at?: string;
  metrics?: Chatbot["metrics"];
};

export interface ChatbotsFilter {
  status?: "active" | "inactive";
  type?: ChatbotType;
}

export interface CreateChatbotInput {
  name: string;
  description?: string;
  type: ChatbotType;
}

export interface AIGenerateInput {
  name: string;
  description?: string;
  prompt: string;
}

export interface AIGenerateResult {
  chatbot: Chatbot;
  flow: Flow;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface AIAdjustResult {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function buildQuery(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  const qs = new URLSearchParams(entries as [string, string][]).toString();
  return `?${qs}`;
}

function mapChatbot(row: RawChatbot): Chatbot {
  return {
    id: row.id,
    organizationId: row.organizationId ?? row.organization_id ?? "",
    activeFlowId: row.activeFlowId ?? row.active_flow_id ?? null,
    name: row.name,
    description: row.description ?? "",
    type: row.type,
    isActive: row.isActive ?? row.is_active ?? false,
    aiConfig: row.aiConfig ?? row.ai_config,
    createdAt: row.createdAt ?? row.created_at ?? "",
    updatedAt: row.updatedAt ?? row.updated_at ?? "",
    metrics: row.metrics,
  };
}

export const chatbotsApi = {
  async list(filter: ChatbotsFilter = {}): Promise<Chatbot[]> {
    const rows = await api.get<RawChatbot[]>(`/chatbots${buildQuery({ status: filter.status, type: filter.type })}`);
    return rows.map(mapChatbot);
  },

  async get(id: string): Promise<Chatbot> {
    const row = await api.get<RawChatbot>(`/chatbots/${id}`);
    return mapChatbot(row);
  },

  async create(input: CreateChatbotInput): Promise<Chatbot> {
    const row = await api.post<RawChatbot>("/chatbots", input);
    return mapChatbot(row);
  },

  async update(id: string, input: Partial<Chatbot>): Promise<Chatbot> {
    const row = await api.patch<RawChatbot>(`/chatbots/${id}`, input);
    return mapChatbot(row);
  },

  remove: (id: string) => api.delete<void>(`/chatbots/${id}`),

  async duplicate(id: string): Promise<Chatbot> {
    const row = await api.post<RawChatbot>(`/chatbots/${id}/duplicate`);
    return mapChatbot(row);
  },

  async activate(id: string): Promise<Chatbot> {
    const row = await api.post<RawChatbot>(`/chatbots/${id}/activate`);
    return mapChatbot(row);
  },

  async deactivate(id: string): Promise<Chatbot> {
    const row = await api.post<RawChatbot>(`/chatbots/${id}/deactivate`);
    return mapChatbot(row);
  },

  aiGenerate: (input: AIGenerateInput) => api.post<AIGenerateResult>("/chatbots/ai-generate", input),
  aiAdjust: (id: string, instruction: string) =>
    api.post<AIAdjustResult>(`/chatbots/${id}/ai-adjust`, { instruction }),
};
