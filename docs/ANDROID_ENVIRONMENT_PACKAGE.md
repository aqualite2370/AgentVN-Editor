# AgentVN Android 构建依赖包

Android 构建依赖采用与编辑器分离的 ZIP64 容器，推荐扩展名为 `.avnenv`。编辑器本体不内置 JDK、Android SDK/NDK、Gradle、Cargo 或 Rustup。

## 容器结构

```text
format.json
payload/
  toolchain/
    jdk-17/
    Sdk/
    node-portable/
    cargo/
    rustup/
    gradle/gradle-8.14.3-bin.zip
  gradle-home/
    caches/
    wrapper/
```

`format.json` 必须是 UTF-8 JSON，且至少包含：

```json
{
  "schemaVersion": 1,
  "kind": "agentvn-android-environment",
  "packageId": "agentvn.android.windows-x86_64.api36",
  "packVersion": "2026.08.14",
  "complete": true,
  "platform": "windows-x86_64",
  "apiLevel": "36",
  "buildToolsVersion": "36.0.0",
  "ndkVersion": "27.2.12479018",
  "gradleVersion": "8.14.3",
  "payloadRoot": "payload",
  "totalBytes": 0,
  "fileCount": 0,
  "requiredPaths": [],
  "files": []
}
```

`files[]` 的每一项必须包含相对于容器根目录的正斜杠路径、字节数和小写 SHA-256：

```json
{
  "path": "payload/toolchain/jdk-17/bin/java.exe",
  "bytes": 123,
  "sha256": "..."
}
```

## 导入约束

- 只接受 ZIP magic header 对应的 `.avnenv` 或 `.zip`。
- 必须包含根目录 `format.json`，且 `kind`、schema、平台和版本字段合法。
- 所有文件必须位于 `payload/`，不得包含绝对路径、盘符、反斜杠、空路径段、`.`、`..` 或符号链接。
- ZIP 内不得出现 manifest 未声明的文件、重复文件或缺失文件。
- 每个文件在流式解包时校验声明大小和 SHA-256；任一不一致立即失败并清理暂存目录。
- 通过校验后，依赖部署到当前用户的 `%LOCALAPPDATA%\AgentVN`，不会修改编辑器安装目录。
- 导入成功后写入 Android 环境 PASS 缓存；后续构建直接复用，不重复完整检测。

## 生成

在准备好一套已验证的本机 Android 工具链后运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File D:\AgentVN\scripts\prepare-android-offline-pack.ps1
```

默认输出到 `releases/android-environment-pack/`。该目录和 `.avnenv` 文件被 Git 忽略，不会进入编辑器安装包。

## 在线回退

“一键补齐环境”优先使用国内源：

- Node.js：npmmirror；
- Rust/Rustup/Cargo：rsproxy；
- Gradle distribution：阿里云镜像；

国内源失败后再尝试对应官方源。Android SDK Command-line Tools 和 SDK/NDK 包仍由 Google 官方仓库提供；网络不稳定时应优先使用 `.avnenv`。
