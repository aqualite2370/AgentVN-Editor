import { useReactFlow, useStore } from "@xyflow/react";
import { memo, useMemo, useRef, type PointerEvent } from "react";
import { roundedGraphPath, type GraphCard, type GraphPoint } from "../../utils/graphGeometry";

const mapWidth = 248;
const mapHeight = 144;
const padding = 10;

function fitGraph(cards: GraphCard[], routes: ReadonlyMap<string, GraphPoint[]>) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  function include(x: number, y: number) {
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);
  }
  for (const card of cards) {
    include(card.x, card.y);
    include(card.x + card.width, card.y + card.height);
  }
  for (const route of routes.values()) for (const point of route) include(point.x, point.y);
  const contentWidth = Math.max(1, right - left);
  const contentHeight = Math.max(1, bottom - top);
  const scale = Math.min((mapWidth - 2 * padding) / contentWidth, (mapHeight - 2 * padding) / contentHeight);
  return { scale, x: (mapWidth - contentWidth * scale) / 2 - left * scale, y: (mapHeight - contentHeight * scale) / 2 - top * scale };
}

const GraphDrawing = memo(function GraphDrawing({ cards, routes, selectedNodeId }: {
  cards: GraphCard[];
  routes: ReadonlyMap<string, GraphPoint[]>;
  selectedNodeId?: string;
}) {
  return (
    <>
      {[...routes].map(([id, route]) => {
        const isReturn = route[0].y >= route[route.length - 1].y;
        return <path key={id} data-edge-id={id} className={`story-minimap-edge${isReturn ? " is-return" : ""}`} d={roundedGraphPath(route)} />;
      })}
      {cards.map(({ node, x, y, width, height }) => (
        <rect
          key={node.id}
          data-node-id={node.id}
          className={`story-minimap-node${node.id === selectedNodeId ? " is-selected" : ""}`}
          style={{ fill: `var(--${node.data.nodeKind}, var(--scene))` }}
          x={x}
          y={y}
          width={width}
          height={height}
          rx={Math.min(8, height / 5)}
        />
      ))}
    </>
  );
});

export function StoryMiniMap({ cards, routes, selectedNodeId }: {
  cards: GraphCard[];
  routes: ReadonlyMap<string, GraphPoint[]>;
  selectedNodeId?: string;
}) {
  const reactFlow = useReactFlow();
  const [viewportX, viewportY, zoom] = useStore(state => state.transform);
  const width = useStore(state => state.width);
  const height = useStore(state => state.height);
  const svgRef = useRef<SVGSVGElement>(null);
  const projection = useMemo(() => fitGraph(cards, routes), [cards, routes]);
  if (!cards.length) return null;

  function navigate(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const matrix = svgRef.current?.getScreenCTM();
    if (!matrix) return;
    event.preventDefault();
    event.stopPropagation();
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    void reactFlow.setCenter((point.x - projection.x) / projection.scale, (point.y - projection.y) / projection.scale, {
      zoom,
      duration: reduced ? 0 : 180,
    });
  }

  return (
    <div className="story-minimap nopan nodrag" title="点击小地图定位画布" onPointerDown={navigate}>
      <svg ref={svgRef} viewBox={`0 0 ${mapWidth} ${mapHeight}`} role="img" aria-label="节点分布缩略图">
        <g transform={`translate(${projection.x} ${projection.y}) scale(${projection.scale})`}>
          <GraphDrawing cards={cards} routes={routes} selectedNodeId={selectedNodeId} />
          {width > 0 && height > 0 && zoom > 0 && (
            <rect
              className="story-minimap-focus-window"
              x={-viewportX / zoom}
              y={-viewportY / zoom}
              width={width / zoom}
              height={height / zoom}
              rx={1.5 / projection.scale}
            />
          )}
        </g>
      </svg>
    </div>
  );
}
