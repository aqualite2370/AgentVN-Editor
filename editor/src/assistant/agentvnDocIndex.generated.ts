import type { AssistantDocChunk } from "./types";

export const agentvnDocIndex = [
  {
    id: "agentvn-project-purpose",
    source: "AgentVN project summary",
    title: "AgentVN 项目主旨",
    tags: ["project", "purpose", "workflow"],
    text: "AgentVN 是本地优先的视觉小说创作编辑器。编辑器工程保存节点图、素材、AI 设置、小说导入结果和布局；导出运行脚本与 .vncart 卡带时会移除编辑器专用字段、API 密钥、源文档和内部状态。GameCLI 是玩家端运行容器。",
  },
  {
    id: "agentvn-command-types",
    source: "editor/src/types/commands.ts",
    title: "AgentVN 事件命令类型",
    tags: ["commands", "scene-editor", "events"],
    text: "场景事件由 GameCommand 组成，常用类型包括 dialog、narration、background、show_image、sprite、choice、state_update、animation、bgm、sfx、camera 和 wait。事件在场景命令列表中的顺序就是运行时执行顺序。",
  },
  {
    id: "agentvn-cartridge-format",
    source: "docs/CARTRIDGE_FORMAT.md",
    title: "AgentVN 卡带格式",
    tags: ["docs", "cartridge", "format"],
    text: ".vncart 是面向玩家的游戏发行包，包含 manifest.json、script.json、可选素材、UI、画廊、版权与校验信息。导入时必须验证安全路径、文件类型、清单、场景引用、素材引用、版本和校验和。",
  },
  {
    id: "agentvn-provider-security",
    source: "docs/API_KEY_SECURITY.md",
    title: "模型密钥安全",
    tags: ["docs", "providers", "security"],
    text: "模型 API 密钥只用于本地供应商连接。项目文件、运行脚本和 .vncart 不应包含 API 密钥、账单令牌或敏感生成历史。发布前应检查项目素材和供应商条款。",
  },
] as const satisfies readonly AssistantDocChunk[];
