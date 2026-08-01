# Field Translation

| Field | 中文名 | 用途 |
| --- | --- | --- |
| `schema_version` | 格式版本 | 标识工程或剧本格式 |
| `project_id` | 项目 ID | 编辑器工程唯一标识 |
| `title` | 标题 | 项目或场景标题 |
| `author` | 作者 | 工程作者 |
| `nodes` | 节点 | React Flow 编辑器节点 |
| `edges` | 连线 | React Flow 节点连接 |
| `viewport` | 视口 | 画布位置与缩放 |
| `memory_mode` | 记忆模式 | 工程默认记忆模式 |
| `asset_manifest` | 资源清单 | 资源引用占位 |
| `editor_settings` | 编辑器设置 | UI 和编辑器内部配置 |
| `created_at` | 创建时间 | 工程创建时间 |
| `updated_at` | 更新时间 | 工程更新时间 |
| `scene_id` | 场景 ID | Runtime 场景标识 |
| `summary` | 场景摘要 | 用于预览和 AI 上下文 |
| `commands` | 指令列表 | 场景内 GameCommand |
| `tags` | 标签 | 场景标签 |
| `chapter` | 章节 | 所属章节 |
| `nodeKind` | 节点类型 | 编辑器节点类别 |
| `scene` | 场景数据 | SceneNode 的 SceneBeat |
| `label` | 显示名称 | 节点标题 |
| `description` | 节点说明 | 节点辅助描述 |
| `memoryMode` | 记忆模式 | 节点局部记忆模式 |
| `aiSettings` | AI 设置 | 作者目标与记忆抽取设置 |
| `previewState` | 预览状态 | 编辑器预览进度 |
| `editorMeta` | 编辑器元数据 | Inspector 折叠和调试信息 |
| `character_id` | 角色 ID | 对话或立绘角色 |
| `text` | 文本 | 台词、旁白或选项文本 |
| `emotion` | 情绪 | 角色当前情绪 |
| `background_id` | 背景 ID | 背景资源引用 |
| `background_fit` | 背景显示模式 | 背景图使用 stretch / contain / cover 的填充方式 |
| `image_id` | 展示图片 ID | show_image 聚焦覆盖层引用的图片类素材 |
| `image_fit` | 展示图片模式 | contain / cover / stretch |
| `image_display_name` | 展示图片名称 | 作者侧可读名称与缺失素材提示 |
| `caption` | 图片说明 | 聚焦图片下方的剧情说明 |
| `alt` | 图片替代文本 | 无障碍图片描述 |
| `backdrop_opacity` | 背景暗度 | show_image 覆盖层暗度，范围 0..0.9 |
| `backdrop_blur_px` | 背景模糊 | show_image 覆盖层模糊像素，范围 0..24 |
| `choice_id` | 选项 ID | 稳定动态 handle |
| `target_scene_id` | 目标场景 ID | 选择后的跳转目标 |
| `key` | 变量名 | Runtime 状态变量 |
| `operation` | 操作 | Runtime 状态修改方式 |
| `value` | 值 | Runtime 状态值 |
| `animation_id` | 动画 ID | 动画资源或预设 |
| `blocking` | 是否阻塞 | 是否等待动画完成 |
