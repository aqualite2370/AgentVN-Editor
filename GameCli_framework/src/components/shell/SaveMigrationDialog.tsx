import { useEffect, useState } from "react";
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
  const [selected, setSelected] = useState<string[]>([]);
  useEffect(() => setSelected([]), [open, info]);
  if (!open) return null;
  const hasFiles = Boolean(info?.availableFiles.length);
  const unverified = info?.unverifiedFiles ?? [];
  const claims = unverified.filter(file => !file.conflict && selected.includes(file.fileName))
    .map(({ fileName, sourceSha256 }) => ({ fileName, sourceSha256 }));
  const canCopy = hasFiles || claims.length > 0;
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
            : <p>{unverified.length ? "以下早期存档需要先确认归属。" : "没有待复制的旧存档。"}</p>}
          <p>源文件始终保留，同名冲突不会覆盖。不同游戏、损坏或无法识别的旧档不会导入。</p>
          {!!unverified.length && <fieldset className="save-migration-claims" disabled={pending}>
            <legend>需要确认归属的早期存档</legend>
            <p>早期存档使用通用身份，无法自动判断属于哪个游戏。请核对下方来源和剧情，仅勾选属于当前游戏的存档。确认后只修改新副本的游戏身份。</p>
            {unverified.map(file => <label key={file.fileName} className="save-migration-claim">
              <input type="checkbox" disabled={file.conflict}
                aria-label={`确认 ${file.fileName} 属于当前游戏`}
                checked={selected.includes(file.fileName)}
                onChange={event => setSelected(current => event.target.checked
                  ? [...current, file.fileName] : current.filter(name => name !== file.fileName))} />
              <span>
                <strong>{file.fileName} · {{ manual: "手动", auto: "自动", quick: "快存" }[file.saveKind]} {file.slot}</strong>
                <span>{file.createdAt || "时间未知"} · 场景：{file.sceneId}</span>
                {file.summary && <span>{file.summary}</span>}
                {file.conflict && <span>同名冲突，保留当前存档</span>}
              </span>
            </label>)}
          </fieldset>}
          {hasFiles && <p>待复制：{info.availableFiles.join("、")}</p>}
          {!!info.conflictFiles.length && <p>冲突未覆盖：{info.conflictFiles.join("、")}</p>}
          {!!info.skippedFiles.length && <p>未导入：{info.skippedFiles.join("、")}</p>}
        </>}
        {error && <p role="alert" className="save-migration-error">{error}</p>}
        {pending && <p role="status">正在处理，请勿关闭游戏或移动存档文件。</p>}
      </div>
      <div className="modal-actions">
        <Button variant="ghost" data-modal-cancel disabled={pending} onClick={close}>
          {hasFiles || unverified.length ? "暂不迁移" : "关闭"}
        </Button>
        {hasFiles || unverified.length
          ? <Button disabled={!canCopy} loading={pending} data-testid="save-migration-confirm"
              onClick={() => void confirm(claims)}>
              {error ? "重试复制" : claims.length ? "确认归属并复制" : "确认复制"}
            </Button>
          : <Button loading={pending} onClick={() => void scan()}>重新扫描</Button>}
        {!!unverified.length && <Button variant="ghost" disabled={pending} onClick={() => void scan()}>重新扫描</Button>}
      </div>
    </Modal>
  );
}
