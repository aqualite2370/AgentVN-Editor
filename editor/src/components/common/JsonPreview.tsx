export function JsonPreview(_props: { value?: unknown }) {
  return (
    <details className="debug-data-preview">
      <summary>调试信息</summary>
      <p className="debug-data-note">内部数据字段已在界面中隐藏，避免与创作者可编辑内容混淆。正式导出仍会按项目协议进行校验。</p>
    </details>
  );
}
