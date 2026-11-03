import React, { useState } from "react";
import ReactDOM from "react-dom/client";
import "@xyflow/react/dist/style.css";
import "../../shared/ui/nativeInteractionGuards.css";
import "./styles/variables.css";
import "./styles/layout.css";
import "./styles/editor-tokens.css";
import "./styles/editor-shell.css";
import "./styles/editor-topbar.css";
import "./styles/editor-responsive.css";
import "./styles/editor-preview.css";
import "./styles/editor-publish.css";
import "./styles/quick-menu-preview.css";
import "./styles/asset-studio.css";
import "./styles/nodes.css";
import "../../shared/ui/slowFocusGlow.css";
import type { UISkinLayout } from "../../shared/cartridge/uiSkin";
import { createRenpyUILayout } from "../../shared/cartridge/uiLayoutProfiles";
import { RenpyTitleEditor } from "./components/advanced/RenpyTitleEditor";
import { useProjectStore } from "./store/projectStore";
import type { AssetRef } from "./types/assets";

function Harness() {
  const [layout, setLayout] = useState<UISkinLayout>(() => {
    return createRenpyUILayout();
  });
  const [assets, setAssets] = useState<AssetRef[]>([]);
  return <main className="editor-shell">
    <section className="toolbar-popover workspace-task-panel advanced is-layout-mode is-open">
      <div className="advanced-tools-panel layout-mode">
        <nav className="glass-selection-group" aria-label="工作区">
          <button type="button">工程</button>
          <button type="button" aria-current="page">选项</button>
        </nav>
        <div className="advanced-tab-viewport has-managed-height">
          <div className="advanced-tab-content is-active">
            <div className="advanced-tab-scroll">
              <section className="runtime-layout-designer" data-renpy-editor="help">
                <header className="runtime-layout-header">
                  <div><h3>游戏客户端</h3></div>
                  <div className="row-actions"><span>进阶布局 Runtime 验收</span></div>
                </header>
                <RenpyTitleEditor
                  draft={layout}
                  title="组件运行时验收"
                  fontCoverageText="组件运行时验收"
                  page="help"
                  previewMode="desktop"
                  onPreviewMode={() => {}}
                  onChange={setLayout}
                  onAssets={(nextAssets) => {
                    setAssets(nextAssets);
                    useProjectStore.getState().setAssetManifest(nextAssets);
                  }}
                  onPage={() => {}}
                  onOtherPages={() => {}}
                  assets={assets}
                  onApplyGuiImport={(nextLayout, nextAssets) => {
                    setLayout(nextLayout);
                    setAssets(nextAssets);
                  }}
                />
                <section className="runtime-layout-status ok" role="status">布局检查通过</section>
              </section>
            </div>
          </div>
        </div>
      </div>
    </section>
  </main>;
}

useProjectStore.getState().setMetadata({ title: "组件运行时验收", author: "QA" });
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
