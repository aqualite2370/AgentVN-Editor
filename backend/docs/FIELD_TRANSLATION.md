# Field Translation

代码字段名保持英文；本文件提供中文对照。

## GameCommand

通用字段：

- `type`：指令类型

`DialogCommand`：

- `character_id`：角色 ID
- `text`：台词文本
- `emotion`：当前表情或情绪
- `portrait`：头像或半身像资源 ID
- `voice`：语音资源 ID，可选
- `side`：角色显示位置，可选 `left` / `right` / `center`

`NarrationCommand`：

- `text`：旁白文本

`BackgroundCommand`：

- `background_id`：背景资源 ID
- `transition`：转场效果，例如 `fade`、`cut`、`slide`

`ShowImageCommand`：

- `image_id`：聚焦展示的图片类素材 ID
- `image_fit`：图片填充方式，可选 `contain`、`cover`、`stretch`
- `image_display_name`：作者侧可读名称
- `caption`：图片下方说明
- `alt`：无障碍图片描述
- `backdrop_opacity`：背景暗度，范围 `0..0.9`
- `backdrop_blur_px`：背景模糊像素，范围 `0..24`

`SpriteCommand`：

- `character_id`：角色 ID
- `sprite_id`：立绘资源 ID
- `position`：立绘位置
- `animation`：立绘动画
- `visible`：是否显示

`ChoiceCommand`：

- `choices`：选项列表
- `choice_id`：选项 ID
- `text`：选项显示文本
- `target_scene_id`：选择后跳转的场景 ID
- `conditions`：显示或可选条件

`StateUpdateCommand`：

- `key`：运行时变量名
- `operation`：操作类型，可选 `set`、`add`、`subtract`、`toggle`、`append`、`remove`
- `value`：变量值

`AnimationCommand`：

- `animation_id`：动画资源或动画预设 ID
- `target`：动画作用目标，例如 `background`、`sprite:alice`、`screen`
- `params`：动画参数，例如 `duration`、`easing`、`offset`
- `blocking`：是否阻塞后续剧情执行

`BgmCommand`：

- `bgm_id`：背景音乐资源 ID
- `action`：播放动作，可选 `play`、`stop`、`fade`
- `volume`：音量
- `fade_ms`：淡入淡出时间，毫秒

`SfxCommand`：

- `sfx_id`：音效资源 ID
- `volume`：音量

`CameraCommand`：

- `action`：镜头动作，例如 `shake`、`zoom`、`pan`
- `params`：镜头参数
- `blocking`：是否阻塞后续剧情

`WaitCommand`：

- `duration_ms`：等待时间，毫秒

## SceneBeat

- `scene_id`：场景 ID
- `title`：场景标题
- `summary`：场景摘要
- `commands`：场景内指令列表
- `tags`：标签
- `chapter`：所属章节编号

## AssetRef

- `asset_id`：资源 ID
- `asset_type`：资源类型，可选 `background`、`sprite`、`portrait`、`bgm`、`sfx`、`voice`、`video`、`animation`、`ui`
- `metadata`：资源元数据

## MemoryUpdate

- `summary_100`：100 字以内剧情摘要
- `invalidated_relations`：需要失效的旧关系
- `new_relations`：需要新增的关系
- `emotion_snapshots`：角色情绪快照

## ChronicleGraph

- `id`：关系边 ID
- `source`：关系来源实体
- `target`：关系目标实体
- `relation`：关系类型
- `valid_since_chapter`：从第几章开始有效
- `invalidated_at_chapter`：从第几章开始失效
- `is_active`：是否仍然有效
- `confidence`：置信度
- `source_scene_id`：该关系来源场景
- `note`：备注

## EmotionTrace

- `id`：记忆 ID
- `character_id`：角色 ID
- `summary`：记忆摘要
- `embedding`：向量嵌入
- `memory_strength`：记忆强度
- `original_emotion`：初始情绪
- `current_emotion`：当前情绪
- `created_at_chapter`：创建章节
- `last_accessed_chapter`：上次访问章节
- `source_scene_id`：来源场景
- `valence`：情绪效价，正向或负向
- `arousal`：情绪唤醒度，激烈或平静
- `dominance`：情绪控制感，主动或被动
- `embedding_similarity`：语义相似度
- `recency_score`：时间近因分数
- `emotion_relevance`：情绪相关性
- `recall_score`：最终召回分数

## API Request

`GenerateSceneRequest`：

- `current_scene`：当前场景
- `previous_summary`：前情摘要
- `author_goal`：作者生成目标
- `memory_mode`：记忆模式
- `chapter`：当前章节
- `character_id`：可选角色过滤 ID

`ExtractMemoryRequest`：

- `scene`：需要抽取记忆更新的场景
- `memory_mode`：记忆模式
- `chapter`：当前章节

`SetMemoryModeRequest`：

- `memory_mode`：记忆模式

## API Response

`HealthResponse`：

- `status`：服务状态
- `service`：服务名称

`ApplyMemoryUpdateResponse`：

- `invalidated_relations`：已失效关系数量
- `new_relations`：已新增关系数量
- `emotion_snapshots`：已新增情绪记忆数量

`MemoryModeResponse`：

- `memory_mode`：当前记忆模式

## MemoryMode

- `none`：不启用长期记忆
- `chronicle_graph_only`：只启用客观时序图谱
- `emotion_trace_only`：只启用主观情感记忆
- `hybrid`：同时启用 ChronicleGraph 和 EmotionTrace
