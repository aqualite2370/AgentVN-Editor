# Git 发布工具

实现入口为 `scripts/push-agentvn-editor.ps1`。本机 `gitpush` 中的 PS1/BAT 是转发入口；
`gitpush/` 继续忽略，里面的用户图片不参与版本管理。构建、测试等源码脚本不再整目录忽略。

## 先检查，不发布

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-agentvn-editor.ps1 -CheckOnly
```

此模式不联网、不 fetch、不暂存、不提交、不推送。检查已跟踪文件、未忽略的新增候选路径及真实暂存 blob；
即使磁盘文件后来缩小或删除，暂存区中的大文件仍被拒绝。单文件默认上限为 50 MiB，
可用 `-MaxFileMiB` 在 1–100 MiB 之间显式设置。

规则拦截开发日志（包括轮转日志和 trace）、生成物、工程包、数据库、签名/环境文件、暂存符号链接及未解决冲突。强制暂存或事后删除历史提交中的这些文件，也不会绕过发布检查。
Windows 离线 NSIS 工具保留明确例外，仍受大小限制。
`.vnproj` 默认视为本机/用户数据；只有 `scripts/fixtures/` 下三份小型回归工程
（dialog-presentation、editor-isolated-small、installed-preview）例外。发布门禁将校验这三份文件的已审 SHA-256；
路径以外的工程包仍被忽略，即使强制暂存也会被拒绝；例外文件字节变化后须先重新审查并更新固定哈希。
安装 Gitleaks 8.30 或更新版本到 `PATH`、`%LOCALAPPDATA%\AgentVN\publish-tools\gitleaks.exe`，或用
`AGENTVN_GITLEAKS` 指定其绝对路径。发布用固定配置扫描暂存补丁、提交说明和实际待推历史；
缺少扫描器或扫描失败会停止。`-CheckOnly` 只扫描已暂存正文，不扫描未暂存内容和待推历史。
自动匹配不能替代人工审核；需核项目文本、图片、二进制内嵌内容和提交邮箱。

## 正常发布仅提交已暂存内容

先审核差异，再用 `git add -- <明确文件>` 选择本次内容：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\push-agentvn-editor.ps1 -Message "本次改动说明"
```

脚本仅支持 `main`，检查实际获取的远端提交和暂存空白错误，不自动合并、变基、强推或推送标签。
正常发布会 fetch，并推送本地 `main` 中所有领先远端的提交，不只本次新建提交。
提交前检查失败不会提交；若提交钩子产生的最终提交没过复查，则不会推送，已创建的本地提交保持。

确实要收录整个工作区时，才显式添加 `-StageAll`。该模式可能暂存全部合规改动，不适合混有其他任务的工作区。
发布模式的 fetch 会更新远端跟踪信息；`-StageAll` 之后若检查失败，已暂存内容保留，供人工审核，不自动回滚。

本机 BAT 同样支持 `-CheckOnly`、`-StageAll`、`-Message`。双击默认只提交已暂存内容，不再静默 `git add --all`。

## Releases 附件

Git 门禁不覆盖 Releases 附件。拟上传的安装包须另外解包审查日志、用户数据、私有素材和凭据，并核对最终上传文件的 SHA-256。

## 回归

```powershell
node scripts/gitpush-safety-test.cjs
```

测试只在 `AGENTVN_QA_ROOT` 或系统临时目录的隔离仓库及本地 bare 远端进行提交/推送，
不修改开发仓库暂存区，不访问 GitHub。各轮报告独立保留。
