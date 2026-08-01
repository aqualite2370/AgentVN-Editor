import type { ProviderSelectionPayload } from "../api/types";

export interface AssistantDocChunk {
  id: string;
  source: string;
  title: string;
  tags: readonly string[];
  text: string;
}

export interface AssistantChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AssistantChatRequest {
  question: string;
  context_chunks: AssistantDocChunk[];
  messages: AssistantChatMessage[];
  editor_context?: string;
  provider_selection?: ProviderSelectionPayload;
}

export interface AssistantCitation {
  id: string;
  source: string;
  title: string;
}

export interface AssistantChatResponse {
  answer: string;
  citations: AssistantCitation[];
}
