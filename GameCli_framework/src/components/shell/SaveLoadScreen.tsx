import { ArrowLeft, FolderOpen, Save, Trash2, Upload } from "lucide-react";
import { useMemo, useState } from "react";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { SaveData, SaveKind, SaveSlotRef } from "../../types/save";
import { useUILayoutStyle } from "../../uiSkin/uiSkinRuntime";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { Modal } from "../common/Modal";

const MANUAL_SLOT_COUNT = 12;
const AUTO_SLOT_COUNT = 8;
const COPY = {
  unknownScene: "\u672a\u77e5\u573a\u666f",
  archiveTitle: "\u5b58\u6863 / \u8bfb\u6863",
  backToLibrary: "\u8fd4\u56de\u6e38\u620f\u5e93",
  noGameTitle: "\u5c1a\u672a\u9009\u62e9\u6e38\u620f",
  noGameDescription: "\u8bf7\u5148\u4ece\u6e38\u620f\u5e93\u542f\u52a8\u4e00\u90e8\u4f5c\u54c1\uff0c\u518d\u7ba1\u7406\u5b83\u7684\u5b58\u6863\u3002",
  saveProgress: "\u4fdd\u5b58\u8fdb\u5ea6",
  loadProgress: "\u8bfb\u53d6\u5b58\u6863",
  chooseSaveSlot: "\u9009\u62e9\u4e00\u4e2a\u5b58\u6863\u69fd\u8fdb\u884c\u4fdd\u5b58",
  cannotSave: "\u5f53\u524d\u5267\u60c5\u72b6\u6001\u65e0\u6cd5\u4fdd\u5b58",
  chooseManualSave: "\u9009\u62e9\u4e00\u4e2a\u624b\u52a8\u5b58\u6863\u8bfb\u53d6",
  chooseAutoSave: "\u9009\u62e9\u4e00\u4e2a\u81ea\u52a8\u5b58\u6863\u8bfb\u53d6",
  noPreview: "\u6682\u65e0\u9884\u89c8\u56fe",
  clickToSave: "\u70b9\u51fb\u4fdd\u5b58",
  emptySlot: "\u7a7a\u69fd\u4f4d",
  archive: "\u5b58\u6863",
  storyProgress: "\u5267\u60c5\u8fdb\u5ea6",
  notSaved: "\u5c1a\u672a\u4fdd\u5b58",
  emptyArchiveSlot: "\u7a7a\u5b58\u6863\u69fd",
  delete: "\u5220\u9664",
  load: "\u8bfb\u53d6",
  deleteArchive: "\u5220\u9664\u5b58\u6863",
  deleteConfirmation: "\u786e\u5b9a\u8981\u5220\u9664\u8fd9\u4e2a\u5b58\u6863\u5417\uff1f\u5220\u9664\u540e\u65e0\u6cd5\u6062\u590d\u3002",
  cancel: "\u53d6\u6d88",
  confirmDelete: "\u786e\u8ba4\u5220\u9664",
} as const;

export function SaveLoadScreen() {
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const engineState = useRuntimeStore((state) => state.engineState);
  const saves = useRuntimeStore((state) => state.saves);
  const saveNotice = useRuntimeStore((state) => state.saveNotice);
  const save = useRuntimeStore((state) => state.save);
  const load = useRuntimeStore((state) => state.load);
  const deleteSaveSlot = useRuntimeStore((state) => state.deleteSaveSlot);
  const closeMenu = useRuntimeStore((state) => state.closeMenu);
  const openLibrary = useRuntimeStore((state) => state.openLibrary);
  const gridLayout = useUILayoutStyle("save_load", "save_slot_grid");
  const [mode, setMode] = useState<"save" | "load">("save");
  const [kind, setKind] = useState<SaveKind>("manual");
  const [pendingDelete, setPendingDelete] = useState<SaveSlotRef>();
  const [busy, setBusy] = useState("");
  const canSave = Boolean(engineState.currentSceneId) && !engineState.isEnded;
  const visible = useMemo(() => saves.filter((item) => (item.save_kind ?? "manual") === kind), [kind, saves]);
  const slotCount = kind === "auto" ? AUTO_SLOT_COUNT : MANUAL_SLOT_COUNT;
  const itemFor = (slot: number) => visible.find((item) => item.slot === slot);
  const refFor = (slot: number): SaveSlotRef => ({ kind, slot });
  const title = (sceneId: string) => currentGame?.script.scenes.find((scene) => scene.scene_id === sceneId)?.title ?? COPY.unknownScene;
  const idleStatus = mode === "save"
    ? canSave ? COPY.chooseSaveSlot : COPY.cannotSave
    : kind === "auto" ? COPY.chooseAutoSave : COPY.chooseManualSave;
  async function run(ref: SaveSlotRef, action: () => Promise<void>) { setBusy(`${ref.kind}:${ref.slot}`); try { await action(); } finally { setBusy(""); } }
  function activate(ref: SaveSlotRef, item?: SaveData) {
    if (mode === "save") { if (!canSave || ref.kind === "auto") return; void run(ref, () => save(ref)); }
    else if (item) void run(ref, () => load(ref));
  }
  if (!currentGame) return <main className="screen-panel"><header><h2>{COPY.archiveTitle}</h2><Button onClick={openLibrary}><ArrowLeft size={17} /> {COPY.backToLibrary}</Button></header><EmptyState title={COPY.noGameTitle} description={COPY.noGameDescription} /></main>;
  return <main className="screen-panel save-load-screen">
    <header className="save-load-header"><div><span className="panel-kicker">SAVE ARCHIVE</span><h2>{mode === "save" ? COPY.saveProgress : COPY.loadProgress}</h2></div><Button className="icon-button" variant="ghost" aria-label={"\u8fd4\u56de"} data-testid="back-to-player" onClick={closeMenu}><ArrowLeft size={18} aria-hidden="true" /></Button></header>
    <section className="save-load-toolbar" aria-label={"\u5b58\u8bfb\u6863\u63a7\u5236"}><div className="save-mode-switch" role="group"><Button variant="ghost" active={mode === "save"} disabled={!canSave} onClick={() => setMode("save")}><Save size={16} /> {"\u4fdd\u5b58"}</Button><Button variant="ghost" active={mode === "load"} onClick={() => setMode("load")}><FolderOpen size={16} /> {"\u8bfb\u53d6"}</Button></div><div className="save-kind-tabs" role="tablist"><button role="tab" aria-selected={kind === "manual"} onClick={() => { setKind("manual"); setMode("save"); }}>{"\u624b\u52a8\u5b58\u6863"} <span>{saves.filter((x) => (x.save_kind ?? "manual") === "manual").length}/{MANUAL_SLOT_COUNT}</span></button><button role="tab" aria-selected={kind === "auto"} disabled={mode === "save"} onClick={() => { setKind("auto"); setMode("load"); }}>{"\u81ea\u52a8\u5b58\u6863"} <span>{saves.filter((x) => x.save_kind === "auto").length}/{AUTO_SLOT_COUNT}</span></button></div><span className={`save-operation-status is-${saveNotice?.status ?? "idle"}`} role="status">{saveNotice?.message ?? idleStatus}</span></section>
    <div className="save-grid ui-layouted" style={gridLayout.style} data-testid="save-slot-grid">{Array.from({ length: slotCount }, (_, i) => { const slot = i + 1; const ref = refFor(slot); const item = itemFor(slot); const isBusy = busy === `${kind}:${slot}`; return <article className={`save-slot save-film-card ${item ? "has-save" : "is-empty"}`} data-testid={`save-slot-${kind}-${slot}`} key={slot}><button className="save-card-main" type="button" disabled={isBusy || (mode === "load" && !item) || (mode === "save" && (!canSave || kind === "auto"))} aria-label={item ? (mode === "save" ? `\u8986\u76d6${kind === "auto" ? "\u81ea\u52a8" : "\u624b\u52a8"}\u5b58\u6863 ${slot}` : `\u8bfb\u53d6${kind === "auto" ? "\u81ea\u52a8" : "\u624b\u52a8"}\u5b58\u6863 ${slot}`) : `\u4fdd\u5b58\u5230\u624b\u52a8\u5b58\u6863 ${slot}`} onClick={() => activate(ref, item)}><span className="save-preview-frame">{item?.preview_image ? <img src={item.preview_image} alt="" /> : <span className="save-preview-placeholder"><Save size={30} aria-hidden="true" /><small>{item ? COPY.noPreview : mode === "save" ? COPY.clickToSave : COPY.emptySlot}</small></span>}<span className="save-slot-number">{kind === "auto" ? "AUTO" : "FILE"} {String(slot).padStart(2, "0")}</span></span><span className="save-card-copy"><strong>{item ? title(item.scene_id) : `${COPY.archive} ${String(slot).padStart(2, "0")}`}</strong><span>{item?.dialog?.text ?? (item ? `${COPY.storyProgress} #${item.command_index}` : COPY.notSaved)}</span><small>{item ? new Date(item.created_at).toLocaleString() : COPY.emptyArchiveSlot}</small></span></button>{item && mode === "load" && <Button variant="ghost" onClick={() => setPendingDelete(ref)}><Trash2 size={16} /> {COPY.delete}</Button>}{item && mode === "load" && <Button variant="ghost" onClick={() => void run(ref, () => load(ref))}><Upload size={16} /> {COPY.load}</Button>}</article>; })}</div>
    {pendingDelete && <Modal title={COPY.deleteArchive} onClose={() => setPendingDelete(undefined)}><p>{COPY.deleteConfirmation}</p><div className="modal-actions"><Button variant="ghost" onClick={() => setPendingDelete(undefined)}>{COPY.cancel}</Button><Button variant="primary" onClick={() => void run(pendingDelete, async () => { await deleteSaveSlot(pendingDelete); setPendingDelete(undefined); })}><Trash2 size={16} /> {COPY.confirmDelete}</Button></div></Modal>}
  </main>;
}
