import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import { AssistantChatPanel } from "./components/assistant/AssistantChatPanel";
import { AssistantCreationWorkbenchWindow } from "./components/assistant/AssistantCreationWorkbenchWindow";
import {
  listAssistantConversations,
  newAssistantConversation,
  saveAssistantConversation,
} from "./assistant/conversationHistory";
import { hydrateApiKeys } from "./providers/apiKeyStorage";
import { hydrateProviderState } from "./providers/providerRegistry";
import { useProjectStore } from "./store/projectStore";
import { getAssistantCreationProcesses, subscribeAssistantCreationProcesses } from "./assistant/creationProcessQueue";

const connectionId = "assistant-history-test-connection";
const providerId = "assistant-history-test-provider";
const timestamp = new Date().toISOString();

hydrateProviderState({
  provider_connections: [{
    connection_id: connectionId,
    provider_type: "openai_compatible",
    display_name: "浏览器验收模型",
    base_url: "http://127.0.0.1:8278/v1",
    api_key_storage: "local",
    enabled: true,
    supports_model_discovery: false,
    created_at: timestamp,
    updated_at: timestamp,
  }],
  provider_models: [{
    provider_id: providerId,
    connection_id: connectionId,
    model_id: "assistant-history-test-model",
    model_name: "assistant-history-test-model",
    display_name: "浏览器验收模型",
    enabled: true,
    capabilities: ["text_generation"],
    default_parameters: { request_timeout_seconds: 30, context_budget_tokens: 4000 },
    created_at: timestamp,
    updated_at: timestamp,
  }],
  provider_selections: { text_generation: providerId },
});
hydrateApiKeys({ [connectionId]: "browser-test-only-key" });
useProjectStore.getState().loadProjectMetadata({
  project_id: "assistant-history-project-a",
  title: "AI 会话工程 A",
  author: "验收",
});

function Harness() {
  const projectId = useProjectStore((state) => state.projectId);
  const [assistantVisible, setAssistantVisible] = React.useState(true);
  const [creationWorkbenchOpen, setCreationWorkbenchOpen] = React.useState(false);
  const [modeSummary, setModeSummary] = React.useState("");
  const creationProcesses = React.useSyncExternalStore(
    subscribeAssistantCreationProcesses,
    getAssistantCreationProcesses,
    getAssistantCreationProcesses,
  );
  const createModeFixture = async () => {
    const fixture = newAssistantConversation(projectId, "creation");
    fixture.title = "创造模式隔离样例";
    fixture.messages = [{ role: "user", content: "仅属于创造模式的验收记录。" }];
    await saveAssistantConversation(fixture);
    const [inquiry, creation] = await Promise.all([
      listAssistantConversations(projectId, "inquiry"),
      listAssistantConversations(projectId, "creation"),
    ]);
    setModeSummary(JSON.stringify({
      inquiry: inquiry.map((item) => item.title),
      creation: creation.map((item) => item.title),
    }));
  };
  const switchProject = () => {
    const nextId = projectId === "assistant-history-project-a"
      ? "assistant-history-project-b"
      : "assistant-history-project-a";
    useProjectStore.getState().loadProjectMetadata({
      project_id: nextId,
      title: nextId.endsWith("-a") ? "AI 会话工程 A" : "AI 会话工程 B",
      author: "验收",
    });
  };
  return (
    <main style={{ width: "100%", height: "100%", padding: 16, boxSizing: "border-box" }}>
      <button type="button" data-testid="switch-project" onClick={switchProject}>
        切换工程
      </button>
      <button type="button" data-testid="seed-creation-history" onClick={() => void createModeFixture()}>
        创建模式隔离验收样例
      </button>
      <button type="button" data-testid="toggle-primary-assistant" onClick={() => setAssistantVisible((visible) => !visible)}>
        切换主助手面板
      </button>
      <output data-testid="active-project">{projectId}</output>
      <output data-testid="creation-process-snapshot">{JSON.stringify(creationProcesses.map(({ id, projectTitle, status }) => ({ id, projectTitle, status })))}</output>
      <output data-testid="mode-isolation-summary">{modeSummary}</output>
      <div style={{ height: "calc(100% - 36px)", minHeight: 0 }}>
        {assistantVisible && <AssistantChatPanel onOpenCreationWorkbench={() => setCreationWorkbenchOpen(true)} />}
      </div>
      {creationWorkbenchOpen && <AssistantCreationWorkbenchWindow onClose={() => setCreationWorkbenchOpen(false)} />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
