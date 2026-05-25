// Domain types — mirror the JetGO Node API contract (TAKEOFF 3.1).

export type UUID = string;

export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  plan: string;
  settings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "admin" | "operator";

export interface User {
  id: UUID;
  organizationId: UUID;
  name: string;
  email: string;
  role: UserRole;
}

export interface Session {
  user: User;
  organization: Organization;
}

export type ChatbotType = "manual" | "ai_generated" | "ai_agent";

export interface ChatbotAIConfig {
  model: string;
  temperature: number;
  systemPrompt?: string;
  knowledgeBaseId?: UUID;
  fallbackFlowId?: UUID;
}

export interface ChatbotMetrics {
  connections: number;
  totalNodes: number;
  messagesProcessed: number;
}

export interface Chatbot {
  id: UUID;
  organizationId: UUID;
  activeFlowId: UUID | null;
  name: string;
  description?: string;
  type: ChatbotType;
  isActive: boolean;
  aiConfig?: ChatbotAIConfig;
  createdAt: string;
  updatedAt: string;
  metrics?: ChatbotMetrics;
}

export type FlowStatus = "draft" | "published";

export interface Flow {
  id: UUID;
  chatbotId: UUID;
  name: string;
  status: FlowStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export type FlowNodeType =
  | "trigger"
  | "message"
  | "menu"
  | "condition"
  | "wait"
  | "capture"
  | "integration"
  | "end";

export type ConditionOperator = "==" | "!=" | "contains" | ">" | "<";

export interface MenuOption {
  id: string;
  label: string;
  value: string;
}

export interface FlowNodeData {
  label?: string;
  text?: string;
  variable?: string;
  options?: MenuOption[];
  condition?: {
    field: string;
    operator: ConditionOperator;
    value: string;
  };
  waitMs?: number;
  captureField?: "name" | "email" | "phone";
}

export interface FlowNode {
  id: UUID;
  flowId: UUID;
  type: FlowNodeType;
  data: FlowNodeData;
  positionX: number;
  positionY: number;
}

export interface FlowEdge {
  id: UUID;
  flowId: UUID;
  sourceNodeId: UUID;
  targetNodeId: UUID;
  sourceHandle?: string | null;
  conditionType?: string;
  conditionValue?: string;
}

export interface FlowWithGraph extends Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export type WhatsAppStatus = "connected" | "disconnected" | "pending_qr";

export interface WhatsAppConnection {
  id: UUID;
  organizationId: UUID;
  chatbotId: UUID | null;
  name: string;
  phoneNumber: string;
  evolutionInstance?: string;
  status: WhatsAppStatus;
  qrCode?: string;
  qrCodeValue?: string;
  qrExpiresAt?: string;
  lastActivityAt?: string;
  pairingCode?: string;
  createdAt?: string;
  updatedAt?: string;
  metricsToday?: { conversations: number };
}

export interface Contact {
  id: UUID;
  organizationId: UUID;
  phone: string;
  name: string;
  customFields?: Record<string, unknown>;
}

export type ConversationStatus = "open" | "closed" | "waiting" | "resolved";

export interface Conversation {
  id: UUID;
  organizationId: UUID;
  contactId: UUID;
  chatbotId: UUID;
  status: ConversationStatus;
  currentFlowPath?: string;
  createdAt: string;
  closedAt?: string;
  unreadCount: number;
  lastMessagePreview?: string;
}

export interface Message {
  id: UUID;
  conversationId: UUID;
  flowNodeId?: UUID;
  direction: "in" | "out";
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface Ticket {
  id: UUID;
  organizationId: UUID;
  conversationId: UUID;
  assignedTo?: UUID;
  status: "open" | "in_progress" | "closed";
  priority: "low" | "medium" | "high";
}

export interface KnowledgeBase {
  id: UUID;
  organizationId: UUID;
  chatbotId: UUID;
  name: string;
  embeddingModel: string;
  chunkSize: number;
  chunkOverlap: number;
}

export interface KnowledgeDocument {
  id: UUID;
  knowledgeBaseId: UUID;
  title: string;
  content?: string;
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface DashboardSummary {
  openTickets: number;
  deltaTickets: number;
  activeConnections: number;
  deltaConnections: number;
  messagesToday: number;
  deltaMessages: number;
  activeChatbotsPct: number;
  deltaChatbotsPct: number;
}

export interface VolumePoint {
  day: string;
  count: number;
}

export interface RecentActivityItem {
  id: UUID;
  contactPhone: string;
  status: ConversationStatus;
  preview: string;
  createdAt: string;
}
