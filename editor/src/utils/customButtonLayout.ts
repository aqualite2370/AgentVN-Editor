import type {
  UILayoutBreakpoint,
  UILayoutComponent,
  UILayoutRect,
} from "../../../shared/cartridge/uiSkin";

const containerPadding = 1;
const gridByBreakpoint = {
  desktop: { width: 20, height: 7, columnStep: 22, rowStep: 8, columns: 3 },
  mobile: { width: 27, height: 6, columnStep: 29, rowStep: 7, columns: 3 },
} as const;

function rectFor(component: UILayoutComponent, breakpoint: UILayoutBreakpoint): UILayoutRect {
  return (breakpoint === "mobile" ? component.mobileRect ?? component.rect : component.rect)
    ?? { x: 10, y: 10, width: 30, height: 20 };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function overlapRatio(left: UILayoutRect, right: UILayoutRect): number {
  const overlapWidth = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const overlapHeight = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  const candidateArea = Math.max(0.01, left.width * left.height);
  return overlapWidth * overlapHeight / candidateArea;
}

/**
 * Finds the first unoccupied button-grid cell inside the current container.
 * Unlike count-based placement, this reuses holes after a button is deleted or
 * moved and therefore never stacks a new button over an existing one.
 */
export function findAvailableCustomButtonRect(
  components: UILayoutComponent[],
  container: UILayoutComponent,
  breakpoint: UILayoutBreakpoint,
): UILayoutRect {
  const grid = gridByBreakpoint[breakpoint];
  const containerRect = rectFor(container, breakpoint);
  const originX = containerRect.x + containerPadding;
  const bottom = containerRect.y + containerRect.height - containerPadding;
  const occupied = components
    .filter((component) => component.component_type === "main_menu_custom_button")
    .map((component) => rectFor(component, breakpoint));

  for (let slot = 0; slot < 300; slot += 1) {
    const column = slot % grid.columns;
    const row = Math.floor(slot / grid.columns);
    const candidate = {
      x: round(originX + column * grid.columnStep),
      y: round(bottom - grid.height - row * grid.rowStep),
      width: grid.width,
      height: grid.height,
    };
    if (candidate.y < 0) break;
    if (!occupied.some((rect) => overlapRatio(candidate, rect) >= 0.35)) return candidate;
  }

  const fallbackRow = Math.ceil(occupied.length / grid.columns);
  return {
    x: round(originX),
    y: round(Math.max(0, bottom - grid.height - fallbackRow * grid.rowStep)),
    width: grid.width,
    height: grid.height,
  };
}
