import type { UILayoutRect } from "../../../shared/cartridge/uiSkin";

export type LayoutSnapRect = UILayoutRect;

export interface LayoutSnapPeer {
  id: string;
  rect: LayoutSnapRect;
  visible?: boolean;
  locked?: boolean;
  groupId?: string;
}

export interface LayoutSnapGuide {
  axis: "x" | "y";
  kind: string;
  sourceId: string;
  targetPx: number;
  linePx: number;
}

export declare const SNAP_GRID_STEP_PERCENT: number;
export declare const SNAP_SAFE_INSETS_PERCENT: {
  left: number;
  right: number;
  top: number;
  bottom: number;
};
export declare const SNAP_THRESHOLD_PX: number;
export declare const SNAP_RELEASE_THRESHOLD_PX: number;
export declare function snapLayoutRect(
  rect: LayoutSnapRect,
  options?: {
    frame?: { width: number; height: number };
    toggles?: { grid?: boolean; edges?: boolean; center?: boolean; safe?: boolean };
    frameSafeInsets?: Partial<typeof SNAP_SAFE_INSETS_PERCENT>;
    gridStepPercent?: number;
    thresholdPx?: number;
    releaseThresholdPx?: number;
    activeSnap?: { x?: unknown; y?: unknown };
    peers?: LayoutSnapPeer[];
    movingId?: string;
    movingGroupId?: string;
    mode?: "move" | "resize";
  },
): { rect: LayoutSnapRect; guides: LayoutSnapGuide[]; activeSnap: { x?: unknown; y?: unknown } };
