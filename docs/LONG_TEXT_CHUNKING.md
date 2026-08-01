# Long Text Chunking

不能把整本小说一次性发送给模型，因为上下文长度、费用、失败重试和可审查性都不可控。

策略：

- 按章节优先。
- 按段落切分。
- 不截断句子和对白块。
- 控制 `max_chunk_chars`。
- 使用 `overlap_chars` 保留上下文。
- 用字符和中英文比例估算 token。

Tauri 大文件读取未来应使用 fs 插件分块读取，避免一次性渲染进 DOM。
