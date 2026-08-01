import { Camera, GripVertical, MoreHorizontal, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import type { GameCommand } from "../../types/commands";
import { commandLabels, commandSummary } from "../../utils/commandTools";
import { DialogCommandEditor } from "./DialogCommandEditor";
import { NarrationCommandEditor } from "./NarrationCommandEditor";
import { BackgroundCommandEditor } from "./BackgroundCommandEditor";
import { ShowImageCommandEditor } from "./ShowImageCommandEditor";
import { VideoCommandEditor } from "./VideoCommandEditor";
import { SpriteCommandEditor } from "./SpriteCommandEditor";
import { ChoiceCommandEditor } from "./ChoiceCommandEditor";
import { StateUpdateCommandEditor } from "./StateUpdateCommandEditor";
import { ConditionalJumpCommandEditor } from "./ConditionalJumpCommandEditor";
import { JumpCommandEditor } from "./JumpCommandEditor";
import { AnimationCommandEditor } from "./AnimationCommandEditor";
import { BgmCommandEditor } from "./BgmCommandEditor";
import { SfxCommandEditor } from "./SfxCommandEditor";
import { CameraCommandEditor } from "./CameraCommandEditor";
import { WaitCommandEditor } from "./WaitCommandEditor";
import { CameraStudioDialog } from "./CameraStudioDialog";
import {
  DEFAULT_CAMERA_POSE,
  createDefaultCameraCommand,
  isStructuredCameraCommand,
  type CameraPoseV1,
} from "../../../../shared/camera/cameraMotion";

const maxExpanded = 3;
const dropAnimationMs = 220;

interface CommandDragState {
  from: number;
  over: number;
  pointerId: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  sourceRect: DOMRect;
  isDropping: boolean;
  dropX?: number;
  dropY?: number;
}

function commandKey(command: GameCommand, index: number): string {
  return `${index}:${command.type}`;
}

function moveItem<T>(items: T[], from: number, to: number): T[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export function currentPoseBeforeList(commands: GameCommand[], commandIndex: number): CameraPoseV1 {
  let pose = { ...DEFAULT_CAMERA_POSE };
  for (const command of commands.slice(0, commandIndex)) {
    if (!isStructuredCameraCommand(command)) continue;
    if (command.motion.kind === "reset") pose = { ...DEFAULT_CAMERA_POSE };
    if (command.motion.kind === "reframe") pose = { ...command.motion.to };
    if (command.motion.kind === "sequence") {
      const lastShot = command.motion.shots[command.motion.shots.length - 1];
      if (lastShot) pose = { ...lastShot.to };
    }
  }
  return pose;
}

export function CommandListEditor({
  commands,
  sceneId = "",
  variableKeys = [],
  sceneIds = [],
  onChange,
}: {
  commands: GameCommand[];
  sceneId?: string;
  variableKeys?: string[];
  sceneIds?: string[];
  onChange: (commands: GameCommand[]) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const previousLengthRef = useRef(commands.length);
  const keys = useMemo(() => commands.map(commandKey), [commands]);
  const [expandedKeys, setExpandedKeys] = useState<string[]>([]);
  const [dragState, setDragState] = useState<CommandDragState | null>(null);
  const dragStateRef = useRef<CommandDragState | null>(null);
  const [menuKey, setMenuKey] = useState<string>();
  const [lastAddedKey, setLastAddedKey] = useState<string>();
  const [insertStudioIndex, setInsertStudioIndex] = useState<number>();
  const dropTimerRef = useRef<number>();
  const prefersReducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches,
    []
  );

  useEffect(() => {
    setExpandedKeys((current) => current.filter((key) => keys.includes(key)).slice(-maxExpanded));
  }, [keys]);

  useEffect(() => {
    if (commands.length <= previousLengthRef.current) {
      previousLengthRef.current = commands.length;
      return;
    }
    const addedKey = keys[keys.length - 1];
    setLastAddedKey(addedKey);
    setExpandedKeys((current) => [...current.filter((key) => key !== addedKey), addedKey].slice(-maxExpanded));
    window.requestAnimationFrame(() => {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      window.setTimeout(() => setLastAddedKey(undefined), 900);
    });
    previousLengthRef.current = commands.length;
  }, [commands.length, keys]);

  useEffect(() => {
    return () => {
      if (dropTimerRef.current) window.clearTimeout(dropTimerRef.current);
    };
  }, []);

  const update = (index: number, command: GameCommand) => onChange(commands.map((item, itemIndex) => itemIndex === index ? command : item));

  function toggleExpanded(key: string) {
    setExpandedKeys((current) => {
      if (current.includes(key)) return current.filter((item) => item !== key);
      return [...current, key].slice(-maxExpanded);
    });
  }

  function dragOverIndex(clientY: number, from: number): number {
    const cards = Array.from(listRef.current?.querySelectorAll<HTMLElement>(".command-card") ?? [])
      .filter((card) => Number(card.dataset.commandIndex) !== from);
    const passedCards = cards.filter((card) => {
      const rect = (card.querySelector<HTMLElement>(".command-card-header") ?? card).getBoundingClientRect();
      return clientY > rect.top + rect.height / 2;
    });
    return Math.max(0, Math.min(commands.length - 1, passedCards.length));
  }

  function dragTargetRect(to: number): DOMRect | undefined {
    const list = listRef.current;
    if (!list || !dragState) return undefined;
    const cards = Array.from(list.querySelectorAll<HTMLElement>(".command-card"));
    const source = cards[dragState.from];
    if (to === dragState.from) return source?.getBoundingClientRect();
    const target = cards[to];
    if (target) {
      const rect = target.getBoundingClientRect();
      const header = target.querySelector<HTMLElement>(".command-card-header")?.getBoundingClientRect();
      if (dragState.from < to && header) {
        return new DOMRect(rect.left, header.bottom - dragState.sourceRect.height, rect.width, dragState.sourceRect.height);
      }
      return new DOMRect(rect.left, header?.top ?? rect.top, rect.width, dragState.sourceRect.height);
    }
    const listRect = list.getBoundingClientRect();
    return new DOMRect(listRect.left, listRect.bottom - dragState.sourceRect.height, dragState.sourceRect.width, dragState.sourceRect.height);
  }

  function startDrag(index: number, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    const card = event.currentTarget.closest<HTMLElement>(".command-card");
    if (!card) return;
    const sourceRect = card.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    setMenuKey(undefined);
    const nextState = {
      from: index,
      over: index,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
      grabOffsetX: event.clientX - sourceRect.left,
      grabOffsetY: event.clientY - sourceRect.top,
      sourceRect,
      isDropping: false,
    };
    dragStateRef.current = nextState;
    setDragState(nextState);
  }

  useEffect(() => {
    if (!dragState || dragState.isDropping) return;
    const pointerId = dragState.pointerId;

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      const current = dragStateRef.current;
      if (!current || current.isDropping) return;
      const nextState = {
        ...current,
        currentX: event.clientX,
        currentY: event.clientY,
        over: dragOverIndex(event.clientY, current.from),
      };
      dragStateRef.current = nextState;
      setDragState(nextState);
    }

    function handlePointerUp(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      finishDrag(dragStateRef.current);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [dragState?.isDropping, dragState?.pointerId]);

  function commitDrag(state: CommandDragState, to: number) {
    if (to !== state.from) {
      onChange(moveItem(commands, state.from, to));
    }
    dragStateRef.current = null;
    setDragState(null);
  }

  function finishDrag(current: CommandDragState | null) {
    if (!current || current.isDropping) return;
    const to = Math.max(0, Math.min(commands.length - 1, current.over));
    if (prefersReducedMotion) {
      commitDrag(current, to);
      return;
    }
    const targetRect = dragTargetRect(to) ?? current.sourceRect;
    const nextState = {
      ...current,
      over: to,
      isDropping: true,
      dropX: targetRect.left,
      dropY: targetRect.top,
    };
    dragStateRef.current = nextState;
    setDragState(nextState);
    if (dropTimerRef.current) window.clearTimeout(dropTimerRef.current);
    dropTimerRef.current = window.setTimeout(() => {
      commitDrag(nextState, to);
      dropTimerRef.current = undefined;
    }, dropAnimationMs);
  }

  return (
    <div className={`command-list${dragState ? " is-sorting" : ""}`} ref={listRef}>
      {commands.map((command, index) => {
        const key = keys[index];
        const expanded = expandedKeys.includes(key);
        const menuOpen = menuKey === key;
        const dragActive = dragState?.from === index;
        const dragDirection = dragState ? Math.sign(dragState.over - dragState.from) : 0;
        const displacedDown = Boolean(dragState && dragState.from > dragState.over && index >= dragState.over && index < dragState.from);
        const displacedUp = Boolean(dragState && dragState.from < dragState.over && index > dragState.from && index <= dragState.over);
        return (
          <Fragment key={key}>
            <div className="camera-command-insert">
              <button type="button" onClick={() => setInsertStudioIndex(index)}>
                <Camera size={13} aria-hidden="true" />
                <span className="camera-command-insert-label">＋ 运镜</span>
              </button>
            </div>
            <section
            className={`command-card ${expanded ? "is-expanded" : "is-collapsed"} ${lastAddedKey === key ? "is-new" : ""} ${dragActive ? "is-drag-placeholder" : ""} ${displacedDown ? "is-displaced-down" : ""} ${displacedUp ? "is-displaced-up" : ""}`}
            data-command-index={index}
            data-drag-direction={dragDirection}
          >
            <header className="command-card-header">
              <button type="button" className="command-drag-handle" aria-label="拖拽排序事件卡片" data-help-key="command.drag" onPointerDown={(event) => startDrag(index, event)}>
                <GripVertical size={16} />
              </button>
              <button type="button" className="command-card-summary" data-help-key="command.expand" onClick={() => toggleExpanded(key)}>
                <strong>{index + 1}. {commandLabels[command.type]}</strong>
                <span>{commandSummary(command)}</span>
              </button>
              <div className="command-card-menu">
                <button type="button" aria-label="事件操作" data-help-key="command.more" onClick={() => setMenuKey(menuOpen ? undefined : key)}>
                  <MoreHorizontal size={16} />
                </button>
                {menuOpen && (
                  <div className="command-card-menu-popover">
                    <button type="button" data-help-key="command.delete" onClick={() => onChange(commands.filter((_, itemIndex) => itemIndex !== index))}>
                      <Trash2 size={14} /> 删除事件
                    </button>
                  </div>
                )}
              </div>
            </header>
            {expanded && (
              <div className="command-card-body">
                {command.type === "dialog" && <DialogCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "narration" && <NarrationCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "hide_dialog" && <p className="workbench-note">播放到这里时会隐藏当前对白或旁白框，并立即继续下一事件。</p>}
                {command.type === "background" && <BackgroundCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "show_image" && <ShowImageCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "video" && <VideoCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "sprite" && <SpriteCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "choice" && <ChoiceCommandEditor command={command} variableKeys={variableKeys} onChange={(next) => update(index, next)} />}
                {command.type === "state_update" && <StateUpdateCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "conditional_jump" && <ConditionalJumpCommandEditor command={command} variableKeys={variableKeys} sceneIds={sceneIds} onChange={(next) => update(index, next)} />}
                {command.type === "jump" && <JumpCommandEditor command={command} sceneIds={sceneIds} onChange={(next) => update(index, next)} />}
                {command.type === "animation" && <AnimationCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "bgm" && <BgmCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "sfx" && <SfxCommandEditor command={command} onChange={(next) => update(index, next)} />}
                {command.type === "camera" && (
                  <CameraCommandEditor
                    command={command}
                    commands={commands}
                    commandIndex={index}
                    sceneId={sceneId}
                    onChange={(next) => update(index, next)}
                  />
                )}
                {command.type === "wait" && <WaitCommandEditor command={command} onChange={(next) => update(index, next)} />}
              </div>
            )}
            </section>
          </Fragment>
        );
      })}
      <div className="camera-command-insert is-tail">
        <button type="button" onClick={() => setInsertStudioIndex(commands.length)}>
          <Camera size={13} aria-hidden="true" />
          <span className="camera-command-insert-label">＋ 运镜</span>
        </button>
      </div>
      <div ref={endRef} />
      {insertStudioIndex !== undefined && (
        <CameraStudioDialog
          command={createDefaultCameraCommand("reframe", currentPoseBeforeList(commands, insertStudioIndex))}
          commands={commands}
          commandIndex={insertStudioIndex}
          sceneId={sceneId}
          inserting
          onApply={(next) => {
            onChange([
              ...commands.slice(0, insertStudioIndex),
              next,
              ...commands.slice(insertStudioIndex),
            ]);
            setInsertStudioIndex(undefined);
          }}
          onClose={() => setInsertStudioIndex(undefined)}
        />
      )}
      {dragState && (
        <div
          className={`command-drag-preview${dragState.isDropping ? " is-dropping" : ""}`}
          style={{
            "--command-preview-x": `${dragState.isDropping ? dragState.dropX ?? dragState.sourceRect.left : dragState.currentX - dragState.grabOffsetX}px`,
            "--command-preview-y": `${dragState.isDropping ? dragState.dropY ?? dragState.sourceRect.top : dragState.currentY - dragState.grabOffsetY}px`,
            "--command-preview-width": `${dragState.sourceRect.width}px`,
          } as CSSProperties}
        >
          <span className="command-drag-preview-grip" aria-hidden="true">
            <GripVertical size={16} />
          </span>
          <span className="command-drag-preview-copy">
            <strong>{dragState.from + 1}. {commandLabels[commands[dragState.from].type]}</strong>
            <small>{commandSummary(commands[dragState.from])}</small>
          </span>
        </div>
      )}
    </div>
  );
}
