import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryState {
  error?: Error;
}

export class AppErrorBoundary extends Component<{ children: ReactNode }, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("编辑器界面发生错误", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-error-boundary">
        <section>
          <strong>页面加载失败</strong>
          <p>编辑器遇到界面错误，但没有清空整个页面。请刷新页面或返回项目主页后重试。</p>
          <small>{this.state.error.message}</small>
          <button type="button" data-help-key="app.reload" onClick={() => window.location.reload()}>刷新页面</button>
        </section>
      </main>
    );
  }
}
