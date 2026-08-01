import {
  getDefaultUISkinLayout,
  type UILayoutComponentStyle,
  type UILayoutComponentType,
  type UILayoutTokens,
  type UISkinLayout,
} from "./uiSkin";

export interface RuntimeThemePreset {
  preset_id: string;
  name: string;
  description: string;
  tokens: UILayoutTokens;
  componentStyles: Partial<Record<UILayoutComponentType, UILayoutComponentStyle>>;
}

interface ThemeInput {
  bg: string;
  surface: string;
  strong: string;
  ink: string;
  muted: string;
  accent: string;
  accent2: string;
  line: string;
  panel?: string;
  panelText?: string;
  control?: string;
  controlHover?: string;
  controlActive?: string;
  controlText?: string;
  sliderTrack?: string;
  sliderActive?: string;
  sliderThumb?: string;
  dialog?: string;
  dialogText?: string;
  speaker?: string;
  speakerText?: string;
  choice?: string;
  choiceText?: string;
  quickMenu?: string;
  focus?: string;
  danger?: string;
  warning?: string;
  success?: string;
  radius?: number;
  motionScale?: number;
  fontScale?: number;
}

export const defaultRuntimeThemePresetId = "default_blue_gray";

function buildTokens(input: ThemeInput): UILayoutTokens {
  return {
    colorBackground: input.bg,
    colorSurface: input.surface,
    colorSurfaceStrong: input.strong,
    colorInk: input.ink,
    colorMuted: input.muted,
    colorAccent: input.accent,
    colorAccent2: input.accent2,
    colorLine: input.line,
    colorPanel: input.panel ?? input.surface,
    colorPanelText: input.panelText ?? input.ink,
    colorControl: input.control ?? input.strong,
    colorControlHover: input.controlHover ?? input.surface,
    colorControlActive: input.controlActive ?? input.accent,
    colorControlText: input.controlText ?? input.ink,
    colorSliderTrack: input.sliderTrack ?? "#214a55",
    colorSliderActive: input.sliderActive ?? "#6edee4",
    colorSliderThumb: input.sliderThumb ?? "#eaffff",
    colorDialog: input.dialog ?? input.surface,
    colorDialogText: input.dialogText ?? input.ink,
    colorSpeakerPlate: input.speaker ?? input.strong,
    colorSpeakerText: input.speakerText ?? input.accent,
    colorChoice: input.choice ?? input.accent,
    colorChoiceText: input.choiceText ?? "#ffffff",
    colorQuickMenu: input.quickMenu ?? input.surface,
    colorFocus: input.focus ?? input.accent,
    colorDanger: input.danger ?? "#dc2626",
    colorWarning: input.warning ?? "#d97706",
    colorSuccess: input.success ?? "#16a34a",
    radius: input.radius ?? 8,
    motionScale: input.motionScale ?? 1,
    fontScale: input.fontScale ?? 1,
  };
}

function definedStyle(style: UILayoutComponentStyle): UILayoutComponentStyle {
  return Object.fromEntries(Object.entries(style).filter(([, value]) => value !== undefined)) as UILayoutComponentStyle;
}

export function componentStylesFromThemeTokens(tokens: UILayoutTokens): RuntimeThemePreset["componentStyles"] {
  const control: UILayoutComponentStyle = definedStyle({
    backgroundColor: tokens.colorControl,
    color: tokens.colorControlText,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radius,
  });
  const panel: UILayoutComponentStyle = definedStyle({
    backgroundColor: tokens.colorPanel,
    color: tokens.colorPanelText,
    borderColor: tokens.colorLine,
    borderRadius: tokens.radius,
    shadow: "soft",
  });
  return {
    dialog_panel: definedStyle({
      backgroundColor: tokens.colorDialog,
      color: tokens.colorDialogText,
      borderColor: tokens.colorLine,
      borderRadius: tokens.radius,
      shadow: "soft",
      backdropBlur: 14,
    }),
    speaker_label: definedStyle({
      backgroundColor: tokens.colorSpeakerPlate,
      color: tokens.colorSpeakerText,
      borderColor: tokens.colorAccent,
      borderRadius: Math.max(4, Math.round((tokens.radius ?? 8) * 0.85)),
      fontWeight: 760,
    }),
    dialog_text: definedStyle({
      color: tokens.colorDialogText,
      fontWeight: 500,
      fontStyle: "normal",
    }),
    choice_list: definedStyle({
      color: tokens.colorChoiceText,
      accentColor: tokens.colorChoice,
    }),
    quick_menu: definedStyle({
      backgroundColor: tokens.colorQuickMenu,
      color: tokens.colorControlText,
      borderColor: tokens.colorLine,
      borderRadius: 999,
      shadow: "soft",
      backdropBlur: 16,
    }),
    quick_button: control,
    menu_button: control,
    main_menu_continue_button: control,
    main_menu_start_button: control,
    main_menu_save_load_button: control,
    main_menu_library_button: control,
    main_menu_gallery_button: control,
    main_menu_settings_button: control,
    main_menu_about_button: control,
    save_slot_grid: panel,
    settings_group: panel,
    history_list: panel,
    gallery_grid: panel,
    about_panel: panel,
  };
}

function makePreset(preset_id: string, name: string, description: string, input: ThemeInput): RuntimeThemePreset {
  const tokens = buildTokens(input);
  return {
    preset_id,
    name,
    description,
    tokens,
    componentStyles: componentStylesFromThemeTokens(tokens),
  };
}

export const runtimeThemePresets: RuntimeThemePreset[] = [
  makePreset("default_blue_gray", "默认蓝灰", "清爽、轻量、适合多数作品的默认 GameCLI 外观。", {
    bg: "#eef5fb", surface: "#f7fbff", strong: "#e2edf8", ink: "#0b1d2e", muted: "#3e5266", accent: "#256eb8", accent2: "#0d9f9a", line: "#345170",
    panel: "#f7fbff", control: "#e2edf8", controlHover: "#d9e8f6", controlActive: "#256eb8", controlText: "#0b1d2e", dialog: "#f8fcff", speaker: "#e8f2fb", speakerText: "#1b5f9d", choice: "#b87918", quickMenu: "#f1f7fd", focus: "#256eb8",
  }),
  makePreset("midnight_violet", "午夜紫", "低亮度紫蓝背景，适合悬疑、都市和奇幻夜景。", {
    bg: "#0f1024", surface: "#18172f", strong: "#26214a", ink: "#f6f3ff", muted: "#b8afd2", accent: "#8b5cf6", accent2: "#22d3ee", line: "#4d426f",
    dialog: "#191832", speaker: "#2b2554", speakerText: "#d8c9ff", choice: "#7c3aed", quickMenu: "#1d1a39", focus: "#a78bfa",
  }),
  makePreset("cyber_cyan", "赛博青", "高对比青色霓虹，适合科幻、终端和赛博场景。", {
    bg: "#071316", surface: "#0d2024", strong: "#123137", ink: "#eaffff", muted: "#9bd4d7", accent: "#06b6d4", accent2: "#f59e0b", line: "#24535a",
    dialog: "#0f252a", speaker: "#143b41", speakerText: "#9af7ff", choice: "#0891b2", quickMenu: "#0d2328", focus: "#22d3ee",
  }),
  makePreset("rose_noir", "玫瑰黑", "黑玫瑰与粉色高光，适合浪漫悬疑或哥特氛围。", {
    bg: "#160b12", surface: "#24101b", strong: "#351827", ink: "#fff1f7", muted: "#e0a9be", accent: "#f472b6", accent2: "#f59e0b", line: "#5a2b41",
    dialog: "#2a1320", speaker: "#421d31", speakerText: "#ffd1e7", choice: "#db2777", quickMenu: "#2c1522", focus: "#fb7185",
  }),
  makePreset("amber_archive", "琥珀档案", "暖色纸本质感，适合调查、回忆和档案类叙事。", {
    bg: "#f6eddd", surface: "#fff8ec", strong: "#ecd8b8", ink: "#302110", muted: "#6b573f", accent: "#b45309", accent2: "#0f766e", line: "#b9935d",
    dialog: "#fffaf0", speaker: "#f0d6aa", speakerText: "#7c3f05", choice: "#b45309", quickMenu: "#f9efd9", focus: "#d97706", warning: "#b45309",
  }),
  makePreset("verdant_signal", "绿意信号", "冷静绿色信号灯风格，适合末世、医疗、生态题材。", {
    bg: "#07140e", surface: "#0d2116", strong: "#163725", ink: "#eafff2", muted: "#a6d8bb", accent: "#22c55e", accent2: "#38bdf8", line: "#2b6745",
    dialog: "#10281b", speaker: "#17472c", speakerText: "#b7f7ca", choice: "#16a34a", quickMenu: "#10251a", focus: "#4ade80", success: "#22c55e",
  }),
  makePreset("crimson_theater", "赤红剧场", "深红幕布与金色按钮，适合戏剧、复仇和舞台感作品。", {
    bg: "#190b0d", surface: "#2a1115", strong: "#431a1f", ink: "#fff4ef", muted: "#dfafa6", accent: "#dc2626", accent2: "#fbbf24", line: "#6c2c31",
    dialog: "#2b1216", speaker: "#4b1f25", speakerText: "#ffd2c8", choice: "#b91c1c", quickMenu: "#2f1519", focus: "#f87171", danger: "#ef4444",
  }),
  makePreset("mono_ink", "水墨单色", "接近黑白的克制配色，适合文学向和极简作品。", {
    bg: "#f4f4f0", surface: "#ffffff", strong: "#dcdcd5", ink: "#111111", muted: "#555555", accent: "#2f2f2f", accent2: "#74746f", line: "#9a9a93",
    dialog: "#ffffff", speaker: "#ededeb", speakerText: "#111111", choice: "#1f2937", quickMenu: "#f8f8f5", focus: "#111111",
  }),
  makePreset("porcelain_day", "瓷白日间", "明亮蓝白，适合日常、校园和治愈题材。", {
    bg: "#f7fbff", surface: "#ffffff", strong: "#dbeafe", ink: "#102033", muted: "#52657a", accent: "#3b82f6", accent2: "#14b8a6", line: "#acc7e7",
    dialog: "#ffffff", speaker: "#e6f0ff", speakerText: "#1d4ed8", choice: "#2563eb", quickMenu: "#f1f7ff", focus: "#2563eb",
  }),
  makePreset("sakura_night", "樱夜", "夜色配粉樱，适合恋爱、幻想和温柔夜景。", {
    bg: "#12111f", surface: "#201a2c", strong: "#332542", ink: "#fff7fb", muted: "#d8b7c8", accent: "#f9a8d4", accent2: "#93c5fd", line: "#59415f",
    dialog: "#231b31", speaker: "#3d2a4a", speakerText: "#ffd8ec", choice: "#ec4899", quickMenu: "#251d35", focus: "#f0abfc",
  }),
  makePreset("ocean_terminal", "深海终端", "深海蓝与绿色荧光，适合潜入、舰船、科技题材。", {
    bg: "#061725", surface: "#0c2234", strong: "#143650", ink: "#e8f7ff", muted: "#a2c8dc", accent: "#0ea5e9", accent2: "#34d399", line: "#285674",
    dialog: "#0e283c", speaker: "#17415d", speakerText: "#bae6fd", choice: "#0284c7", quickMenu: "#102b41", focus: "#38bdf8",
  }),
  makePreset("solar_glass", "日光玻璃", "浅色玻璃拟物，适合现代、轻科幻和明快界面。", {
    bg: "#fff7ed", surface: "#ffffff", strong: "#ffedd5", ink: "#301b0b", muted: "#7c5e42", accent: "#ea580c", accent2: "#0891b2", line: "#e2b98c",
    dialog: "#fffaf3", speaker: "#ffe0bd", speakerText: "#9a3412", choice: "#ea580c", quickMenu: "#fff3e3", focus: "#f97316",
  }),
  makePreset("lavender_haze", "薰衣草", "柔和淡紫与深墨色文字，适合梦境和轻幻想。", {
    bg: "#f4f0ff", surface: "#ffffff", strong: "#e9d5ff", ink: "#211334", muted: "#655173", accent: "#7c3aed", accent2: "#0d9488", line: "#c6a7e6",
    dialog: "#ffffff", speaker: "#efe1ff", speakerText: "#5b21b6", choice: "#7c3aed", quickMenu: "#f8f3ff", focus: "#8b5cf6",
  }),
  makePreset("mint_paper", "薄荷纸张", "浅薄荷和墨绿色，适合清新日常和手账感作品。", {
    bg: "#effcf5", surface: "#ffffff", strong: "#ccf2df", ink: "#0d2b1e", muted: "#426455", accent: "#059669", accent2: "#2563eb", line: "#98d5b8",
    dialog: "#ffffff", speaker: "#dcfce7", speakerText: "#047857", choice: "#059669", quickMenu: "#f2fff8", focus: "#10b981",
  }),
  makePreset("royal_indigo", "皇家靛蓝", "靛蓝与金色点缀，适合史诗、王室和魔法学院。", {
    bg: "#0c1024", surface: "#151b39", strong: "#222b57", ink: "#f5f7ff", muted: "#b4bce0", accent: "#6366f1", accent2: "#facc15", line: "#414b80",
    dialog: "#171e3f", speaker: "#283064", speakerText: "#dfe3ff", choice: "#4f46e5", quickMenu: "#192043", focus: "#818cf8",
  }),
  makePreset("neon_arcade", "霓虹街机", "深色街机和高饱和撞色，适合热闹、游戏内 UI。", {
    bg: "#090a18", surface: "#15152a", strong: "#252046", ink: "#faffff", muted: "#b9b4d7", accent: "#e879f9", accent2: "#22d3ee", line: "#564a83",
    dialog: "#17162f", speaker: "#2f2459", speakerText: "#f5d0fe", choice: "#c026d3", quickMenu: "#17172f", focus: "#67e8f9",
  }),
  makePreset("autumn_brass", "秋铜", "铜色、橄榄和暖灰，适合怀旧、旅行和乡野题材。", {
    bg: "#f5efe4", surface: "#fff9ef", strong: "#dfc7a5", ink: "#2b2116", muted: "#6c5b45", accent: "#a16207", accent2: "#4d7c0f", line: "#b99d6f",
    dialog: "#fff7ea", speaker: "#ead3ac", speakerText: "#7c4a03", choice: "#a16207", quickMenu: "#faefd9", focus: "#ca8a04",
  }),
  makePreset("glacier_console", "冰川控制台", "冷蓝灰与冰色高光，适合调查面板和硬科幻。", {
    bg: "#eaf3fb", surface: "#f8fcff", strong: "#d7e7f4", ink: "#0e2538", muted: "#45657b", accent: "#0284c7", accent2: "#7c3aed", line: "#9db9cf",
    dialog: "#f7fcff", speaker: "#dff1fb", speakerText: "#075985", choice: "#0369a1", quickMenu: "#eff8ff", focus: "#0ea5e9",
  }),
  makePreset("velvet_wine", "酒红天鹅绒", "酒红与浅金，适合成人向、酒馆和华丽室内场景。", {
    bg: "#170b13", surface: "#27111e", strong: "#3d1b2c", ink: "#fff4f8", muted: "#d6aabc", accent: "#be123c", accent2: "#f59e0b", line: "#663047",
    dialog: "#2b1321", speaker: "#4a2034", speakerText: "#ffd7e3", choice: "#be123c", quickMenu: "#2e1523", focus: "#fb7185",
  }),
  makePreset("jade_lantern", "玉色灯笼", "玉绿、纸灯和墨色，适合东方幻想和古风现代混合。", {
    bg: "#071511", surface: "#10251f", strong: "#1a3a31", ink: "#f1fff8", muted: "#afd8c7", accent: "#2dd4bf", accent2: "#f59e0b", line: "#31685a",
    dialog: "#122a23", speaker: "#1d473c", speakerText: "#c6fff4", choice: "#0d9488", quickMenu: "#122a23", focus: "#5eead4",
  }),
];

export function findRuntimeThemePreset(presetId?: string | null): RuntimeThemePreset {
  return runtimeThemePresets.find((preset) => preset.preset_id === presetId) ?? runtimeThemePresets[0];
}

export function cloneUISkinLayout(skin?: UISkinLayout): UISkinLayout {
  return JSON.parse(JSON.stringify(skin ?? getDefaultUISkinLayout())) as UISkinLayout;
}

export function applyRuntimeThemePreset(skin: UISkinLayout | undefined, presetOrId: RuntimeThemePreset | string | undefined | null): UISkinLayout {
  const preset = typeof presetOrId === "string" ? findRuntimeThemePreset(presetOrId) : presetOrId ?? findRuntimeThemePreset();
  const next = cloneUISkinLayout(skin);
  return {
    ...next,
    name: next.name?.trim() ? next.name : preset.name,
    tokens: {
      ...(next.tokens ?? {}),
      ...preset.tokens,
    },
    screens: next.screens.map((screen) => ({
      ...screen,
      components: screen.components.map((component) => {
        const style = preset.componentStyles[component.component_type];
        return style
          ? { ...component, style: { ...(component.style ?? {}), ...style } }
          : component;
      }),
    })),
  };
}

export function applyRuntimeThemeTokens(skin: UISkinLayout | undefined, tokens: Partial<UILayoutTokens>): UISkinLayout {
  const next = cloneUISkinLayout(skin);
  const mergedTokens = {
    ...(next.tokens ?? {}),
    ...tokens,
  };
  const componentStyles = componentStylesFromThemeTokens(mergedTokens);
  return {
    ...next,
    tokens: mergedTokens,
    screens: next.screens.map((screen) => ({
      ...screen,
      components: screen.components.map((component) => {
        const style = componentStyles[component.component_type];
        return style
          ? { ...component, style: { ...(component.style ?? {}), ...style } }
          : component;
      }),
    })),
  };
}
