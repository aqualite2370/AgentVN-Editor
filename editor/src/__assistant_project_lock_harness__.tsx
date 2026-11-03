import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import { enqueueAssistantCreationProcess } from "./assistant/creationProcessQueue";
import { AssistantProjectCreationLockGate } from "./components/assistant/AssistantProjectCreationLockGate";

function Harness() {
  const [projectId, setProjectId] = React.useState("project-a");
  const [projectTitle, setProjectTitle] = React.useState("工程 A");
  const [editingCount, setEditingCount] = React.useState(0);
  const [editorOpen, setEditorOpen] = React.useState(false);

  function switchProject(next: "a" | "b") {
    setProjectId(`project-${next}`);
    setProjectTitle(`工程 ${next.toUpperCase()}`);
  }

  return (
    <main className="assistant-project-lock-test-shell">
      {!editorOpen && (
        <nav aria-label="验收工程导航" data-testid="project-list">
          <button type="button" data-testid="switch-project-a" onClick={() => switchProject("a")}>选择工程 A</button>
          <button type="button" data-testid="switch-project-b" onClick={() => switchProject("b")}>选择工程 B</button>
          <output data-testid="active-project">{projectId}</output>
          <button type="button" data-testid="open-selected-project" onClick={() => setEditorOpen(true)}>打开所选工程</button>
        </nav>
      )}
      <div className="assistant-project-lock-test-workspace">
        {editorOpen && (
          <AssistantProjectCreationLockGate
            projectId={projectId}
            projectTitle={projectTitle}
            onReturnHome={() => setEditorOpen(false)}
          >
            <div className="editor-shell">
              <div className="assistant-project-lock-test-editor">
                <h1>{projectTitle}</h1>
                <button type="button" data-testid="return-project-list"
                  onClick={() => setEditorOpen(false)}>返回工程列表</button>
                <button type="button" data-testid="project-edit-action"
                  onClick={() => setEditingCount((count) => count + 1)}>修改工程</button>
                <output data-testid="editing-count">{editingCount}</output>
                <button type="button" data-testid="submit-test-creation" onClick={() => {
                  void enqueueAssistantCreationProcess({
                    projectId,
                    projectTitle,
                    conversationId: `conversation-${projectId}`,
                  }, {
                    user_request: "受控浏览器锁定任务",
                    messages: [],
                  }).result.catch(() => undefined);
                }}>提交受控创造任务</button>
              </div>
            </div>
          </AssistantProjectCreationLockGate>
        )}
      </div>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
