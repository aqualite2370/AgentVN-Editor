# GameCLI Runtime Modes

GameCLI 是后续统一玩家容器。卡带是内容载体，容器负责导入、加载、存档、设置和实际播放。

## library

默认模式。启动后进入游戏库，允许导入、移除和切换多个 `.vncart` 卡带。适合通用玩家客户端。

## preview

编辑器预览模式。启动参数为：

```text
--mode preview --cartridge <path>
```

容器绕过游戏库，读取指定临时卡带后进入标题菜单。预览使用独立 install id，避免污染正式卡带库和发布产物；是否开始或继续游戏由标题菜单上的明确按钮决定。

## fixed

固定卡带模式。用于“非卡带”单游戏发布包，但实现仍然是 GameCLI 容器 + 内嵌固定卡带。

启动参数可显式指定：

```text
--mode fixed --cartridge <path>
```

也可以通过 `public/runtime-mode.json` 设置 `{ "mode": "fixed" }`，并把卡带放在 `public/embedded-cartridge/game.vncart`。固定模式隐藏游戏库、导入、移除和切换入口，只允许运行随包内置的那一张卡带。启动后同样先进入标题菜单，再由玩家选择开始、继续或重新开始。
