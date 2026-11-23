import type { AssetManifestItem, GameCommand, JsonValue, RuntimeScript } from "../cartridge/types";

export const NATIVE_ANIMATION_MAX_BYTES = 1024 * 1024;
export const NATIVE_ANIMATION_MAX_KEYFRAMES = 512;
type AnimationCommand = Extract<GameCommand, { type: "animation" }>;
type AnimationAssetDescriptor = Pick<AssetManifestItem, "asset_id" | "asset_type" | "path" | "placeholder" | "tags">;
export interface NativeAnimationAsset {
  preset_id?: string;
  target_type?: string;
  params: Record<string, JsonValue>;
}

const rootFields = new Set(["schema_version", "preset_id", "name", "description", "target_type",
  "keyframes", "duration_ms", "easing", "loop", "direction"]);
const numericFields = new Set(["offset", "opacity", "x", "y", "scale", "rotate", "blur", "brightness"]);
const frameFields = new Set([...numericFields, "easing", "custom_css"]);
const targets = new Set(["screen", "background", "sprite", "dialog", "ui", "camera"]);
const directions = new Set(["normal", "reverse", "alternate", "alternate-reverse"]);
function fail(label: string, message: string): never {
  throw new Error(`ANIMATION_ASSET_INVALID: ${label}：${message}`);
}
function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function easing(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 160) fail(label, "缓动函数无效。");
  if (/^(linear|ease|ease-in|ease-out|ease-in-out|step-start|step-end)$/.test(value)) return value;
  const curve = value.match(/^cubic-bezier\(\s*([-+\d.e]+)\s*,\s*([-+\d.e]+)\s*,\s*([-+\d.e]+)\s*,\s*([-+\d.e]+)\s*\)$/i);
  if (curve) {
    const numbers = curve.slice(1).map(Number);
    if (numbers.every(Number.isFinite) && numbers[0] >= 0 && numbers[0] <= 1 && numbers[2] >= 0 && numbers[2] <= 1) return value;
  }
  const steps = value.match(/^steps\(\s*(\d+)\s*(?:,\s*(start|end|jump-start|jump-end|jump-none|jump-both)\s*)?\)$/);
  if (steps && Number(steps[1]) >= (steps[2] === "jump-none" ? 2 : 1) && Number(steps[1]) <= 1000) return value;
  return fail(label, "仅支持标准缓动、cubic-bezier 或 steps。");
}

/** Native AnimationPreset JSON; never executes CSS, JavaScript, or third-party animation code. */
export function parseNativeAnimationAsset(text: string, label = "动画素材"): NativeAnimationAsset {
  if (new TextEncoder().encode(text).byteLength > NATIVE_ANIMATION_MAX_BYTES) fail(label, "文件超过 1 MiB。");
  let value: unknown;
  try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { return fail(label, "JSON 内容损坏。"); }
  if (!object(value)) fail(label, "必须是原生动画预设对象。");
  for (const key of Object.keys(value)) if (!rootFields.has(key)) fail(label, `不支持字段 ${key}。`);
  if (value.schema_version !== undefined && value.schema_version !== "1.0.0") fail(label, "不支持该动画格式版本。");
  for (const key of ["preset_id", "name", "description"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key].length > 4096))
      fail(label, `${key} 必须是文本且不超过 4096 字符。`);
  }
  if (value.target_type !== undefined && !targets.has(String(value.target_type))) fail(label, "target_type 不受支持。");
  if (typeof value.duration_ms !== "number" || !Number.isFinite(value.duration_ms) || value.duration_ms < 80 || value.duration_ms > 10000)
    fail(label, "duration_ms 必须是 80～10000 毫秒。");
  if (!Array.isArray(value.keyframes) || value.keyframes.length < 2 || value.keyframes.length > NATIVE_ANIMATION_MAX_KEYFRAMES)
    fail(label, "keyframes 必须包含 2～512 个关键帧。");
  let previousOffset = -1;
  const keyframes = value.keyframes.map((frame, index) => {
    const frameLabel = `${label} / keyframes[${index}]`;
    if (!object(frame)) fail(frameLabel, "关键帧必须是对象。");
    for (const key of Object.keys(frame)) if (!frameFields.has(key)) fail(frameLabel, `不支持字段 ${key}。`);
    if (typeof frame.offset !== "number" || !Number.isFinite(frame.offset)
      || frame.offset < 0 || frame.offset > 1 || frame.offset < previousOffset) fail(frameLabel, "offset 必须在 0～1 之间并按顺序排列。");
    previousOffset = frame.offset;
    const result: Record<string, JsonValue> = { offset: frame.offset };
    for (const key of numericFields) {
      if (frame[key] === undefined) continue;
      if (typeof frame[key] !== "number" || !Number.isFinite(frame[key]) || Math.abs(frame[key]) > 100000)
        fail(frameLabel, `${key} 必须是有限数值。`);
      if (key === "opacity" && (frame[key] < 0 || frame[key] > 1)) fail(frameLabel, "opacity 必须在 0～1 之间。");
      if (["scale", "blur", "brightness"].includes(key) && frame[key] < 0) fail(frameLabel, `${key} 不能为负数。`);
      result[key] = frame[key];
    }
    if (!Object.keys(result).some(key => key !== "offset")) fail(frameLabel, "至少设置一个可播放属性。");
    if (frame.easing !== undefined) result.easing = easing(frame.easing, frameLabel);
    if (frame.custom_css !== undefined && frame.custom_css !== "") fail(frameLabel, "素材不执行 custom_css，请使用结构化关键帧。");
    return result;
  });
  if (value.loop !== undefined && typeof value.loop !== "boolean") fail(label, "loop 必须是布尔值。");
  if (value.direction !== undefined && !directions.has(String(value.direction))) fail(label, "direction 不受支持。");
  return {
    preset_id: value.preset_id as string | undefined,
    target_type: value.target_type as string | undefined,
    params: { duration: value.duration_ms, keyframes,
      easing: value.easing === undefined ? "ease-out" : easing(value.easing, label),
      loop: value.loop ?? false, direction: (value.direction ?? "normal") as string } as Record<string, JsonValue>,
  };
}

export function animationAssetId(command: AnimationCommand, assets: readonly Pick<AnimationAssetDescriptor, "asset_id" | "asset_type">[]): string | undefined {
  if (command.animation_asset_id != null) {
    if (typeof command.animation_asset_id !== "string" || !command.animation_asset_id.trim())
      fail("animation_asset_id", "素材 ID 不能为空。");
    return command.animation_asset_id;
  }
  // Legacy inline commands keep their own frames, even if an asset has the same preset ID.
  if (Array.isArray(command.params?.keyframes) && command.params.keyframes.length > 0) return undefined;
  return assets.some(asset => asset.asset_id === command.animation_id && asset.asset_type === "animation")
    ? command.animation_id : undefined;
}

/** Per-load cache only; failed reads and A→B→A reloads never reuse stale materialized bytes. */
export async function resolveNativeAnimationAssets(
  script: RuntimeScript,
  assets: readonly AnimationAssetDescriptor[],
  read: (asset: AnimationAssetDescriptor) => Promise<string>,
  options: { materialize?: boolean } = {},
): Promise<RuntimeScript> {
  const cache = new Map<string, Promise<NativeAnimationAsset>>();
  const scenes = [];
  for (const scene of script.scenes) {
    const commands: GameCommand[] = [];
    for (const command of scene.commands) {
      if (command.type !== "animation") { commands.push(command); continue; }
      const id = animationAssetId(command, assets);
      if (!id) { commands.push(command); continue; }
      const asset = assets.find(item => item.asset_id === id);
      if (!asset || asset.asset_type !== "animation" || asset.placeholder || asset.tags?.includes("placeholder"))
        fail(`${scene.scene_id} / ${id}`, "动画素材缺失、类型不符或仍为占位素材。");
      let pending = cache.get(id);
      if (!pending) {
        pending = read(asset).then(text => parseNativeAnimationAsset(text, id));
        cache.set(id, pending);
      }
      let preset: NativeAnimationAsset;
      try { preset = await pending; }
      catch (error) { throw new Error(`场景 ${scene.scene_id} / 动画 ${id}：${error instanceof Error ? error.message : String(error)}`); }
      if (!object(command.params)) fail(`${scene.scene_id} / ${id}`, "演出参数必须是对象。");
      const merged = { ...preset.params, ...command.params };
      const checked = parseNativeAnimationAsset(JSON.stringify({
        keyframes: merged.keyframes, duration_ms: merged.duration,
        easing: merged.easing, loop: merged.loop, direction: merged.direction,
      }), `${scene.scene_id} / ${id} / 参数覆盖`);
      const parameterFields = new Set(["keyframes", "duration", "easing", "loop", "direction", "delay", "delay_ms", "transform_origin"]);
      for (const key of Object.keys(command.params)) {
        if (!parameterFields.has(key)) fail(`${scene.scene_id} / ${id}`, `素材参数覆盖不支持 ${key}。`);
      }
      for (const key of ["delay", "delay_ms"]) {
        if (merged[key] !== undefined && (typeof merged[key] !== "number" || !Number.isFinite(merged[key])
          || merged[key] < 0 || merged[key] > 10000)) fail(id, `${key} 必须在 0～10000 毫秒之间。`);
      }
      if (merged.transform_origin !== undefined && (typeof merged.transform_origin !== "string"
        || !/^(?:(?:center|left|right|top|bottom|-?\d+(?:\.\d+)?(?:px|%))\s*){1,3}$/.test(merged.transform_origin)))
        fail(id, "transform_origin 只支持位置关键字或像素/百分比坐标。");
      if (checked.params.loop === true && command.blocking)
        fail(`${scene.scene_id} / ${id}`, "循环动画不能阻塞剧情，请关闭循环或取消阻塞。");
      // Export retains the reference + author overrides. Only runtime materializes values;
      // replacing bytes must not be masked by a previously baked params.keyframes copy.
      commands.push({ ...command, animation_asset_id: id,
        params: options.materialize === false ? { ...command.params } : { ...merged, ...checked.params } });
    }
    scenes.push({ ...scene, commands });
  }
  return { ...script, scenes };
}

export async function fetchNativeAnimationAsset(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store" });
    if (!response.ok) throw new Error(`动画素材读取失败：HTTP ${response.status}`);
    if (Number(response.headers.get("content-length")) > NATIVE_ANIMATION_MAX_BYTES) fail("动画素材", "文件超过 1 MiB。");
    // Stream limit also covers missing/untrusted content-length and compressed responses.
    if (!response.body) return await response.text();
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > NATIVE_ANIMATION_MAX_BYTES) fail("动画素材", "文件超过 1 MiB。");
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } finally { clearTimeout(timeout); }
}
