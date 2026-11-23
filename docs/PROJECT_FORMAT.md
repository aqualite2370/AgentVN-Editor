# AgentVN 工程文件格式

## 三种工程相关文件

1. 可移植 `.vnproj`：新的用户保存格式，是 ZIP/Zip64 容器。
2. 旧 `.vnproj`：历史 UTF-8 JSON，仅作为兼容输入；允许 UTF-8 BOM。
3. 时间线备份：`backup-timeline` 内部 JSON 快照，元数据包含 `backupFormat: "json-timeline"`，不用于跨机器交换。

玩家发行卡带仍使用 `.vncart`，不属于 `.vnproj` 工程格式。

## ZIP `.vnproj`

容器必须包含：

- `project.json`：编辑器工程、节点、设置、素材分类和素材元数据。
- `assets/...`：素材原始字节。

容器通常还包含：

- `format.json`：格式版本、素材数量、总字节数、`project.json` SHA-256 和逐素材 SHA-256。

`asset_manifest[].metadata.project_path` 必须逐字对应一个 `assets/...` 条目。`project.json` 不得携带 `data_url`、`blob_url`、本机 `filePath`、后端 URL 或 `backend_asset_path`。媒体条目使用 Store，JSON 使用 Deflate；桌面写入器启用 Zip64，不设置 448MB 或 4GiB 应用上限。

桌面版把本地文件直接交给 Rust 流式写入。只有临时 `blob:`/URL 素材会按 4MiB 分块暂存到应用缓存，然后由同一个 Rust 写入器封包。工程先写入临时文件，校验并刷盘后再原子替换目标文件。

## 识别和编码

- 文件头为 `PK\x03\x04`：按 ZIP 工程读取。
- 其他输入：仅按严格 UTF-8 JSON 读取，可兼容 UTF-8 BOM。
- 新写出的 `project.json`、`format.json` 和时间线元数据均为 UTF-8 无 BOM。
- 非 ZIP、非合法 JSON 返回 `PROJECT_CONTAINER_INVALID`，不得静默返回空工程。

## 安全和完整性

导入器拒绝绝对路径、盘符路径、反斜杠路径、`..`、重复条目、符号链接和异常压缩比条目。素材缺失、大小不一致或 SHA-256 不一致均中止导入，不保存残缺工程。

统一错误码：

- `PROJECT_CONTAINER_INVALID`
- `PROJECT_ZIP_PATH_UNSAFE`
- `PROJECT_ASSET_MISSING`
- `PROJECT_ASSET_HASH_MISMATCH`
- `PROJECT_DISK_FULL`
- `PROJECT_IMPORT_INTERRUPTED`
- `LEGACY_JSON_SIZE_LIMIT`
- `TIMELINE_BACKUP_JSON_ONLY`

旧 JSON 兼容导入保留 512MiB 安全上限；此限制不适用于 ZIP `.vnproj`。
