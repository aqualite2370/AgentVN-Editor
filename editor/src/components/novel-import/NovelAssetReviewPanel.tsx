import { ArrowDownRight } from "lucide-react";
import { useState } from "react";
import type { PendingVisualAsset } from "../../types/assets";
import { locatePendingAsset } from "../../utils/locatePendingAsset";
import { NovelDetails } from "./NovelDetails";

const pageSize = 8;

function ResourceIssues({ items, optional = false }: { items: PendingVisualAsset[]; optional?: boolean }) {
  const [page, setPage] = useState(0);
  const total = Math.max(1, Math.ceil(items.length / pageSize));
  const visiblePage = Math.min(page, total - 1);
  return (
    <section role="region" aria-label={optional ? "可选资源建议" : "必补资源"} className="novel-resource-issues">
      <header><strong>{optional ? "可选建议" : "必补资源"}</strong><span>{items.length} 项</span></header>
      {items.length === 0 && <p>当前任务没有必补资源。</p>}
      {items.slice(visiblePage * pageSize, (visiblePage + 1) * pageSize).map(item => (
        <article key={item.id} data-resource-issue={item.id} data-optional-resource={optional || undefined}>
          <span className="novel-resource-kind">{optional ? "可选" : item.placeholder ? "占位" : "必补"}</span>
          <div><strong>{item.scene_title} · {item.label}</strong>
            <small>{item.location}{item.asset_id ? ` · 素材「${item.asset_id}」` : ""}</small>
            <p>{item.reason}</p>
          </div>
          <button type="button" className="asset-audit-locate" disabled={!item.node_id}
            aria-label={item.command_index === undefined ? "去添加" : "定位"}
            data-help-key="novel.assetAuditItem" onClick={() => { void locatePendingAsset(item); }}>
            <ArrowDownRight size={13} aria-hidden="true" />{item.command_index === undefined ? "去添加" : "定位"}
          </button>
        </article>
      ))}
      {total > 1 && <nav aria-label={optional ? "可选建议分页" : "必补资源分页"}>
        <button type="button" disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>上一页</button>
        <span aria-live="polite">{visiblePage + 1} / {total}</span>
        <button type="button" disabled={visiblePage + 1 === total} onClick={() => setPage(visiblePage + 1)}>下一页</button>
      </nav>}
    </section>
  );
}

export function NovelAssetReviewPanel({ pending }: { pending: PendingVisualAsset[] }) {
  const [optionalOpen, setOptionalOpen] = useState(false);
  const required = pending.filter(item => !item.optional);
  const optional = pending.filter(item => item.optional);
  return (
    <div className="novel-resource-review">
      <ResourceIssues items={required} />
      {optional.length > 0 && <NovelDetails title={`${optionalOpen ? "收起" : "展开"}可选建议`}
        badge={`${optional.length} 项`} open={optionalOpen} onToggle={() => setOptionalOpen(value => !value)}>
        {optionalOpen && <ResourceIssues items={optional} optional />}
      </NovelDetails>}
    </div>
  );
}
