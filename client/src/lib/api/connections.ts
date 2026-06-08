import { api } from "./client";
import type { WhatsAppConnection } from "@/types/domain";

export interface CreateConnectionInput {
  name: string;
  chatbotId?: string;
  instanceName?: string;
}

export interface EvolutionStatusResponse {
  configured: boolean;
  baseUrl: string;
  webhookUrl?: string | null;
  info?: {
    status?: number;
    message?: string;
    version?: string;
    swagger?: string;
    manager?: string;
    documentation?: string;
  };
  defaultInstance?: {
    instanceName: string;
    status?: string;
    phoneNumber?: string;
    error?: string;
  } | null;
}

export interface SendTestMessageInput {
  connectionId?: string;
  instanceName?: string;
  number: string;
  text: string;
}

export interface SendTestMessageResult {
  instanceName: string;
  number: string;
  status: string | null;
  messageId: string | null;
}

export const connectionsApi = {
  list: () => api.get<WhatsAppConnection[]>("/whatsapp-connections"),
  get: (id: string) => api.get<WhatsAppConnection>(`/whatsapp-connections/${id}`),
  create: (input: CreateConnectionInput) =>
    api.post<WhatsAppConnection>("/whatsapp-connections", input),
  getStatus: () => api.get<EvolutionStatusResponse>("/whatsapp-connections/status"),
  sendTest: (input: SendTestMessageInput) =>
    api.post<SendTestMessageResult>("/whatsapp-connections/send-test", input),
  refreshQr: (id: string) =>
    api.post<WhatsAppConnection>(`/whatsapp-connections/${id}/refresh-qr`),
  remove: (id: string) => api.delete<void>(`/whatsapp-connections/${id}`),
};
