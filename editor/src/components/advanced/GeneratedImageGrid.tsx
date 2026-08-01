import type { GeneratedAssetCandidate } from "../../asset-generation/session";

export function GeneratedImageGrid({
  candidates,
  onSave,
}: {
  candidates: GeneratedAssetCandidate[];
  onSave: (candidate: GeneratedAssetCandidate) => void;
}) {
  if (candidates.length === 0) return null;
  return (
    <div className="generated-grid ai-generated-grid">
      {candidates.map((candidate) => (
        <article className="ai-glow-surface" key={candidate.image_id}>
          <img src={candidate.blob_url} alt={candidate.image_id} />
          {candidate.revisedPrompt && candidate.revisedPrompt !== candidate.prompt && (
            <small>优化后提示词：{candidate.revisedPrompt}</small>
          )}
          {candidate.warnings.map((warning) => <small key={warning} className="inline-status">{warning}</small>)}
          {candidate.issues.map((issue) => (
            <small key={`${candidate.image_id}-${issue.code}`} className={issue.severity === "error" ? "inline-error" : "inline-status"}>{issue.message}</small>
          ))}
          <button
            type="button"
            data-help-key="asset.saveGenerated"
            disabled={!candidate.canSave}
            title={candidate.saveBlockedReason}
            onClick={() => onSave(candidate)}
          >
            保存入库
          </button>
        </article>
      ))}
    </div>
  );
}
