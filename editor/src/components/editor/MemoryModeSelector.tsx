import type { MemoryMode } from "../../types/memory";
import { RichSelect } from "../common/RichSelect";

const options: Array<{ value: MemoryMode; label: string; description: string }> = [
  { value: "none", label: "不启用记忆", description: "适合短篇、测试或没有连续关系的剧情。" },
  { value: "chronicle_graph_only", label: "只用客观时序图谱", description: "适合悬疑、推理、阵营关系和复杂设定。" },
  { value: "emotion_trace_only", label: "只用主观情感记忆", description: "适合恋爱、日常、角色心理和情绪变化。" },
  { value: "hybrid", label: "混合记忆", description: "适合长篇、强剧情、复杂人物关系。" },
];

export function MemoryModeSelector({ value, onChange, compact = false }: { value: MemoryMode; onChange: (value: MemoryMode) => void; compact?: boolean }) {
  return (
    <label className={compact ? "memory-selector compact" : "memory-selector"}>
      <span>记忆模式</span>
      <RichSelect
        value={value}
        options={options}
        helpKey="field.memoryMode"
        variant={compact ? "compact" : "default"}
        onChange={onChange}
      />
      {!compact && <small>{options.find((option) => option.value === value)?.description}</small>}
    </label>
  );
}
