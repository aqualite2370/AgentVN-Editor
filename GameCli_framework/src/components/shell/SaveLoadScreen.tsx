import { FolderOpen, Save, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { QUICK_SAVE_SLOT_COUNT } from "../../utils/quickSavePolicy";
import { useRuntimeStore } from "../../store/runtimeStore";
import type { SaveData, SaveKind, SaveSlotRef } from "../../types/save";
import { useRenpyButtonRoleStyle, useRuntimeUILayout, useUILayoutStyle, useUILayoutFrameSize } from "../../uiSkin/uiSkinRuntime";
import { UILayoutOpacitySurface } from "../../uiSkin/UILayoutOpacitySurface";
import { resolveRenpySaveGrid } from "../../../../shared/cartridge/renpyGui";
import { Button } from "../common/Button";
import { EmptyState } from "../common/EmptyState";
import { Modal } from "../common/Modal";
import { ScreenBackButton } from "./ScreenBackButton";
import { RenpyMenuFrame } from "./RenpyMenuFrame";
import { SavePageTransition, type SavePageTransitionHandle } from "./SavePageTransition";

const MANUAL_SLOT_COUNT = 12;
const AUTO_SLOT_COUNT = 8;
const PAGE_SIZE = 6;
const kindLabel: Record<SaveKind, string> = { manual: "手动", auto: "自动", quick: "快存" };
const COPY = {
  unknownScene: "未知场景",
  backToLibrary: "返回游戏库",
  noGameTitle: "尚未选择游戏",
  noGameDescription: "请先从游戏库启动一部作品，再管理它的存档。",
  chooseSaveSlot: "选择一个存档槽进行保存",
  cannotSave: "当前剧情状态无法保存",
  archive: "存档",
  delete: "删除",
  deleteArchive: "删除存档",
  deleteConfirmation: "确定要删除这个存档吗？删除后无法恢复。",
  cancel: "取消",
  confirmDelete: "确认删除",
} as const;

export function SaveLoadScreen() {
  const currentGame = useRuntimeStore((state) => state.currentGame);
  const engineState = useRuntimeStore((state) => state.engineState);
  const launchTransition = useRuntimeStore((state) => state.launchTransition);
  const entryError = useRuntimeStore((state) => state.entryError);
  const returnScreen = useRuntimeStore((state) => state.returnScreen);
  const galleryReplayActive = useRuntimeStore((state) => state.galleryReplayActive);
  const saves = useRuntimeStore((state) => state.saves);
  const saveNotice = useRuntimeStore((state) => state.saveNotice);
  const saveStorageInfo = useRuntimeStore((state) => state.saveStorageInfo);
  const saveMigrationError = useRuntimeStore((state) => state.saveMigrationError);
  const saveMigrationPending = useRuntimeStore((state) => state.saveMigrationPending);
  const openSaveMigration = useRuntimeStore((state) => state.openSaveMigration);
  const save = useRuntimeStore((state) => state.save);
  const load = useRuntimeStore((state) => state.load);
  const deleteSaveSlot = useRuntimeStore((state) => state.deleteSaveSlot);
  const upgradeSavePreviews = useRuntimeStore((state) => state.upgradeSavePreviews);
  const closeMenu = useRuntimeStore((state) => state.closeMenu);
  const openLibrary = useRuntimeStore((state) => state.openLibrary);
  const gridLayout = useUILayoutStyle("save_load", "save_slot_grid");
  const runtimeLayout = useRuntimeUILayout();
  const categoryRole = useRenpyButtonRoleStyle("category_pagination", "save_load", "var(--renpy-menu-scale)");
  const isRenpyLayout = runtimeLayout.layout_type === "renpy";
  const frame = useUILayoutFrameSize();
  const renpySaveGrid = resolveRenpySaveGrid(runtimeLayout.renpy, {
    saveColumns: gridLayout.component?.style?.columns,
    saveGap: gridLayout.component?.style?.gap,
  });
  const hasGapOverride = runtimeLayout.renpy?.save_load?.saveGap !== undefined
    || runtimeLayout.renpy?.shared?.saveGap !== undefined;
  const hasColumnsOverride = runtimeLayout.renpy?.save_load?.saveColumns !== undefined
    || runtimeLayout.renpy?.shared?.saveColumns !== undefined;
  const renpyGridStyle = runtimeLayout.layout_type === "renpy" ? {
    "--renpy-save-columns": renpySaveGrid.saveColumns,
    gridTemplateColumns: hasColumnsOverride ? `repeat(${renpySaveGrid.saveColumns}, minmax(0, 1fr))`
      : gridLayout.style.gridTemplateColumns ?? `repeat(${renpySaveGrid.saveColumns}, minmax(0, 1fr))`,
    // Inherited component spacing retains the established viewport scale.
    gap: hasGapOverride ? `${renpySaveGrid.saveGap}px` : gridLayout.style.gap ?? `${renpySaveGrid.saveGap}px`,
  } as CSSProperties : undefined;
  const [mode, setMode] = useState<"save" | "load">(() => returnScreen === "playing" ? "save" : "load");
  const [kind, setKind] = useState<SaveKind>("manual");
  const [pendingDelete, setPendingDelete] = useState<SaveSlotRef>();
  const [busy, setBusy] = useState("");
  const inFlight = useRef(false);
  const [operationError, setOperationError] = useState<string>();
  const [page, setPage] = useState(0);
  const pageTransition = useRef<SavePageTransitionHandle>(null);
  const pageNavigation = useRef<HTMLElement>(null);
  const paginationFocus = useRef(false);
  const canSave = Boolean(engineState.currentSceneId) && !engineState.isEnded && !galleryReplayActive;
  const visible = useMemo(() => saves.filter((item) => (item.save_kind ?? "manual") === kind), [kind, saves]);
  const slotCount = kind === "auto" ? AUTO_SLOT_COUNT : kind === "quick" ? QUICK_SAVE_SLOT_COUNT : MANUAL_SLOT_COUNT;
  const pageCount = Math.ceil(slotCount / PAGE_SIZE);
  const visibleSlots = Array.from({ length: Math.min(PAGE_SIZE, slotCount - page * PAGE_SIZE) },
    (_, index) => page * PAGE_SIZE + index + 1);
  const gridColumns = isRenpyLayout ? renpySaveGrid.saveColumns
    : Math.max(1, Math.round(gridLayout.component?.style?.columns ?? 3));
  const pageGridStyle = {
    ...gridLayout.style,
    ...renpyGridStyle,
    // Keep the same cell budget on partially filled pages too. Metadata uses
    // its natural height; previews share the remaining bounded row space.
    "--save-grid-rows": Math.ceil(PAGE_SIZE / gridColumns),
  } as CSSProperties;
  const itemFor = (slot: number) => visible.find((item) => item.slot === slot);
  const refFor = (slot: number): SaveSlotRef => ({ kind, slot });
  const title = (sceneId: string) => currentGame?.script.scenes.find((scene) => scene.scene_id === sceneId)?.title ?? COPY.unknownScene;
  const idleStatus = mode === "save" && canSave ? COPY.chooseSaveSlot : mode === "save" ? COPY.cannotSave : "";
  function changePage(next: number) {
    if (next === page) return;
    paginationFocus.current = Boolean(pageNavigation.current?.contains(document.activeElement));
    pageTransition.current?.prepare(next > page ? 1 : -1);
    setPage(next);
  }
  useLayoutEffect(() => {
    if (!paginationFocus.current) return;
    paginationFocus.current = false;
    const active = document.activeElement;
    if (!(active instanceof HTMLButtonElement) || active.disabled)
      pageNavigation.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus({ preventScroll: true });
  }, [page]);
  function changeKind(next: SaveKind) {
    if (next === kind) return;
    pageTransition.current?.prepare(1);
    setKind(next);
    setPage(0);
    setMode(next === "manual" && canSave ? "save" : "load");
  }

  useEffect(() => {
    void upgradeSavePreviews();
  }, [upgradeSavePreviews]);

  async function run(ref: SaveSlotRef, action: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setOperationError(undefined);
    setBusy(`${ref.kind}:${ref.slot}`);
    try {
      await action();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      inFlight.current = false;
      setBusy("");
    }
  }

  function activate(ref: SaveSlotRef, item?: SaveData) {
    if (launchTransition !== "idle") return;
    if (mode === "save") {
      if (!canSave || ref.kind !== "manual") return;
      void run(ref, () => save(ref));
    } else if (item) {
      void run(ref, () => load(ref));
    }
  }

  if (!currentGame) {
    return (
      <main className="screen-panel">
        <header><ScreenBackButton testId="back-to-library" label={COPY.backToLibrary} onClick={openLibrary} /></header>
        <EmptyState title={COPY.noGameTitle} description={COPY.noGameDescription} />
      </main>
    );
  }

  return (
    <RenpyMenuFrame activeScreen="save_load" className={`screen-panel save-load-screen${frame.height < 360 ? " is-compact-save-layout" : ""}`}>
      {!isRenpyLayout && <header className="save-load-header"><ScreenBackButton testId="back-to-player" onClick={closeMenu} /></header>}
      <section className="save-load-toolbar" aria-label="存读档控制">
        <div className="save-mode-switch" role="group">
          <Button variant="ghost" active={mode === "save"} disabled={!canSave || launchTransition !== "idle" || kind !== "manual"}
            className={categoryRole.enabled ? "renpy-role-custom-control" : ""}
            data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
            data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
            data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
            data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
            data-renpy-role-state={!canSave || launchTransition !== "idle" || kind !== "manual" ? "disabled" : mode === "save" ? "selected" : "normal"}
            style={categoryRole.enabled ? categoryRole.style : undefined} onClick={() => setMode("save")}>
            <Save size={16} /> 保存
          </Button>
          <Button variant="ghost" active={mode === "load"} disabled={launchTransition !== "idle"}
            className={categoryRole.enabled ? "renpy-role-custom-control" : ""}
            data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
            data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
            data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
            data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
            data-renpy-role-state={launchTransition !== "idle" ? "disabled" : mode === "load" ? "selected" : "normal"}
            style={categoryRole.enabled ? categoryRole.style : undefined} onClick={() => setMode("load")}>
            <FolderOpen size={16} /> 读取
          </Button>
        </div>
        <div className="save-kind-tabs" role="tablist">
          <button className={`ui-button ghost save-kind-tab${categoryRole.enabled ? " renpy-role-custom-control" : ""}`}
            role="tab" aria-selected={kind === "manual"} disabled={!!busy || launchTransition !== "idle"}
            data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
            data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
            data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
            data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
            data-renpy-role-state={busy || launchTransition !== "idle" ? "disabled" : kind === "manual" ? "selected" : "normal"}
            style={categoryRole.enabled ? categoryRole.style : undefined}
            onClick={() => changeKind("manual")}>手动</button>
          <button className={`ui-button ghost save-kind-tab${categoryRole.enabled ? " renpy-role-custom-control" : ""}`}
            role="tab" aria-selected={kind === "auto"} disabled={!!busy || launchTransition !== "idle"}
            data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
            data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
            data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
            data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
            data-renpy-role-state={busy || launchTransition !== "idle" ? "disabled" : kind === "auto" ? "selected" : "normal"}
            style={categoryRole.enabled ? categoryRole.style : undefined}
            onClick={() => changeKind("auto")}>自动</button>
          <button className={`ui-button ghost save-kind-tab${categoryRole.enabled ? " renpy-role-custom-control" : ""}`}
            role="tab" aria-selected={kind === "quick"} disabled={!!busy || launchTransition !== "idle"}
            data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
            data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
            data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
            data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
            data-renpy-role-state={busy || launchTransition !== "idle" ? "disabled" : kind === "quick" ? "selected" : "normal"}
            style={categoryRole.enabled ? categoryRole.style : undefined}
            onClick={() => changeKind("quick")}>快存</button>
        </div>
        {(saveStorageInfo?.portable || saveMigrationError) && <Button variant="ghost"
          className="save-storage-location" data-testid="save-storage-open"
          disabled={!!busy || launchTransition !== "idle"} aria-busy={saveMigrationPending}
          onClick={() => void openSaveMigration()}>存档位置／旧档迁移</Button>}
        <span className={`save-operation-status visually-hidden is-${saveNotice?.status ?? "idle"}`} role="status">
          {entryError ?? saveNotice?.message ?? idleStatus}
        </span>
      </section>
      {operationError && <p className="save-operation-error" role="alert">{operationError}</p>}
      <nav className="save-page-navigation" aria-label="存档分页" ref={pageNavigation}>
        <Button variant="ghost" data-testid="save-page-previous" disabled={!!busy || page === 0 || launchTransition !== "idle"}
          className={categoryRole.enabled ? "renpy-role-custom-control" : ""}
          data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
          data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
          data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
          data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
          data-renpy-role-state={busy || page === 0 || launchTransition !== "idle" ? "disabled" : "normal"}
          style={categoryRole.enabled ? categoryRole.style : undefined}
          onClick={() => changePage(page - 1)}>上一页</Button>
        <span aria-live="polite">{page + 1} / {pageCount}</span>
        <Button variant="ghost" data-testid="save-page-next" disabled={!!busy || page + 1 >= pageCount || launchTransition !== "idle"}
          className={categoryRole.enabled ? "renpy-role-custom-control" : ""}
          data-renpy-role-custom={categoryRole.enabled ? "true" : undefined}
          data-renpy-role-styled={categoryRole.styled ? "true" : undefined}
          data-renpy-role-bordered={categoryRole.bordered ? "true" : undefined}
          data-renpy-role-opacity={categoryRole.opacityConfigured ? "true" : undefined}
          data-renpy-role-state={busy || page + 1 >= pageCount || launchTransition !== "idle" ? "disabled" : "normal"}
          style={categoryRole.enabled ? categoryRole.style : undefined}
          onClick={() => changePage(page + 1)}>下一页</Button>
      </nav>
      <SavePageTransition ref={pageTransition} pageKey={`${kind}:${page}`}>
      <UILayoutOpacitySurface className="save-grid ui-layouted" presentationComponent={gridLayout.component} style={pageGridStyle}
        data-renpy-grid-columns-override={runtimeLayout.layout_type === "renpy" && hasColumnsOverride ? "true" : undefined}
        data-testid="save-slot-grid" data-renpy-save-columns={runtimeLayout.layout_type === "renpy" ? renpySaveGrid.saveColumns : undefined}
        data-renpy-save-gap={runtimeLayout.layout_type === "renpy" ? renpySaveGrid.saveGap : undefined}>
        {visibleSlots.map((slot) => {
          const ref = refFor(slot);
          const item = itemFor(slot);
          const isBusy = busy === `${kind}:${slot}`;
          const isEntryBusy = launchTransition !== "idle";
          return (
            <article className={`save-slot save-film-card ${item ? "has-save" : "is-empty"}`} data-testid={`save-slot-${kind}-${slot}`} key={slot}>
              <button
                className="save-card-main"
                type="button"
                disabled={!!busy || isEntryBusy || (mode === "load" && !item) || (mode === "save" && (!canSave || kind !== "manual"))}
                aria-busy={isBusy || isEntryBusy || undefined}
                aria-label={item
                  ? mode === "save"
                    ? `覆盖${kindLabel[kind]}存档 ${slot}`
                    : `读取${kindLabel[kind]}存档 ${slot}`
                  : `保存到手动存档 ${slot}`}
                onClick={() => activate(ref, item)}
              >
                <span className="save-preview-frame">
                  {item?.preview_image ? <img src={item.preview_image} alt="" /> : <span className="save-preview-placeholder"><Save size={30} aria-hidden="true" /></span>}
                </span>
                <span className="save-card-copy">
                  <strong>{kind === "manual" ? COPY.archive : kindLabel[kind]} {String(slot).padStart(2, "0")}</strong>
                  {item && <><span>{title(item.scene_id)}</span><small>{new Date(item.created_at).toLocaleString()}</small></>}
                </span>
              </button>
              {item && mode === "load" && (
                <Button
                  className="save-delete-button"
                  variant="ghost"
                  aria-label={COPY.delete}
                  disabled={!!busy || isEntryBusy}
                  onClick={(event) => { event.stopPropagation(); setPendingDelete(ref); }}
                >
                  <Trash2 size={16} />
                </Button>
              )}
            </article>
          );
        })}
      </UILayoutOpacitySurface>
      </SavePageTransition>
      {pendingDelete && (
        <Modal title={COPY.deleteArchive} onClose={() => { if (!busy) setPendingDelete(undefined); }}>
          <p>{COPY.deleteConfirmation}</p>
          <div className="modal-actions">
            <Button variant="ghost" disabled={!!busy} onClick={() => setPendingDelete(undefined)}>{COPY.cancel}</Button>
            <Button variant="primary" loading={!!busy} onClick={() => void run(pendingDelete, async () => { await deleteSaveSlot(pendingDelete); setPendingDelete(undefined); })}>
              <Trash2 size={16} /> {COPY.confirmDelete}
            </Button>
          </div>
        </Modal>
      )}
    </RenpyMenuFrame>
  );
}
