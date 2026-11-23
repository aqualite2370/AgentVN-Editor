import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { parseCustomComponentMarkup, type CustomComponentDefinition, type CustomComponentNode } from "../../renpy/customComponentMarkup";
import {
  scanCustomComponentArchive,
  type CustomComponentArchiveAssetInput,
  type CustomComponentArchiveScan,
} from "../../renpy/customComponentArchive";
import {
  deletePersonalComponent,
  exportPersonalComponentCopies,
  importPersonalComponentCopies,
  listPersonalComponents,
  savePersonalComponent,
  type PersonalComponentRecord,
} from "../../renpy/personalComponentLibrary";
import "./custom-component-library.css";
import { RichSelect } from "../common/RichSelect";
import { useEditorDeleteConfirmation } from "../common/useEditorDeleteConfirmation";

const INITIAL_HTML = `<div class="root">
  <span class="title" data-bind="project.title">项目标题</span>
  <button type="button" class="button" aria-label="打开存档" data-action="open_save_load">存档</button>
</div>`;
const INITIAL_CSS = `.root { display: flex; flex-direction: column; gap: 12px; padding: 16px; }
.title { color: #f6f8ff; font-size: 20px; }
.button { color: #ffffff; background-color: #24324d; padding: 8px 12px; border-radius: 4px; }
.button:hover { background-color: #304050; }`;
const SAMPLE_BINDINGS: Record<string, string> = {
  "project.title": "示例作品标题",
  "project.author": "示例作者",
  "asset.display_name": "素材名称",
  "asset.filename": "image.png",
  "runtime.scene_title": "当前场景",
  "runtime.speaker": "角色名称",
};

function reactStyle(style: Record<string, string> | undefined): CSSProperties {
  if (!style) return {};
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [
    key.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
    ["opacity", "font-weight", "line-height", "flex"].includes(key) ? Number(value) : value,
  ])) as CSSProperties;
}

function assetDataUrl(asset: CustomComponentArchiveAssetInput): string {
  let binary = "";
  for (let offset = 0; offset < asset.bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...asset.bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${asset.mimeType};base64,${btoa(binary)}`;
}

function renderNode(
  definition: CustomComponentDefinition,
  node: CustomComponentNode,
  index: number,
  assets: ReadonlyMap<string, string>,
): ReactNode {
  if (node.tag === "img") {
    return <img key={`img-${index}`} className={node.className} aria-label={node.ariaLabel}
      alt={node.ariaLabel ?? ""} src={node.assetId ? assets.get(node.assetId) : undefined}
      data-asset-id={node.assetId}
      style={reactStyle(node.className ? definition.styles[`.${node.className}`] : undefined)} />;
  }
  const Tag = node.tag;
  const label = node.binding ? SAMPLE_BINDINGS[node.binding] : undefined;
  const classStyle = node.className ? `.${node.className}` : "";
  const attributes = {
    className: node.className,
    "aria-label": node.ariaLabel,
    "data-preview-action": node.action,
    style: reactStyle(node.className ? definition.styles[classStyle] : undefined),
    // This is an inert authoring preview, not a Runtime action surface.
    // Match the assistant preview: no form submission, focus or Editor glow.
    ...(node.tag === "button" ? { type: "button" as const, disabled: true, tabIndex: -1 } : {}),
  };
  const children = label !== undefined
      ? label
      : node.text !== undefined
        ? node.text
      : node.children.map((child, childIndex) => renderNode(definition, child, childIndex, assets));
  return <Tag key={`${node.tag}-${index}`} {...attributes}>{children}</Tag>;
}

function ComponentPreview({
  definition,
  assets = [],
}: {
  definition: CustomComponentDefinition;
  assets?: CustomComponentArchiveAssetInput[];
}) {
  const assetUrls = useMemo(() => new Map(assets.map((asset) => [asset.id, assetDataUrl(asset)])), [assets]);
  return <div className="custom-component-preview" data-testid="custom-component-preview">
    {renderNode(definition, definition.root, 0, assetUrls)}
  </div>;
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `component-${Date.now().toString(36)}`;
}

function download(bytes: Uint8Array, filename: string) {
  const blobBytes = new Uint8Array(bytes.length);
  blobBytes.set(bytes);
  const blob = new Blob([blobBytes.buffer], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function CustomComponentLibraryPanel({ onAddToProject }: {
  onAddToProject?: (record: PersonalComponentRecord) => void;
} = {}) {
  const imageInput = useRef<HTMLInputElement>(null);
  const { requestDeleteConfirmation, deleteConfirmation } = useEditorDeleteConfirmation();
  const [records, setRecords] = useState<PersonalComponentRecord[]>([]);
  const [name, setName] = useState("我的组件");
  const [html, setHtml] = useState(INITIAL_HTML);
  const [css, setCss] = useState(INITIAL_CSS);
  const [draftAssets, setDraftAssets] = useState<CustomComponentArchiveAssetInput[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewId, setPreviewId] = useState("");
  const [scan, setScan] = useState<Extract<CustomComponentArchiveScan, { ok: true }> | null>(null);
  const [scanPreviewIndex, setScanPreviewIndex] = useState(0);
  const [status, setStatus] = useState("个人组件仅保存在本机；导入包先扫描，确认后另存为副本。");
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseCustomComponentMarkup(html, css), [html, css]);
  const previewRecord = records.find((item) => item.id === previewId);
  const draftAssetIssues = useMemo(() => {
    if (!parsed.ok || !parsed.component) return [];
    const declared = new Set(draftAssets.map((asset) => asset.id));
    const referenced = new Set<string>();
    const visit = (node: CustomComponentNode) => {
      if (node.assetId) referenced.add(node.assetId);
      node.children.forEach(visit);
    };
    visit(parsed.component.root);
    return [...referenced].filter((assetId) => !declared.has(assetId))
      .map((assetId) => `图片素材“${assetId}”尚未添加到组件依赖。`);
  }, [draftAssets, parsed]);

  async function refresh() {
    setRecords(await listPersonalComponents());
  }

  useEffect(() => {
    let active = true;
    void listPersonalComponents().then((items) => { if (active) setRecords(items); })
      .catch((error: unknown) => { if (active) setStatus(error instanceof Error ? error.message : String(error)); });
    return () => { active = false; };
  }, []);

  async function saveDraft() {
    if (!parsed.ok || busy) return;
    if (draftAssetIssues.length) {
      setStatus(draftAssetIssues.join(" "));
      return;
    }
    setBusy(true);
    try {
      const record = await savePersonalComponent({
        id: makeId(),
        name: name.trim(),
        html,
        css,
        definition: parsed.component!,
        assets: draftAssets,
      });
      await refresh();
      setPreviewId(record.id);
      setStatus(`“${record.name}”已保存到本机个人组件库。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function addDraftAssets(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true);
    try {
      if (draftAssets.length + files.length > 16) throw new Error("单个组件最多包含 16 个素材。");
      const additions: CustomComponentArchiveAssetInput[] = [];
      let totalBytes = draftAssets.reduce((sum, asset) => sum + asset.bytes.byteLength, 0);
      for (const file of Array.from(files)) {
        if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type))
          throw new Error(`“${file.name}”不是受支持的 PNG、JPEG、WebP 或 GIF 图片。`);
        if (!file.size || file.size > 8 * 1024 * 1024)
          throw new Error(`“${file.name}”为空或超过单文件 8 MiB 限制。`);
        totalBytes += file.size;
        if (totalBytes > 32 * 1024 * 1024) throw new Error("组件素材总量超过 32 MiB 限制。");
        const bytes = new Uint8Array(await file.arrayBuffer());
        additions.push({
          id: `image-${makeId()}`,
          filename: file.name,
          mimeType: file.type,
          bytes,
        });
      }
      setDraftAssets((current) => [...current, ...additions]);
      setStatus(`已添加 ${additions.length} 个图片依赖；请在 HTML 中用对应 data-asset 编号引用。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function importArchive(file?: File) {
    setScan(null);
    if (!file) return;
    setBusy(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const result = await scanCustomComponentArchive(bytes);
      if (!result.ok) {
        setStatus(`组件包未通过检查：${result.issues.join(" ")}`);
        return;
      }
      setScan(result);
      setScanPreviewIndex(0);
      setStatus(`扫描通过：${result.components.length} 个组件；素材、版本与哈希已核对。确认后将作为副本加入个人库。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function confirmImport() {
    if (!scan || busy) return;
    setBusy(true);
    try {
      const copies = await importPersonalComponentCopies(scan.components);
      await refresh();
      setScan(null);
      setSelected(copies.map((item) => item.id));
      setPreviewId(copies[0]?.id ?? "");
      setStatus(`已将 ${copies.length} 个组件另存为本机副本；不会覆盖个人库原件。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function exportSelected() {
    const chosen = records.filter((item) => selected.includes(item.id));
    if (!chosen.length || busy) return;
    setBusy(true);
    try {
      const archive = await exportPersonalComponentCopies(chosen);
      download(archive, "AgentVN-个人组件.zip");
      setStatus(`已导出 ${chosen.length} 个组件及其素材。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function removeRecord(record: PersonalComponentRecord) {
    if (!await requestDeleteConfirmation(`确定从本机个人库删除“${record.name}”？工程中的副本不受影响。`)) return;
    try {
      await deletePersonalComponent(record.id);
      await refresh();
      setSelected((current) => current.filter((id) => id !== record.id));
      if (previewId === record.id) setPreviewId("");
      setStatus(`已从本机个人库删除“${record.name}”。`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  }

  return <section className="custom-component-library" data-testid="custom-component-library">
    {deleteConfirmation}
    <header>
      <div><h4>个人组件库</h4><p>受限结构与白名单动作 · 本机保存</p></div>
      <output role="status" aria-live="polite">{status}</output>
    </header>
    <div className="custom-component-author">
      <label>组件名称<input aria-label="组件名称" value={name} maxLength={160}
        onChange={(event) => setName(event.currentTarget.value)} /></label>
      <label>HTML 结构<textarea aria-label="组件 HTML" spellCheck={false} value={html}
        onChange={(event) => setHtml(event.currentTarget.value)} /></label>
      <label>CSS 样式<textarea aria-label="组件 CSS" spellCheck={false} value={css}
        onChange={(event) => setCss(event.currentTarget.value)} /></label>
      <div className="custom-component-dependencies">
        <span className="custom-component-field-label">图片依赖（仅本组件可见）</span>
        <button type="button" disabled={busy} onClick={() => imageInput.current?.click()}>添加图片依赖</button>
        <input ref={imageInput} className="custom-component-hidden-file" aria-label="添加组件图片依赖" type="file" accept="image/png,image/jpeg,image/webp,image/gif"
          multiple disabled={busy} onChange={(event) => {
            void addDraftAssets(event.currentTarget.files);
            event.currentTarget.value = "";
          }} />
        {draftAssets.map((asset) => <span key={asset.id}>
          <code>{asset.id}</code> · {asset.filename}
          <button type="button" disabled={busy} aria-label={`移除素材 ${asset.id}`}
            onClick={() => setDraftAssets((current) => current.filter((item) => item.id !== asset.id))}>移除</button>
        </span>)}
        {draftAssetIssues.length > 0 && <small role="alert">{draftAssetIssues.join(" ")}</small>}
      </div>
      <div className="custom-component-live-preview">
        <strong>安全实时预览</strong>
        {parsed.ok
          ? <ComponentPreview definition={parsed.component!} assets={draftAssets} />
          : <ul role="alert">{parsed.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      </div>
      <button type="button" data-testid="component-save"
        disabled={!parsed.ok || !name.trim() || busy || draftAssetIssues.length > 0}
        onClick={() => void saveDraft()}>保存到个人库</button>
    </div>
    <div className="custom-component-library-actions">
      <label className="custom-component-file">扫描 ZIP
        <input data-testid="component-import-file" type="file" accept=".zip,application/zip"
          disabled={busy} onChange={(event) => void importArchive(event.currentTarget.files?.[0])} />
      </label>
      <button type="button" data-testid="component-export" disabled={!selected.length || busy}
        onClick={() => void exportSelected()}>导出所选 ZIP（{selected.length}）</button>
      {scan && <button type="button" data-testid="component-confirm-import" disabled={busy}
        onClick={() => void confirmImport()}>确认导入为副本（{scan.components.length}）</button>}
    </div>
    {scan && <section className="custom-component-import-review" aria-label="导入预览">
      <label>待导入组件
        <RichSelect ariaLabel="待导入组件" value={String(scanPreviewIndex)}
          options={scan.components.map((item, index) => ({ value: String(index),
            label: `${item.name} · ${item.assets.length} 个素材` }))}
          onChange={(value) => setScanPreviewIndex(Number(value))} />
      </label>
        <ComponentPreview definition={scan.components[scanPreviewIndex]?.definition ?? scan.components[0].definition}
          assets={scan.components[scanPreviewIndex]?.assets ?? scan.components[0].assets} />
    </section>}
    <ul className="custom-component-list" aria-label="本机个人组件">
      {records.map((record) => <li key={record.id} data-testid={`component-item-${record.id}`}>
        <label><input type="checkbox" aria-label={`选择 ${record.name}`} checked={selected.includes(record.id)}
          onChange={(event) => {
            const checked = event.currentTarget.checked;
            setSelected((current) => checked
              ? [...current, record.id] : current.filter((id) => id !== record.id));
          }} />
          <span>{record.name}</span></label>
        <button type="button" onClick={() => setPreviewId(record.id)}>预览</button>
        {onAddToProject && <button
          type="button"
          aria-label={`添加 ${record.name} 到当前页面`}
          title="复制到当前工程页面；只复制当前组件实际引用的素材依赖。"
          onClick={() => {
            try {
              onAddToProject(record);
              setStatus(`“${record.name}”已复制到当前工程页面；工程副本与个人库原件相互独立。`);
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          }}
        >添加到当前页</button>}
        <button type="button" aria-label={`删除 ${record.name}`} onClick={() => void removeRecord(record)}>删除</button>
      </li>)}
    </ul>
    {previewRecord && <section className="custom-component-saved-preview" aria-label="个人组件预览">
      <h5>{previewRecord.name}</h5>
      <ComponentPreview definition={previewRecord.definition} assets={previewRecord.assets ?? []} />
      {(previewRecord.assets?.length ?? 0) > 0
        && <small>包含 {previewRecord.assets?.length ?? 0} 个已校验素材，已关联到预览。</small>}
    </section>}
  </section>;
}
