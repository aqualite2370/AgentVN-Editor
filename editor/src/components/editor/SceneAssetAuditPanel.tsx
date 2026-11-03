import { ArrowDownRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import type { PendingVisualAsset } from "../../types/assets";
import type { SceneAssetAudit } from "../../utils/assetAudit";

export function SceneAssetAuditPanel({ audit, onLocate }: {
  audit: SceneAssetAudit;
  onLocate: (item: PendingVisualAsset) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [optionalMounted, setOptionalMounted] = useState(false);
  const required = audit.pending.filter(item => !item.optional);
  const optional = audit.pending.filter(item => item.optional);
  const row = (item: PendingVisualAsset) => (
    <article key={item.id} className={item.optional ? "is-optional" : item.placeholder ? "is-placeholder" : ""}
      data-command-index={item.command_index} data-field={item.field} data-asset-id={item.asset_id}>
      <span>{item.optional ? "可选" : item.placeholder ? "占位" : "必补"}</span>
      <div>
        <strong>{item.label}</strong>
        <small>{item.location}{item.asset_id ? ` · ${item.asset_id}` : ""}</small>
        <p>{item.reason}</p>
      </div>
      <button type="button" className="asset-audit-locate" aria-label={`定位：${item.label}`}
        onClick={() => onLocate(item)}>
        <ArrowDownRight size={13} aria-hidden="true" />{item.command_index === undefined ? "去添加" : "定位"}
      </button>
    </article>
  );
  return (
    <section className="inspector-asset-audit" aria-label="场景资源检查">
      <header><strong>待补资源</strong><span>{required.length} 项必补 / {optional.length} 项可选</span></header>
      <p className="asset-audit-scope">检查当前场景命令的素材引用；已登记文件的可读性由导出校验进一步确认。</p>
      <div className="inspector-asset-audit-list">{required.map(row)}</div>
      {required.length === 0 && <p className="asset-audit-empty">当前场景没有发现必补资源。</p>}
      {optional.length > 0 && <>
        <button type="button" className="asset-audit-optional-toggle" aria-expanded={expanded}
          onClick={() => {
            if (!expanded) setOptionalMounted(true);
            setExpanded(value => !value);
          }}>
          <ChevronDown size={14} aria-hidden="true" />
          {expanded ? "收起可选建议" : "展开可选建议"}（{optional.length}）
        </button>
        <div className={`asset-audit-optional${expanded ? " is-expanded" : ""}`}
          aria-hidden={!expanded} inert={!expanded}
          onTransitionEnd={event => {
            if (event.target === event.currentTarget && !expanded) setOptionalMounted(false);
          }}>
          <div className="inspector-asset-audit-list">{optionalMounted && optional.map(row)}</div>
        </div>
      </>}
    </section>
  );
}
