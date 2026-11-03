import type { CSSProperties, HTMLAttributes } from "react";
import type { UILayoutComponent } from "../../../shared/cartridge/uiSkin";
import { PresentedControl } from "./PresentedControl";
import { useRuntimeUILayout, useUILayoutFrameSize } from "./uiSkinRuntime";
import { useRuntimeStore } from "../store/runtimeStore";
import "./ui-layout-opacity.css";

type LayerStyle = CSSProperties & {
  "--ui-layout-background-opacity"?: number;
  "--ui-layout-content-opacity"?: number;
};

export function resolveOpacitySurfaceStyles(style?: CSSProperties) {
  const layered = style as LayerStyle | undefined;
  if (layered?.["--ui-layout-background-opacity"] === undefined
    && layered?.["--ui-layout-content-opacity"] === undefined) return undefined;
  const {
    background, backgroundColor, backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat,
    backgroundOrigin, backgroundClip, backgroundAttachment, backdropFilter, WebkitBackdropFilter,
    opacity: _legacyOpacity, ...frame
  } = style ?? {};
  return {
    frame: { ...frame, background: "transparent", backgroundImage: "none", backdropFilter: "none", WebkitBackdropFilter: "none" },
    background: {
      background, backgroundColor, backgroundImage, backgroundSize, backgroundPosition, backgroundRepeat,
      backgroundOrigin, backgroundClip, backgroundAttachment, backdropFilter, WebkitBackdropFilter,
      opacity: layered?.["--ui-layout-background-opacity"] ?? 1,
    },
    content: { opacity: layered?.["--ui-layout-content-opacity"] ?? 1 },
  };
}

/** Legacy pages keep precisely their existing DOM and styles. New authoring
 * opts into sibling material/foreground layers without a second UI instance. */
export function UILayoutOpacitySurface({
  as: Tag = "div", children, className = "", style, presentationComponent, ...props
}: HTMLAttributes<HTMLElement> & { as?: "div" | "section"; presentationComponent?: UILayoutComponent }) {
  const layout = useRuntimeUILayout();
  const frame = useUILayoutFrameSize();
  const assetUrls = useRuntimeStore(state => state.currentGame?.assetUrls);
  const layers = resolveOpacitySurfaceStyles(style);
  const surface = !layers ? <Tag {...props} className={className} style={style}>{children}</Tag>
    : <Tag {...props} className={`${className} ui-opacity-surface`}
    style={layers.frame}>
    <div className="ui-opacity-background" data-ui-opacity-layer="background" aria-hidden="true" style={layers.background} />
    <div className="ui-opacity-content" data-ui-opacity-layer="content"
      style={layers.content}>{children}</div>
  </Tag>;
  return <PresentedControl layout={layout} component={presentationComponent} applyBaseStyle={false}
    assetUrls={assetUrls} scale={Math.min(frame.width / 1280, frame.height / 720)}>
    {surface}
  </PresentedControl>;
}
