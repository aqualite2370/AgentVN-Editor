# Provider System

The editor uses Provider abstractions instead of calling vendor APIs inside React components.

Implemented abstractions:

- `LLMProvider`
- `ImageProvider`
- `VisionProvider` reserved
- `AudioProvider` reserved
- `RelayProvider` reserved

Current build ships mock providers for prompt rewrite and image generation. Real OpenAI-compatible, Gemini, local, or relay providers can implement the same interfaces.

User API keys are never exported to `script.json` or `.vncart`.

## Backend Route Contract

Provider backend routes are action endpoints under the `/api/providers` namespace. `/api/providers` itself is not a list or configuration endpoint and should not be used for health checks or discovery.

Use these routes:

| Purpose | Method | Route | Caller |
| --- | --- | --- | --- |
| Test a provider connection and discover models | `POST` | `/api/providers/test_connection` | `backendClient.testProviderConnection` |
| Compatibility alias for connection test | `POST` | `/api/providers/test-connection` | External/manual callers only |
| Test a short model generation | `POST` | `/api/providers/test_generation` | `backendClient.testProviderGeneration` |

The editor persists provider connections, models, selections, and local API-key references through `/api/project/state`, not through `/api/providers`.
