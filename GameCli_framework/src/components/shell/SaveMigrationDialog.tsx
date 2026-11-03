import { useRuntimeStore } from "../../store/runtimeStore";
import { Button } from "../common/Button";
import { Modal } from "../common/Modal";
import "./save-migration.css";

/** Windows fixed-game migration uses existing modal focus/back/transition semantics. */
export function SaveMigrationDialog() {
  const open = useRuntimeStore(state => state.saveMigrationOpen);
  const info = useRuntimeStore(state => state.saveStorageInfo);
  const pending = useRuntimeStore(state => state.saveMigrationPending);
  const error = useRuntimeStore(state => state.saveMigrationError);
  const close = useRuntimeStore(state => state.closeSaveMigration);
  const scan = useRuntimeStore(state => state.openSaveMigration);
  const confirm = useRuntimeStore(state => state.confirmSaveMigration);
  if (!open) return null;
  const hasFiles = Boolean(info?.availableFiles.length);
  return (
    <Modal title="复制旧存档到游戏目录？" onClose={close}>
      <p>本游戏的存档保存在游戏 EXE 旁的 saves 文件夹中。目录不可写时会报错，不会改存到 AppData。</p>
      <div className="save-migration-details" data-testid="save-migration-details">
        {info && <>
          <dl>
            <dt>当前存档目录</dt><dd>{info.targetDirectory}</dd>
            {info.sourceDirectory && <><dt>旧存档目录（仅复制）</dt><dd>{info.sourceDirectory}</dd></>}
          </dl>
          {hasFiles ? <p>可复制 {info.availableFiles.length} 个旧存档。</p>
            : <p>没有待复制的旧存档。</p>}
          <p>源文件始终保留。同名冲突不会覆盖；不同游戏、损坏或无法识别的旧档不会导入。</p>
          {hasFiles && <p>待复制：{info.availableFiles.join("、")}</p>}
          {!!info.conflictFiles.length && <p>冲突未覆盖：{info.conflictFiles.join("、")}</p>}
          {!!info.skippedFiles.length && <p>未导入：{info.skippedFiles.join("、")}</p>}
        </>}
        {error && <p role="alert" className="save-migration-error">{error}</p>}
        {pending && <p role="status">正在处理，请勿关闭游戏或移动存档文件。</p>}
      </div>
      <div className="modal-actions">
        <Button variant="ghost" data-modal-cancel disabled={pending} onClick={close}>
          {hasFiles ? "暂不迁移" : "关闭"}
        </Button>
        {hasFiles
          ? <Button loading={pending} data-testid="save-migration-confirm" onClick={() => void confirm()}>
              {error ? "重试复制" : "确认复制"}
            </Button>
          : <Button loading={pending} onClick={() => void scan()}>重新扫描</Button>}
      </div>
    </Modal>
  );
}
