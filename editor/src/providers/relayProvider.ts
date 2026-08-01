import type { RelayUsage } from "./types";

export interface RelayProviderRequestMeta {
  relay_endpoint?: string;
  signed_request_placeholder?: string;
}

export function createRelayUsage(provider: string, model: string): RelayUsage {
  return {
    request_id: `relay_${crypto.randomUUID()}`,
    provider,
    model,
    input_units: 0,
    output_units: 0,
    estimated_cost: undefined,
    created_at: new Date().toISOString(),
  };
}
