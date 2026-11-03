import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import { AssistantCreationWorkbenchWindow } from "./components/assistant/AssistantCreationWorkbenchWindow";
import { newAssistantConversation, saveAssistantConversation } from "./assistant/conversationHistory";
import {
  captureAssistantCreationLayoutBaseline,
} from "./assistant/assistantCreationProjectMerge";
import {
  parseAssistantCreationDraftValue,
  type AssistantCreationReviewItem,
} from "./assistant/creationAgent";
import { useProjectStore } from "./store/projectStore";

useProjectStore.getState().loadProjectMetadata({
  project_id: "assistant-creation-workbench-project",
  title: "创造工作台验收工程",
  author: "验收",
});
useProjectStore.getState().setRuntimeUILayoutType("renpy");

declare global {
  interface Window {
    __creationBatchHarnessState?: () => {
      screenComponentIds: Record<string, string[]>;
      assetIds: string[];
      reviewItems?: Array<{ id: string; included: boolean; screenId: string; merged: boolean }>;
    };
  }
}

window.__creationBatchHarnessState = () => {
  const project = useProjectStore.getState();
  const active = project.settings.runtimeUILayout;
  if (!active) throw new Error("批量审核验收工程缺少活动布局。");
    return {
      screenComponentIds: Object.fromEntries(active.screens.map(screen =>
        [screen.screen_id, screen.components.map(component => component.component_id)])),
      assetIds: project.assetManifest.map(asset => asset.asset_id),
      screenComponentLabels: Object.fromEntries(active.screens.map(screen =>
        [screen.screen_id, screen.components.map(component => component.label)])),
    };
  };

function Harness() {
  const [open, setOpen] = React.useState(true);
  const [seeded, setSeeded] = React.useState(false);

  async function loadGeneratedDraft() {
    const parsed = parseAssistantCreationDraftValue({
      name: "已生成的标题操作组件",
      description: "验收：生成的真实草稿应取代示例预览，但仍只处于隔离审核状态。",
      html: '<div class="root"><span class="title" data-bind="project.title"></span><button type="button" class="button" aria-label="打开存档" data-action="open_save_load">存档</button></div>',
      css: ".root { display: flex; flex-direction: column; gap: 10px; padding: 14px; background-color: #15243b; } .title { color: #ffffff; font-size: 18px; } .button { color: #ffffff; background-color: #314d73; padding: 9px 14px; border-radius: 4px; }",
    });
    if (!parsed.ok || !parsed.draft) throw new Error(parsed.issues.join(" "));
    const conversation = newAssistantConversation(useProjectStore.getState().projectId, "creation");
    conversation.title = "已生成的验收组件草稿";
    conversation.messages = [{ role: "assistant", content: "已生成一份通过安全校验的隔离草稿。" }];
    conversation.creationDraft = parsed.draft;
    await saveAssistantConversation(conversation);
    setSeeded(true);
  }

  async function seedComponentBatch() {
    const project = useProjectStore.getState();
    const activeLayout = project.settings.runtimeUILayout;
    if (!activeLayout) throw new Error("批量审核验收工程缺少活动布局。");
    const baseline = captureAssistantCreationLayoutBaseline(project.projectId, activeLayout);
    const generatedAt = new Date().toISOString();
    const source = [
      {
        name: "标题批量候选",
        description: "第一项：标题页标记。",
        html: '<div class="root"><span>标题标记</span></div>',
        css: ".root { display: flex; padding: 8px; }",
      },
      {
        name: "选项批量候选",
        description: "第二项：可调整到选项页的候选。",
        html: '<div class="root"><span>选项标记</span></div>',
        css: ".root { display: flex; padding: 8px; }",
      },
    ];
    const items = source.map((candidate, index): AssistantCreationReviewItem => {
      const parsed = parseAssistantCreationDraftValue(candidate, `${generatedAt}-${index}`);
      if (!parsed.ok || !parsed.draft) throw new Error(parsed.issues.join(" "));
      return {
        id: `batch-harness-${index + 1}`,
        draft: { ...parsed.draft, projectBaseline: baseline },
        screenId: index === 0 ? "title" : "preferences",
        rect: { x: 10 + index * 30, y: 70, width: 20, height: 12 },
        included: true,
      };
    });
    const conversation = newAssistantConversation(project.projectId, "creation");
    conversation.title = "多组件批量审核验收";
    conversation.messages = [{ role: "assistant", content: "两个隔离组件候选已通过安全校验。" }];
    conversation.creationDraft = items[0].draft;
    conversation.creationReviewItems = items;
    await saveAssistantConversation(conversation);
    setSeeded(true);
  }

  function introduceReviewConflict() {
    const project = useProjectStore.getState();
    const current = project.settings.runtimeUILayout;
    if (!current) throw new Error("批量审核验收工程缺少活动布局。");
    const next = structuredClone(current);
    const page = next.screens.find(screen => screen.screen_id === "preferences");
    if (!page?.components.length) throw new Error("验收布局缺少选项页组件。");
    page.components[0].label = `${page.components[0].label}（审核中已编辑）`;
    project.setRuntimeUILayout(next);
  }

  return (
    <main className="assistant-creation-workbench-test-shell">
      <button type="button" data-testid="seed-generated-draft" onClick={() => void loadGeneratedDraft()}>
        注入受控生成草稿
      </button>
      <button type="button" data-testid="seed-component-batch" onClick={() => void seedComponentBatch()}>
        注入受控批量候选
      </button>
      <button type="button" data-testid="introduce-review-conflict" onClick={introduceReviewConflict}>
        注入审核期间页面修改
      </button>
      <output data-testid="draft-seeded">{seeded ? "ready" : "empty"}</output>
      {open && <AssistantCreationWorkbenchWindow onClose={() => setOpen(false)} />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
