import { agentvnDocIndex } from "./agentvnDocIndex.generated";
import type { AdvancedToolsTab } from "../components/advanced/advancedToolsBridge";

const destinations: Record<string, { tab: AdvancedToolsTab; label: string }> = {
  "layout-background": { tab: "layout", label: "游戏客户端" },
  "game-aspect": { tab: "layout", label: "游戏客户端" },
  "layout-code": { tab: "layout", label: "游戏客户端" },
  "gui-pack": { tab: "layout", label: "游戏客户端" },
  components: { tab: "layout", label: "游戏客户端" },
  "project-save": { tab: "settings", label: "项目设置" },
  "ai-modes": { tab: "providers", label: "模型/连接" },
  novel: { tab: "novel", label: "小说导入" },
  dialogue: { tab: "layout", label: "游戏客户端" },
  "hide-ui": { tab: "layout", label: "游戏客户端" },
};
/** Model text/URLs are never executable navigation. Resolve only local index IDs. */
export function assistantKnowledgeDestination(id: string) {
  const chunk = agentvnDocIndex.find(chunk => chunk.id === id);
  if (!chunk?.tags.includes("current-operation-guide")) return undefined;
  return destinations[chunk.tags[1]];
}
