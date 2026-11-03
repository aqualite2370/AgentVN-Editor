import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import { AssistantCreationWorkbenchWindow } from "./components/assistant/AssistantCreationWorkbenchWindow";
import { savePersonalComponent } from "./renpy/personalComponentLibrary";
import { saveApiKey } from "./providers/apiKeyStorage";
import { setCapabilitySelection, upsertProvider } from "./providers/providerRegistry";
import { useProjectStore } from "./store/projectStore";
import { useEditorStore } from "./store/editorStore";
import { buildProjectBundle, readProjectJsonFromBundle } from "./utils/projectBundle";
import { exportEditorCartridge } from "./cartridge/exportCartridge";
import { manifestAssetsFromProjectAssets } from "./utils/projectAssets";
import { backendClient } from "./api/backendClient";

const componentId = "private-library-component-fixture";
const controlledApi = new URLSearchParams(location.search).get("controlledApi");
const controlledModel = new URLSearchParams(location.search).get("controlledModel");
if (controlledApi) backendClient.setBaseUrl(controlledApi);
const png = Uint8Array.from(atob(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=",
), character => character.charCodeAt(0));

useProjectStore.getState().loadProjectMetadata({
  project_id: "assistant-creation-authorization-project",
  title: "素材授权验收工程",
  author: "验收",
});
useProjectStore.getState().setRuntimeUILayoutType("renpy");
useProjectStore.getState().setAssetManifest([
  { asset_id: "private-project-badge", asset_type: "ui", metadata: {
    display_name: "工程徽章", filename: "中文 徽章.png", mime_type: "image/png",
    data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=",
    prompt: "private-generation-prompt", filePath: "C:\\private\\project\\badge.png",
  } },
  { asset_id: "private-unselected-image", asset_type: "ui", metadata: {
    display_name: "未授权工程图片", filename: "private-unselected.png", mime_type: "image/png",
    data_url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l8sAAAAASUVORK5CYII=",
  } },
  { asset_id: "private-project-audio", asset_type: "bgm", metadata: {
    display_name: "背景音乐", filename: "音乐.mp3", mime_type: "audio/mpeg",
    data_url: "data:audio/mpeg;base64,SUQz",
  } },
]);
const existingImageSource = controlledApi ? new URLSearchParams(location.search).get("existingImageSource") : null;
if (existingImageSource) {
  const state = useProjectStore.getState();
  state.setAssetManifest([...state.assetManifest, { asset_id: "existing-managed-image", asset_type: "ui",
    metadata: { display_name: "已有未授权图片", filename: "已有图片.png", mime_type: "image/png", url: existingImageSource } }]);
  const layout = structuredClone(useProjectStore.getState().settings.runtimeUILayout!);
  layout.screens.find(screen => screen.screen_id === "game_menu")!.components.push({
    component_id: "existing-managed-artwork", component_type: "custom_component", required: false, locked: false,
    visible: true, rect: { x: 72, y: 8, width: 20, height: 12 }, label: "已有图片组件",
    customComponent: { schemaVersion: 1, root: { tag: "div", className: "root", children: [
      { tag: "img", className: "icon", assetId: "existing-managed-image", ariaLabel: "已有未授权图片", children: [] } ] },
      styles: { ".root": { display: "flex", padding: "4px" }, ".icon": { width: "24px", height: "24px" } } },
  });
  useProjectStore.getState().setRuntimeUILayout(layout);
}
Object.assign(window, { __assistantCreationTestStore: useProjectStore });
Object.assign(window, { __assistantProjectAssetExport: async () => {
  const state = useProjectStore.getState();
  const project = useEditorStore.getState().exportProject({ projectId: state.projectId, title: state.title,
    author: state.author, assetManifest: state.assetManifest, editorSettings: { ...state.settings } });
  const bundle = await buildProjectBundle(project);
  const reopened = await readProjectJsonFromBundle(new File([bundle], "工程授权往返.vnproj"));
  const cartridge = await exportEditorCartridge({
    script: { schema_version: "1.0.0", game_id: state.projectId, title: state.title,
      entry_scene_id: "isolated-scene", scenes: [{
      scene_id: "isolated-scene", title: "隔离素材场景", summary: "", chapter: 1, tags: [],
      commands: [{ type: "narration", text: "本轮只核授权图片导出。" }],
    }] }, title: state.title, author: state.author, version: "1.0.0", language: "zh-CN",
    description: "隔离工程素材授权验收", includeGallery: false, includeMetadata: false,
    projectAssetRefs: state.assetManifest, uiSkin: state.settings.runtimeUILayout,
    projectAssets: manifestAssetsFromProjectAssets(state.assetManifest),
    uiLayoutProfiles: state.settings.runtimeUILayoutProfiles,
  });
  return { bundle: Array.from(new Uint8Array(await bundle.arrayBuffer())), reopened,
    cartridge: Array.from(new Uint8Array(await cartridge.blob.arrayBuffer())), errors: cartridge.errors };
} });
upsertProvider({
  provider_id: "authorization-test-provider",
  connection_id: "authorization-test-connection",
  model_id: "authorization-test-model",
  provider_type: "openai_compatible",
  display_name: "授权测试模型",
  connection_name: "授权测试连接",
  base_url: controlledModel ?? "http://127.0.0.1:8278/v1",
  model: "authorization-test-model",
  api_key_storage: "local",
  capabilities: ["text_generation"],
  enabled: true,
  is_relay: false,
  safety_level: "standard",
  default_parameters: { temperature: 0.2, max_tokens: 1000 },
});
saveApiKey("authorization-test-connection", "test-only-secret", "local");
setCapabilitySelection("text_generation", "authorization-test-provider");

async function seedLibrary() {
  await savePersonalComponent({
    id: componentId,
    name: "用户选中徽章",
    description: "仅在用户选择后可进入创造会话。",
    html: '<div class="root"><img class="icon" data-asset="badge" aria-label="徽章" /></div>',
    css: ".root { display: flex; } .icon { width: 24px; height: 24px; }",
    definition: {
      schemaVersion: 1,
      root: { tag: "div", className: "root", children: [
        { tag: "img", className: "icon", assetId: "badge", ariaLabel: "徽章", children: [] },
      ] },
      styles: { ".root": { display: "flex" }, ".icon": { width: "24px", height: "24px" } },
    },
    assets: [{ id: "badge", filename: "徽章.png", mimeType: "image/png", bytes: png }],
  });
  await savePersonalComponent({
    id: "private-unselected-component-fixture",
    name: "未选中卡片",
    description: "不得自动进入 AI 上下文。",
    html: '<div class="root"><span>私有卡片</span></div>',
    css: ".root { display: flex; }",
    definition: {
      schemaVersion: 1,
      root: { tag: "div", className: "root", children: [
        { tag: "span", text: "私有卡片", children: [] },
      ] },
      styles: { ".root": { display: "flex" } },
    },
    assets: [],
  });
}

function Harness() {
  const [open, setOpen] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [exportStatus, setExportStatus] = React.useState("");
  const snapshots = React.useRef(new Map<string, ReturnType<typeof useProjectStore.getState>>());
  const switchOwnedProject = () => {
    const state = useProjectStore.getState();
    snapshots.current.set(state.projectId, state);
    const nextId = state.projectId === "assistant-creation-authorization-project"
      ? "assistant-creation-authorization-project-b" : "assistant-creation-authorization-project";
    const snapshot = snapshots.current.get(nextId);
    useProjectStore.getState().loadProjectMetadata({ project_id: nextId, title: nextId.endsWith("-b") ? "隔离工程 B" : "素材授权验收工程",
      author: "验收", asset_manifest: snapshot?.assetManifest ?? [],
      editor_settings: snapshot ? { ...snapshot.settings } : undefined });
    if (!snapshot) useProjectStore.getState().setRuntimeUILayoutType("renpy");
  };
  React.useEffect(() => {
    const switchProject = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; title: string }>).detail;
      useProjectStore.getState().loadProjectMetadata({
        project_id: detail.id,
        title: detail.title,
        author: "验收",
      });
      if (detail.id === "assistant-creation-authorization-project") {
        useProjectStore.getState().setRuntimeUILayoutType("renpy");
      }
    };
    window.addEventListener("assistant-auth-test-project", switchProject);
    return () => window.removeEventListener("assistant-auth-test-project", switchProject);
  }, []);
  React.useEffect(() => {
    void seedLibrary().then(() => setReady(true));
  }, []);
  return (
    <main className="assistant-creation-workbench-test-shell">
      <output data-testid="authorization-harness-ready">{ready ? "ready" : "loading"}</output>
      <button type="button" onClick={() => setOpen(true)}>打开创造工作台</button>
      <button type="button" data-testid="switch-owned-project" onClick={switchOwnedProject}>切换隔离工程</button>
      <button type="button" data-testid="export-authorized-project" onClick={() => {
        const operation = (window as unknown as { __assistantProjectAssetExport: () => Promise<unknown> }).__assistantProjectAssetExport;
        void operation().then(result => {
          Object.assign(window, { __assistantProjectAssetExportResult: result });
          setExportStatus("ready");
        }).catch(error => setExportStatus(String(error)));
      }}>导出授权工程包</button>
      <output data-testid="asset-export-status">{exportStatus}</output>
      {open && <AssistantCreationWorkbenchWindow onClose={() => setOpen(false)} />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
