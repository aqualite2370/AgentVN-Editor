import type { UILayoutRect, UILayoutScreenId } from "../../../shared/cartridge/uiSkin";

/** Defaults for new proposals only; persisted review rectangles stay authoritative. */
export function assistantCreationDefaultRect(
  index: number,
  count: number,
  screenId: UILayoutScreenId = "player",
): UILayoutRect {
  if (!Number.isInteger(count) || count < 1 || count > 16
    || !Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error("组件候选数量或位置序号无效。");
  }
  // The Ren'Py title page owns a left navigation rail centered vertically.
  // New components must begin on the opposite side so a generated proposal
  // cannot cover native title actions before the user has reviewed it.
  if (screenId === "title") {
    const columns = Math.min(2, count);
    const rows = Math.ceil(count / columns);
    const width = columns === 1 ? 20 : 16;
    const height = Math.min(30, (80 - (rows - 1) * 4) / rows);
    return {
      x: 60 + (index % columns) * (width + 4),
      y: 10 + Math.floor(index / columns) * (height + 4),
      width,
      height,
    };
  }
  const rows = Math.ceil(count / 4);
  // Sparse batches should not be squeezed into the sixteen-item grid's height.
  // Large batches remain bounded; actual Runtime diagnostics still decide fit.
  const height = Math.min(30, (80 - (rows - 1) * 4) / rows);
  return {
    x: 8 + (index % 4) * 23,
    y: 10 + Math.floor(index / 4) * (height + 4),
    width: 20,
    height,
  };
}
