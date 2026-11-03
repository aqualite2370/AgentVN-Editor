import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import { AssistantCreationWorkbenchWindow } from "./components/assistant/AssistantCreationWorkbenchWindow";
import { saveApiKey } from "./providers/apiKeyStorage";
import { setCapabilitySelection, upsertProvider } from "./providers/providerRegistry";
import { useProjectStore } from "./store/projectStore";

useProjectStore.getState().loadProjectMetadata({
  project_id: "assistant-creation-element-edit-project",
  title: "现有控件修改验收工程",
  author: "隔离验收",
});
useProjectStore.getState().setRuntimeUILayoutType("renpy");
Object.assign(window, { __assistantElementEditTestStore: useProjectStore });
upsertProvider({
  provider_id: "element-edit-test-provider",
  connection_id: "element-edit-test-connection",
  model_id: "element-edit-test-model",
  provider_type: "openai_compatible",
  display_name: "控件修改受控模型",
  connection_name: "控件修改验收连接",
  base_url: "http://127.0.0.1:8278/v1",
  model: "element-edit-test-model",
  api_key_storage: "local",
  capabilities: ["text_generation"],
  enabled: true,
  is_relay: false,
  safety_level: "standard",
  default_parameters: { temperature: 0.2, max_tokens: 1000 },
});
saveApiKey("element-edit-test-connection", "test-only-secret", "local");
setCapabilitySelection("text_generation", "element-edit-test-provider");

function Harness() {
  const [open, setOpen] = React.useState(false);
  const switchProject = (projectId: string, title: string) => {
    useProjectStore.getState().loadProjectMetadata({
      project_id: projectId,
      title,
      author: "隔离验收",
    });
    useProjectStore.getState().setRuntimeUILayoutType("renpy");
  };
  return (
    <main className="assistant-creation-workbench-test-shell">
      <button type="button" data-testid="open-element-edit-workbench" onClick={() => setOpen(true)}>
        打开控件修改工作台
      </button>
      <button type="button" data-testid="switch-to-element-edit-project-a"
        onClick={() => switchProject("assistant-creation-element-edit-project", "现有控件修改验收工程")}>
        切换到 A 工程
      </button>
      <button type="button" data-testid="switch-to-element-edit-project-b"
        onClick={() => switchProject("assistant-creation-element-edit-project-b", "隔离工程 B")}>
        切换到 B 工程
      </button>
      {open && <AssistantCreationWorkbenchWindow onClose={() => setOpen(false)} />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
