import React,{useState}from"react";
import{createRoot}from"react-dom/client";
import"./styles/variables.css";
import"./styles/layout.css";
import"./styles/quick-menu-preview.css";

function App(){
  const[e,setE]=useState(false);
  const icon=e?'close':'expand';
  return <main className="runtime-layout-controls-harness" style={{minHeight:'100dvh', overflow:'hidden'}}>
    <div className="runtime-quick-menu-preview-controls" data-testid="runtime-quick-menu-preview-controls" style={{position:'fixed',zIndex:10,top:8,left:8,right:8}}>
      <span>快捷菜单预览</span>
      <div className="runtime-quick-menu-preview-control-group" aria-label="预览状态">
        <button data-help-key="layout.previewControl" data-preview-quick-menu-state="collapsed" aria-pressed={!e} onClick={()=>setE(false)}>收缩</button>
        <button data-help-key="layout.previewControl" data-preview-quick-menu-state="expanded" aria-pressed={e} onClick={()=>setE(true)}>展开</button>
      </div>
    </div>
    <div className="runtime-layout-stage-wrap" style={{height:'100dvh',minHeight:0,padding:'72px 12px 12px'}}>
      <div className="runtime-layout-stage" style={{width:'auto',height:'min(427px, calc(100dvh - 84px))',maxWidth:'calc(100vw - 24px)',aspectRatio:'16 / 9'}}>
                  <div className="runtime-layout-expected-preview"
                    style={{position:'absolute', inset:0}}
                    data-preview-quick-menu-variant="C"
                    data-preview-quick-menu-state={e?'expanded':'collapsed'}
                    data-preview-quick-menu-direction="up"
                    data-preview-quick-menu-icon={icon}>
                    <div className="preview-quick-menu-preview preview-quick-menu-preview-c"
                      data-preview-quick-menu-variant="C"
                      data-preview-quick-menu-state={e?'expanded':'collapsed'}
                      data-preview-quick-menu-direction="up"
                      data-preview-quick-menu-icon={icon}>
                      <button type="button" data-help-key="layout.previewControl" className="preview-quick-menu-toggle" data-preview-quick-menu-icon={icon} data-testid="preview-quick-menu-toggle" aria-label={e ? "收缩快捷菜单预览" : "展开快捷菜单预览"} onClick={()=>setE(!e)}>
                        <span className={'preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-expand'+(!e?' is-visible':'')}>↗</span>
                        <span className={'preview-quick-menu-toggle-icon preview-quick-menu-toggle-icon-close'+(e?' is-visible':'')}>×</span>
                      </button>
                      <div className="preview-quick-menu-buttons">{Array.from({length:7},(_,i)=><button type="button" data-help-key="layout.previewControl" className="preview-quick-menu-button" key={i} aria-label={'快捷按钮'+(i+1)}>快捷按钮</button>)}</div>
                    </div>
                  </div>
                </div>
    </div>
  </main>
}

createRoot(document.getElementById('root')!).render(<App/>);