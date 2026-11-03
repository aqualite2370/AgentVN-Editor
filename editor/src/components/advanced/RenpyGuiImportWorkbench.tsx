import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { createPortal } from "react-dom";
import type { UISkinLayout, UILayoutScreenId } from "../../../../shared/cartridge/uiSkin";
import type { AssetRef } from "../../types/assets";
import {
  isRenpyGuiReimport,
  type RenpyGuiAssetBinding,
  type RenpyGuiAssetImportChoice,
} from "../../renpy/renpyGuiImportPlan";
import { scanRenpyGuiArchive, type RenpyGuiArchiveScan, type RenpyGuiAssetCandidate } from "../../renpy/renpyGuiImport";
import { RichSelect } from "../common/RichSelect";
import { useGuiImportDialog } from "./useGuiImportDialog";
import { createGuiPack, listGuiPacks, readGuiPack, saveGuiPack, type GuiPackSummary } from "../../renpy/guiPackLibrary";
import { prepareGuiPackApplication, guiPackParameterAllowed, type GuiPackBinding, type GuiPackScope } from "../../renpy/guiPackApplication";
import { useProjectStore } from "../../store/projectStore";

const blockingIssueCodes = new Set([
  "invalid_archive", "unsafe_path", "symbolic_link", "archive_limit",
  "missing_gui", "ambiguous_gui", "invalid_encoding",
]);

function inferAssetHint(candidate: RenpyGuiAssetCandidate): { purpose: string; state: string } {
  const source = candidate.path.toLocaleLowerCase("en-US");
  const purpose = /button|navigation|choice/.test(source) ? "按钮/导航素材"
    : /dialog|window|frame|box/.test(source) ? "对白/面板素材"
      : /background|backdrop|main_menu/.test(source) ? "背景素材"
        : candidate.kind === "font" ? "字体资源" : "通用界面图片";
  const state = /hover|over|focused/.test(source) ? "悬停/聚焦"
    : /selected|active|checked/.test(source) ? "选中"
      : /insensitive|disabled/.test(source) ? "禁用"
        : /idle|normal|default/.test(source) ? "普通" : "状态待确认";
  return { purpose, state };
}

function formatParameterValue(field: string, value: unknown): string {
  if (field === "buttonBorders" && value && typeof value === "object") {
    const borders = value as { left?: unknown; top?: unknown; right?: unknown; bottom?: unknown };
    return `左 ${String(borders.left)} · 上 ${String(borders.top)} · 右 ${String(borders.right)} · 下 ${String(borders.bottom)}`;
  }
  if (field === "buttonTile" && typeof value === "boolean") return value ? "平铺" : "拉伸";
  if (typeof value === "string" || typeof value === "number") return String(value);
  return value === undefined ? "继承" : JSON.stringify(value);
}

function parameterRows(scan: RenpyGuiArchiveScan, layout: UISkinLayout) {
  const rows: Array<{ key: string; scope: string; field: string; value: unknown; current?: unknown }> = [];
  for (const [scope, fields] of Object.entries(scan.parameters.values)) {
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (scope === "shared" && field === "buttonTextColors" && value && typeof value === "object") {
        for (const [state, color] of Object.entries(value as Record<string, unknown>)) {
          rows.push({
            key: `${scope}.${field}.${state}`,
            scope,
            field: `${field}.${state}`,
            value: color,
            current: layout.renpy?.shared?.buttonTextColors?.[state as "normal" | "hover" | "selected" | "disabled"],
          });
        }
        continue;
      }
      rows.push({
        key: `${scope}.${field}`,
        scope,
        field,
        value,
        current: layout.renpy?.[scope as keyof NonNullable<UISkinLayout["renpy"]>]?.[field as never],
      });
    }
  }
  return rows;
}

function bytesToPreviewDataUrl(asset: RenpyGuiAssetCandidate): string {
  let binary = "";
  for (let offset = 0; offset < asset.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...asset.bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${asset.mimeType};base64,${btoa(binary)}`;
}
function GuiAssetPreview({ asset }: { asset: RenpyGuiAssetCandidate }) {
  const [size, setSize] = useState("");
  const [error, setError] = useState(false);
  return <div className="renpy-gui-asset-preview">
    {asset.kind === "image" ? <img src={bytesToPreviewDataUrl(asset)} alt=""
      onLoad={event => setSize(`${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`)}
      onError={() => setError(true)} /> : <span className="renpy-gui-import-font-preview">Aa</span>}
    <small>{error ? "预览解码失败" : asset.kind === "image" ? size || "读取尺寸…" : asset.mimeType.replace("font/", "").toUpperCase()}</small>
  </div>;
}
const parameterLabels: Record<string, string> = {
  x: "导航左边距", fontSize: "导航字号", spacing: "导航项间距", saveColumns: "存档网格列数", saveGap: "存档格间距",
  buttonBorders: "共享按钮九宫格边距", buttonTile: "共享按钮背景拉伸方式", buttonTextColors: "共享按钮文字颜色",
  menuNavigationWidth: "菜单导航区宽度", menuTopPadding: "菜单顶部留白", menuBottomPadding: "菜单底部留白",
  menuContentLeft: "内容左边距", menuContentRight: "内容右边距", menuContentTop: "内容顶部留白",
  menuTitleX: "页面标题左边距", menuTitleFontSize: "页面标题字号",
};

export function RenpyGuiImportWorkbench({
  layout,
  existingAssets,
  onApply,
}: {
  layout: UISkinLayout;
  existingAssets: AssetRef[];
  onApply: (nextLayout: UISkinLayout, nextAssets: AssetRef[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const commitInFlightRef = useRef(false);
  const modal = useGuiImportDialog(() => !commitInFlightRef.current);
  const [scan, setScan] = useState<RenpyGuiArchiveScan>();
  const [fileName, setFileName] = useState("");
  const [parameterSelection, setParameterSelection] = useState<Record<string, boolean>>({});
  const [assetSelection, setAssetSelection] = useState<Record<string, RenpyGuiAssetImportChoice>>({});
  const [assetBindings, setAssetBindings] = useState<Record<string, GuiPackBinding | undefined>>({});
  const [licenseConfirmed, setLicenseConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [packs, setPacks] = useState<GuiPackSummary[]>([]);
  const [stage, setStage] = useState<"library" | "import" | "apply">("library");
  const [notice, setNotice] = useState("");
  const [packName, setPackName] = useState("");
  const [revisionBase, setRevisionBase] = useState("");
  const [scopeKind, setScopeKind] = useState<GuiPackScope["kind"]>("project");
  const [scopeScreen, setScopeScreen] = useState<UILayoutScreenId>("title");
  const [scopeControl, setScopeControl] = useState("title_start_button");
  const [scopeState, setScopeState] = useState<"normal" | "hover" | "selected" | "disabled">("normal");
  const projectId = useProjectStore(state => state.projectId);
  const latestRef = useRef({ projectId, layout, existingAssets });
  latestRef.current = { projectId, layout, existingAssets };
  const applicationBaseRef = useRef<{ projectId: string; layout: string; assets: string } | undefined>(undefined);
  const scope: GuiPackScope = scopeKind === "project" ? { kind: "project" }
    : scopeKind === "page" ? { kind: "page", screenId: scopeScreen }
      : { kind: "control", screenId: scopeScreen, componentId: scopeControl, state: scopeState };
  const effectiveBindings: Record<string, GuiPackBinding | undefined> = assetBindings;
  const scanGenerationRef = useRef(0);
  const projectOwnerRef = useRef(projectId);
  const activeRef = useRef(false);
  useLayoutEffect(() => {
    if (projectOwnerRef.current !== projectId) {
      projectOwnerRef.current = projectId;
      applicationBaseRef.current = undefined;
      setScan(undefined); setStage("library"); setError(""); setNotice("工程已切换，请重新选择资源包和应用范围。");
      setAssetBindings({}); setParameterSelection({}); setLicenseConfirmed(false);
    }
    activeRef.current = modal.active;
    if (!modal.active) { scanGenerationRef.current++; setBusy(false); }
    return () => { activeRef.current = false; scanGenerationRef.current++; };
  }, [modal.active, projectId]);
  const ownsScan = (generation: number) => activeRef.current && generation === scanGenerationRef.current;
  useEffect(() => {
    if (!modal.active) return;
    let current = true;
    void listGuiPacks().then(value => { if (current) setPacks(value); },
      cause => { if (current) setError(`无法读取本机资源包库：${String(cause)}`); });
    return () => { current = false; };
  }, [modal.active, projectId]);

  useEffect(() => {
    if (modal.present) return;
    setScan(undefined);
    setFileName("");
    setParameterSelection({});
    setAssetSelection({});
    setAssetBindings({});
    setLicenseConfirmed(false);
    setError("");
    setStage("library"); setNotice(""); setRevisionBase(""); setPackName("");
  }, [modal.present]);

  const chooseArchive = () => inputRef.current?.click();
  const scanBytes = async (name: string, bytes: Uint8Array, generation: number) => {
    if (!ownsScan(generation)) return;
    setBusy(true);
    setError("");
    setScan(undefined);
    setFileName(name);
    setPackName(name.replace(/\.zip$/i, ""));
    setStage("import"); setNotice(""); setRevisionBase("");
    setAssetBindings({});
    setLicenseConfirmed(false);
    try {
      const result = await scanRenpyGuiArchive(bytes);
      if (!ownsScan(generation)) return;
      setScan(result);
      const params: Record<string, boolean> = {};
      for (const row of parameterRows(result, layout)) {
        params[row.key] = true;
      }
      setParameterSelection(params);
      const selections: Record<string, RenpyGuiAssetImportChoice> = {};
      for (const asset of result.assets) {
        selections[asset.path] = "add";
      }
      setAssetSelection(selections);
    } catch (cause) {
      if (ownsScan(generation)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (ownsScan(generation)) setBusy(false);
    }
  };
  const handleArchive = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    const generation = ++scanGenerationRef.current;
    setBusy(true);
    setError("");
    try {
      await scanBytes(file.name, new Uint8Array(await file.arrayBuffer()), generation);
    } catch (cause) {
      if (ownsScan(generation)) {
        setError(cause instanceof Error ? cause.message : String(cause));
        setBusy(false);
      }
    }
  };
  const chooseDirectory = async () => {
    if (!("__TAURI_INTERNALS__" in window)) {
      setError("目录导入需要桌面版 AgentVN；浏览器环境无法安全核验目录内的符号链接。");
      return;
    }
    const generation = ++scanGenerationRef.current;
    setBusy(true);
    setError("");
    setScan(undefined);
    setAssetBindings({});
    setLicenseConfirmed(false);
    let archivePath: string | undefined;
    let failed: unknown;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      const stagedPath = await invoke<string | null>("select_renpy_gui_import_directory");
      if (!stagedPath) return;
      archivePath = stagedPath;
      if (!ownsScan(generation)) return;
      setFileName("所选 GUI 目录");
      setPackName("GUI目录资源包"); setStage("import"); setNotice(""); setRevisionBase("");
      const size = await invoke<number>("get_renpy_gui_import_archive_size", { archivePath });
      if (!Number.isSafeInteger(size) || size <= 0 || size > 160 * 1024 * 1024) {
        throw new Error("GUI_IMPORT_ARCHIVE_LIMIT: 暂存目录包为空或超过 160 MiB。");
      }
      const bytes = new Uint8Array(size);
      const chunkSize = 4 * 1024 * 1024;
      for (let offset = 0; offset < size; offset += chunkSize) {
        const length = Math.min(chunkSize, size - offset);
        const chunk = await invoke<number[]>("read_renpy_gui_import_archive_chunk", {
          archivePath, offset, length,
        });
        if (!ownsScan(generation)) return;
        if (chunk.length !== length) throw new Error("GUI_IMPORT_ARCHIVE_TRUNCATED: 暂存目录包读取不完整。");
        bytes.set(chunk, offset);
      }
      const result = await scanRenpyGuiArchive(bytes);
      if (!ownsScan(generation)) return;
      setScan(result);
      const params: Record<string, boolean> = {};
      for (const row of parameterRows(result, layout)) params[row.key] = true;
      setParameterSelection(params);
      const selections: Record<string, RenpyGuiAssetImportChoice> = {};
      for (const asset of result.assets) {
        selections[asset.path] = "add";
      }
      setAssetSelection(selections);
    } catch (cause) {
      failed = cause;
      if (ownsScan(generation)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (archivePath) {
        try {
          const { invoke } = await import("@tauri-apps/api/core");
          await invoke("cleanup_renpy_gui_import_archive", { archivePath });
        } catch (cleanupCause) {
          const message = cleanupCause instanceof Error ? cleanupCause.message : String(cleanupCause);
          if (ownsScan(generation)) {
            setError((previous) => [previous, `GUI 导入暂存文件清理失败：${message}`].filter(Boolean).join("；"));
          } else {
            console.error("GUI_IMPORT_STALE_CLEANUP_FAILED", { archivePath, message });
          }
        }
      }
      if (ownsScan(generation)) {
        setBusy(false);
        if (failed) setScan(undefined);
      }
    }
  };
  const rows = scan ? parameterRows(scan, layout) : [];
  const selectedAssetCount = scan?.assets.filter((asset) => assetSelection[asset.path]
    && assetSelection[asset.path] !== "skip").length ?? 0;
  const selectedBindingCount = scan?.assets.filter((candidate) => {
    if (!assetBindings[candidate.path]) return false;
    if (assetSelection[candidate.path] !== "skip") return false;
    return existingAssets.some((asset) => isRenpyGuiReimport(asset, candidate));
  }).length ?? 0;
  const selectedParameterCount = Object.values(parameterSelection).filter(Boolean).length;
  const blocked = scan?.issues.some((entry) => blockingIssueCodes.has(entry.code)) ?? false;
  const canApply = Boolean(scan) && !blocked && !busy
    && (selectedAssetCount > 0 ? licenseConfirmed : true)
    && (selectedAssetCount + selectedBindingCount + selectedParameterCount > 0);

  const dismiss = () => {
    modal.close();
  };
  const importIntoLibrary = async () => {
    if (!scan || !canApply || commitInFlightRef.current) return;
    const generation = ++scanGenerationRef.current;
    commitInFlightRef.current = true;
    setBusy(true); setError("");
    try {
      const libraryBindings: Record<string, RenpyGuiAssetBinding | undefined> = {};
      for (const [path, binding] of Object.entries(assetBindings))
        if (binding !== "control_background") libraryBindings[path] = binding;
      const pack = createGuiPack(scan, { name: packName, sourceName: fileName,
        previous: packs.find(pack => pack.id === revisionBase),
        assetPaths: scan.assets.filter(asset => assetSelection[asset.path] !== "skip").map(asset => asset.path),
        parameterSelection, assetBindings: libraryBindings });
      const committed = await saveGuiPack(pack);
      // A disk acknowledgement is the commit. Closing/switching cannot apply to a project.
      if (!ownsScan(generation)) return;
      setPacks(current => [committed, ...current.filter(item => item.id !== committed.id)]);
      setScan(undefined); setStage("library");
      setNotice(`已保存“${pack.name}”修订 ${pack.revision}。当前工程未修改；请单独预览并选择应用。`);
    } catch (cause) {
      if (ownsScan(generation)) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      commitInFlightRef.current = false;
      if (ownsScan(generation)) setBusy(false);
    }
  };
  const loadPack = async (id: string) => {
    const generation = ++scanGenerationRef.current, base = latestRef.current;
    setBusy(true); setError(""); setNotice("");
    try {
      const pack = await readGuiPack(id);
      if (!ownsScan(generation) || latestRef.current.projectId !== base.projectId) return;
      applicationBaseRef.current = { projectId: base.projectId, layout: JSON.stringify(base.layout),
        assets: JSON.stringify(base.existingAssets) };
      setScan(pack.scan); setFileName(`${pack.name} · 修订 ${pack.revision}`);
      setAssetSelection(Object.fromEntries(pack.scan.assets.map(asset => [asset.path, "add"])));
      setParameterSelection(Object.fromEntries(parameterRows(pack.scan, base.layout).map(row =>
        [row.key, pack.parameterSelection[row.key] === true && row.current === undefined])));
      setAssetBindings(pack.assetBindings); setLicenseConfirmed(false);
      setScopeKind("project"); setStage("apply");
    } catch (cause) { if (ownsScan(generation)) setError(String(cause)); }
    finally { if (ownsScan(generation)) setBusy(false); }
  };
  const changeScope = (kind: GuiPackScope["kind"]) => {
    setScopeKind(kind); setAssetBindings({});
    if (kind !== "project") {
      setParameterSelection({});
      setAssetSelection(previous => Object.fromEntries(Object.entries(previous).map(([path, choice]) =>
        [path, choice === "replace" ? "add" : choice])));
    }
  };

  const apply = () => {
    if (!scan || !canApply) return;
    setError("");
    try {
      const base = applicationBaseRef.current;
      if (!base || base.projectId !== projectId || base.layout !== JSON.stringify(layout)
        || base.assets !== JSON.stringify(existingAssets)) throw new Error("工程或布局已变化，请返回资源包库重新预览；本次未应用。");
      const prepared = prepareGuiPackApplication({
        layout,
        existingAssets,
        scan,
        parameterSelection,
        assetSelection,
        assetBindings: effectiveBindings,
        scope,
      });
      onApply(prepared.layout, prepared.assets);
      dismiss();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  return <>
    <button ref={modal.triggerRef} type="button" data-testid="renpy-gui-import-open" onClick={modal.open}>
      GUI资源包库…
    </button>
    {modal.present && createPortal(<div ref={modal.backdropRef} className="renpy-gui-import-backdrop"
      data-phase={modal.phase} inert={!modal.active} aria-hidden={!modal.active || undefined}
      data-toolbar-popover-keepopen="true" data-testid="renpy-gui-import-backdrop">
      <section ref={modal.dialogRef} className="renpy-gui-import-dialog" role="dialog" aria-modal={modal.active}
        tabIndex={-1}
        aria-labelledby="renpy-gui-import-title" data-testid="renpy-gui-import-dialog">
        <input ref={inputRef} className="renpy-gui-import-file-input" type="file" accept=".zip,application/zip"
          aria-label="选择 Ren'Py（进阶）界面资源 ZIP" onChange={(event) => void handleArchive(event)} />
        <header>
          <div>
            <h3 id="renpy-gui-import-title">Ren’Py · GUI资源包库</h3>
            <p>先扫描入本机库，再选择应用范围。只读取静态参数和图片/字体，不运行脚本。</p>
          </div>
          <button type="button" aria-label="关闭导入预览" disabled={commitInFlightRef.current} onClick={dismiss}>关闭</button>
        </header>
        <div className="renpy-gui-import-body">
        <section className="renpy-gui-library" data-testid="renpy-gui-library" aria-label="本机GUI资源包库">
          <h4>本机资源包 · 与工程独立</h4>
          <p>入库不修改工程。每次重新导入可另存独立包或新增修订；旧修订和工程内人工修改保持。</p>
          {notice && <output role="status">{notice}</output>}
          {!packs.length && <small>还没有资源包，可从下方选择ZIP或目录开始。</small>}
          {packs.map(pack => <article key={pack.id} data-pack-id={pack.id}>
            <div><strong>{pack.name}</strong>
              <small>修订 {pack.revision} · {pack.assetCount} 个素材 · {pack.issueCount} 条扫描说明
                · 来源 {pack.sourceName} · {new Date(pack.createdAt).toLocaleString()}</small></div>
            <button type="button" disabled={busy} onClick={() => void loadPack(pack.id)}>预览并选择应用</button>
          </article>)}
          {stage !== "library" && <button type="button" disabled={busy} onClick={() => {
            setScan(undefined); setStage("library"); setError("");
          }}>返回本机库，放弃本次操作</button>}
        </section>
        {!scan && <div className="renpy-gui-import-empty">
          <p>导入新资源包：扫描 → 用途映射与问题预览 → 确认入库。此处不会写入工程。</p>
          <button type="button" onClick={chooseArchive} disabled={busy}>
            {busy ? "正在安全扫描…" : "选择 ZIP 文件"}
          </button>
          <button type="button" onClick={() => void chooseDirectory()} disabled={busy}>
            选择资源目录
          </button>
          <small>目录由桌面端原生扫描；发现链接、路径越界或超过资源上限时会拒绝整个导入。</small>
        </div>}
        {scan && <>
          <div className="renpy-gui-import-summary" role="status">
            <strong>{fileName}</strong>
            <span>{rows.length} 项静态参数 · {scan.assets.length} 个素材候选 · {scan.issues.length} 条待确认内容</span>
            <div className="renpy-gui-import-source-actions">
              <button type="button" onClick={chooseArchive} disabled={busy}>重新选择 ZIP</button>
              <button type="button" onClick={() => void chooseDirectory()} disabled={busy}>重新选择目录</button>
            </div>
          </div>
          {stage === "import" && <div className="renpy-gui-import-section">
            <label>资源包名称<input aria-label="资源包名称" maxLength={160} value={packName}
              onChange={event => setPackName(event.currentTarget.value)} /></label>
            <RichSelect ariaLabel="资源包修订来源" portalContainer={modal.backdropRef.current}
              value={revisionBase} onChange={setRevisionBase}
              options={[{ value: "", label: "保存为独立新资源包" }, ...packs.map(pack => ({
                value: pack.id, label: `${pack.name} · 从修订 ${pack.revision} 新建修订（保留原件）`,
              }))]} />
          </div>}
          {stage === "apply" && <section className="renpy-gui-import-section" data-testid="renpy-gui-impact">
            <h4>应用影响 · 当前工程：{useProjectStore.getState().title}</h4>
            <RichSelect ariaLabel="资源包应用范围" portalContainer={modal.backdropRef.current}
              value={scopeKind} onChange={changeScope} options={[
                { value: "project", label: "当前Ren’Py布局" }, { value: "page", label: "单个页面" },
                { value: "control", label: "单个控件" }]} />
            {scopeKind !== "project" && <RichSelect ariaLabel="目标页面" portalContainer={modal.backdropRef.current}
              value={scopeScreen} onChange={screenId => {
                setScopeScreen(screenId); setAssetBindings({}); setParameterSelection({});
                setScopeControl(layout.screens.find(screen => screen.screen_id === screenId)?.components.find(c => !c.locked)?.component_id ?? "");
              }} options={layout.screens.map(screen => ({ value: screen.screen_id, label:
                ({ title: "标题", player: "对白", preferences: "设置", save_load: "存读档", history: "历史",
                  gallery: "画廊", about: "关于", help: "帮助", game_menu: "游戏菜单" })[screen.screen_id] }))} />}
            {scopeKind === "control" && <>
              <RichSelect ariaLabel="目标控件" portalContainer={modal.backdropRef.current}
                value={scopeControl} onChange={setScopeControl}
                options={(layout.screens.find(screen => screen.screen_id === scopeScreen)?.components ?? [])
                  .filter(component => !component.locked).map(component => ({
                    value: component.component_id, label: component.label || component.component_id }))} />
              <RichSelect ariaLabel="目标控件状态" portalContainer={modal.backdropRef.current}
                value={scopeState} onChange={setScopeState} options={[
                  { value: "normal", label: "普通" }, { value: "hover", label: "悬停 / 焦点" },
                  { value: "selected", label: "选中" }, { value: "disabled", label: "禁用" }]} />
            </>}
            <p>{scopeKind === "control" ? `仅修改当前控件 ${scopeControl} 的 ${scopeState} 状态背景；其它控件和共享样式不变。`
              : scopeKind === "page" ? `仅修改 ${scopeScreen} 页的已选参数与控件；其它页面和共享样式不变。`
                : "仅修改当前Ren’Py布局的已选参数和用途；另一套布局不变。"}
              已选 {selectedParameterCount} 项参数、{selectedAssetCount} 个素材；已有值默认不勾选，切换范围后请重新确认参数和用途。绑定外观时请核对人工修改与进阶代码覆盖。</p>
          </section>}
          {rows.length > 0 && <section className="renpy-gui-import-section" aria-label="静态参数映射">
            <h4>静态参数 · {stage === "apply" ? "选中后应用到指定范围" : "选中后收入资源包"}</h4>
            <div className="renpy-gui-import-rows">
              {rows.map((row) => <label key={row.key} className="renpy-gui-import-row">
                <input type="checkbox" checked={parameterSelection[row.key] ?? false}
                  disabled={stage === "apply" && !guiPackParameterAllowed(scope, row.key)}
                  onChange={(event) => {
                    const checked = event.currentTarget.checked;
                    setParameterSelection((current) => ({ ...current, [row.key]: checked }));
                  }} />
                <span>{parameterLabels[row.field.split(".")[0]] ?? row.field}<small> · {row.key}</small></span>
                <small>{stage === "apply" ? `当前：${formatParameterValue(row.field, row.current)} → ` : ""}
                  资源包：{formatParameterValue(row.field, row.value)}
                  {stage === "apply" && !guiPackParameterAllowed(scope, row.key) ? "（此范围不应用）" : ""}</small>
              </label>)}
            </div>
          </section>}
          {scan.assets.length > 0 && <section className="renpy-gui-import-section" aria-label="图片和字体映射">
            <h4>图片与字体 · {stage === "apply" ? "复制所选依赖到当前工程" : "仅收入本机资源包"}</h4>
            <div className="renpy-gui-import-rows">
              {scan.assets.map((asset) => {
                const hint = inferAssetHint(asset);
                return <div key={asset.path} className="renpy-gui-import-asset-row">
                  <GuiAssetPreview asset={asset} />
                  <div className="renpy-gui-import-asset-copy">
                    <strong>{asset.path}</strong>
                    <small>{hint.purpose} · {hint.state}状态建议 · {asset.sizeBytes.toLocaleString()} B</small>
                  </div>
                  <RichSelect<RenpyGuiAssetImportChoice> ariaLabel={`${asset.path} 导入操作`}
                    portalContainer={modal.backdropRef.current}
                    value={assetSelection[asset.path] ?? "skip"}
                    onChange={(choice) => {
                      setAssetSelection((current) => ({ ...current, [asset.path]: choice }));
                    }} options={[
                      { value: "add", label: stage === "apply" ? "复制为新素材" : "收入资源包" },
                      { value: "skip", label: "跳过" },
                    ]} />
                  <RichSelect<GuiPackBinding | ""> ariaLabel={`${asset.path} 游戏界面用途`}
                    portalContainer={modal.backdropRef.current}
                    value={assetBindings[asset.path] ?? ""}
                    onChange={(binding) => setAssetBindings((current) => ({ ...current, [asset.path]: binding || undefined }))}
                    options={[
                      { value: "", label: stage === "apply" ? "仅复制到工程，不绑定外观" : "仅收入资源包，暂不指定用途" },
                      ...(asset.kind === "image" && stage === "apply" && scopeKind === "control"
                        ? [{ value: "control_background" as const, label: "当前控件背景" }]
                        : asset.kind === "image" ? [
                        { value: "button_normal" as const, label: "共享按钮 · 普通状态" },
                        { value: "button_hover" as const, label: "共享按钮 · 悬停/聚焦状态" },
                        { value: "button_selected" as const, label: "共享按钮 · 选中状态" },
                        { value: "button_disabled" as const, label: "共享按钮 · 禁用状态" },
                        { value: "title_background" as const, label: "标题页主视觉" },
                        { value: "dialog_panel" as const, label: "对白面板背景" },
                        { value: "choice_button" as const, label: "分支选项按钮背景" },
                      ] : stage !== "apply" || scopeKind === "project"
                        ? [{ value: "interface_font" as const, label: "全局界面字体" }] : []),
                    ]} />
                </div>;
              })}
            </div>
          </section>}
          {scan.issues.length > 0 && <section className="renpy-gui-import-issues" aria-label="扫描问题">
            <h4>{blocked ? "阻止应用的问题" : "未导入或需人工确认"}</h4>
            <ul>{scan.issues.map((entry, index) => <li key={`${entry.code}-${entry.path ?? ""}-${index}`}>
              <strong>{entry.path ? `${entry.path} · ` : ""}{entry.code}</strong>：{entry.message}
            </li>)}</ul>
          </section>}
          {selectedAssetCount > 0 && <label className="renpy-gui-import-license">
            <input type="checkbox" checked={licenseConfirmed}
              onChange={(event) => setLicenseConfirmed(event.currentTarget.checked)} />
            我已重新核对这些素材的来源、授权及分发范围。
          </label>}
          <p className="renpy-gui-import-disclaimer">
            {stage === "import" ? "此处的用途仅保存为资源包映射，不影响工程。未支持的文件和表达式不会执行或偷偷导入。"
              : "只应用明确选择的内容。复制后归当前工程管理，修改个人库不会联动工程；字体和共享边框只在工程范围应用。"}
          </p>
        </>}
        </div>
        {error && <p className="renpy-gui-import-error" role="alert">{error}</p>}
        <footer>
          <button type="button" disabled={commitInFlightRef.current} onClick={dismiss}>取消，不修改工程</button>
          {stage === "import" && <button type="button" className="is-primary"
            disabled={!canApply || !packName.trim()} onClick={() => void importIntoLibrary()}>确认入库，不修改工程</button>}
          {stage === "apply" && <button type="button" className="is-primary" disabled={!canApply}
            onClick={apply}>确认应用到当前工程</button>}
        </footer>
      </section>
    </div>, document.body)}
  </>;
}
