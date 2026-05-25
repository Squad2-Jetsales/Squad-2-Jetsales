import { api } from "./client";
import type { Contact, Conversation, Message, Ticket } from "@/types/domain";

export type ConversationFilter = "open" | "closed" | "all";

export interface ConversationWithContact extends Conversation {
  contact: Contact;
}

export interface ConversationDetail extends ConversationWithContact {
  messages: Message[];
}

export interface MessagesPage {
  messages: Message[];
  nextCursor: string | null;
}

function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries as [string, string][]).toString()}`;
}

export const ticketsApi = {
  listTickets: (params: { status?: "open" | "closed"; search?: string } = {}) =>
    api.get<Ticket[]>(`/tickets${qs(params)}`),
  listConversations: (status: ConversationFilter = "all") =>
    api.get<ConversationWithContact[]>(
      `/conversations${qs({ status: status === "all" ? undefined : status })}`,
    ),
  getConversation: (id: string) =>
    api.get<ConversationDetail>(`/conversations/${id}`),
  listMessages: (id: string, cursor?: string, limit = 50) =>
    api.get<MessagesPage>(
      `/conversations/${id}/messages${qs({ cursor, limit: String(limit) })}`,
    ),
  sendMessage: (id: string, content: string) =>
    api.post<Message>(`/conversations/${id}/messages`, { content }),
  closeConversation: (id: string) =>
    api.post<Conversation>(`/conversations/${id}/close`),
  takeover: (id: string) =>
    api.post<Conversation>(`/conversations/${id}/takeover`),
};
