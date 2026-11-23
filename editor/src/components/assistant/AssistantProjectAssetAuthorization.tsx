import { useState } from "react";
import type { AssetRef } from "../../types/assets";
import { projectCreationAssetMime } from "../../assistant/projectAssetAuthorization";

export function AssistantProjectAssetAuthorization({ assets, selectedIds, busy, onToggle }: {
  assets: readonly AssetRef[]; selectedIds: readonly string[]; busy: boolean;
  onToggle: (id: string, checked: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const visible = assets.filter(asset => `${asset.metadata.display_name ?? ""} ${asset.metadata.filename ?? ""}`
    .toLocaleLowerCase("zh-CN").includes(search.trim().toLocaleLowerCase("zh-CN")));
  return <section className="assistant-creation-authorized-components"
    data-testid="assistant-creation-authorized-project-assets" aria-label="本会话可用的工程素材">
    <header><strong>本会话授权工程素材</strong><span>{selectedIds.length}/16 · 默认不授权</span></header>
    <p>仅向 AI 提供选中图片的本次别名、文件名与格式。字节、路径和生成来源留在本机；撤销只影响后续请求。</p>
    <label className="assistant-creation-component-search"><span>搜索工程素材</span>
      <input aria-label="搜索工程素材" value={search} placeholder="按名称或文件名筛选"
        onChange={event => setSearch(event.currentTarget.value)} /></label>
    {visible.length ? <ul>{visible.map(asset => {
      const name = asset.metadata.display_name || asset.metadata.filename || "未命名素材";
      const compatible = Boolean(projectCreationAssetMime(asset));
      const checked = selectedIds.includes(asset.asset_id);
      return <li key={asset.asset_id}><label>
        <input type="checkbox" aria-label={`授权工程素材 ${name}`} checked={checked}
          disabled={busy || !compatible || (!checked && selectedIds.length >= 16)}
          onChange={event => onToggle(asset.asset_id, event.currentTarget.checked)} />
        <span><strong>{name}</strong><small>{compatible
          ? "图片 · 本机独立副本 · 单项不超过 8 MiB"
          : "当前组件仅支持 PNG/JPEG/WebP/GIF；此素材不能绑定"}</small></span>
      </label></li>;
    })}</ul> : <p>{assets.length ? "没有匹配的工程素材。" : "当前工程没有素材；可在素材库导入后逐项授权。"}</p>}
  </section>;
}
