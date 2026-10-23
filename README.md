# PetPal · DSH 插件

把 [petdex.dev](https://petdex.dev) 的宠物放进 DSH 自己的宠物目录，并由**自带的桌面小应用**把宠物画在桌面上 —— 关掉 Harness 窗口后宠物仍然在。

宠物格式和 Petdex / Codex 完全一致，下载的就是同一套雪碧图，不需要转换：

```
~/.dsh/pets/<slug>/
  pet.json          # id / displayName / description / spritesheetPath
  spritesheet.webp  # 8 列雪碧图，每帧 192×208，9 行状态
```

只有安装位置换成了 DSH 的 `~/.dsh/pets`，与 Codex 的 `~/.codex/pets` 互不影响。

## 安装

需要 macOS 12+ 和 DSH 0.2.1+。

```bash
dsh plugin --profile <profile> add github:flowers-59f/dsh-petpal
```

安装后重启 DSH，打开 **设置 → 宠物**。插件市场收录后也可以从 **插件 → 发现** 安装。

## 组成

| 部分 | 作用 |
| --- | --- |
| Host `index.js` | 宠物库（列目录、删除、切换）、雪碧图静态服务、`ui.json` 配置、把 Harness 的会话事件投影成宠物状态与气泡。 |
| Client `client.js` | 只注册一个「设置 → 宠物」页面：已安装列表、外观设置和实时预览。 |
| Desktop `desktop/` | 原生 macOS 桌面宠物（Swift + WKWebView，约 300 行）。无边框透明置顶窗口，可拖动、可点击穿透，支持 9 种动画状态与气泡。 |

桌面端只读文件，不联网、不开端口：

```
~/.dsh/pets/.petdex/ui.json        active / scale / bubbles / 字号 / 宽度 / 停留 / 穿透
~/.dsh/pets/.petdex/activity.json  各会话的最近活动 { seq, sessions: [{ id, title, status, label, detail, tokens, hold, rev }] }
~/.dsh/pets/.petdex/app.pid        进程号，插件据此避免重复启动
~/.dsh/pets/.petdex/boot-error.log 插件激活失败时的堆栈（正常为空）
```

## 设置页能力

- **桌面宠物**：显示运行状态，一键启动/停止；切换宠物或外观后即时生效（桌面端每 0.35 秒读一次配置）。
- **已安装**：真实读取 `~/.dsh/pets` 里可用的宠物，带循环动画预览，可切换、删除。
- **下载宠物**：粘贴 Petdex 宠物页面链接或宠物标识（slug），先显示宠物预览图和「下载」按钮；点下载即安装到 `~/.dsh/pets` 并切换过去，不需要安装 Codex。
- **外观**（参考 Petdex 的选项）：
  - 宠物大小 50%–200%
  - 气泡开关、气泡字号 9–28px、气泡宽度 160–560px、气泡停留 0–30 秒（0 = 一直显示）
  - 气泡背景色（默认黑色）、整体不透明度 0–100%（默认 100%，无阴影）、气泡文字颜色（默认白色）
  - 点击穿透（开启后鼠标可穿过宠物，但也不能拖动）
  - 顶部有实时预览：当前宠物 + 当前字号/宽度的示例气泡

## 下载宠物

设置 → 宠物 → 下载宠物：

1. 打开 [petdex.dev](https://petdex.dev)，进入喜欢的宠物页面，复制浏览器地址栏里的链接（或链接最后一段的宠物标识）
   - 宠物页面：`https://petdex.dev/pets/cat-in-the-box-shaco`
   - 宠物标识（slug）：`cat-in-the-box-shaco`
2. 把链接或标识粘贴到输入框，点「查找」
3. 界面会显示这只宠物的预览图、名字和介绍，点「下载并使用」
4. 插件读取 petdex.dev 的安装脚本，把 `pet.json` 和雪碧图下载到 `~/.dsh/pets/<slug>`，并切换为当前宠物

已经安装过的宠物会显示「使用」或「使用中」，不会重复下载。

> `npx petdex install` 默认安装到 `~/.codex/pets`（Codex 的目录），本插件不会读取那个目录。没有 Codex 的用户直接用上面的下载入口即可。

## 桌面宠物的行为

- 始终置顶、不抢焦点、不占 Dock（`LSUIElement`），出现在所有桌面空间。
- 随 Harness 退出：宠物记着启动它的 Harness 进程 PID，Harness 正常退出或崩溃后 2 秒内自动结束，不会留下孤儿进程。
- 拖动改位置，位置写回 `ui.json`；点一下会挥手。
- 跟着 Harness 活动变状态：开始任务 → 跳，工具调用 → 跑，等待确认 → 等待，完成 → 挥手，失败 → 失败。
- 会话结束或停止后会回到 idle：Host 监听 `agent/status` 的 idle 信号，并带 45 秒 / 工具 2 分钟的超时兜底，漏事件也不会一直“运行中”。
- 气泡只有两行：第一行是会话标题，第二行只显示一行当前动作。状态文案与 DSH 一致：正在分析请求 / 准备运行命令 / 正在运行命令 / 执行了命令 / 正在生成回复；状态后面按 DSH 的 ` · 详情` 规则显示命令说明、文件、推理最后一段（去掉 `**`、截 160 字）等，保持在同一条单行里，超出用省略号截断。回复中直接显示 agent 输出。
- 气泡默认是黑底白字、没有阴影；可在「外观」里设置背景色、文字颜色和整体不透明度（作用于整个气泡，包括文字和图标；0% 为完全透明）。设置页的预览底板固定为白色，不透明度只影响气泡本身。
- 每个会话一个气泡。多个会话时默认只显示最新一个（带 `+N`），点击展开全部，再点「收起」折叠。
- 流式输出只更新气泡文字，不重启宠物动画和气泡里的转圈动画。
- 拖动由定时器驱动，回复流式输出时也能正常拖动；拖动时按水平方向播放 `running-left` / `running-right`。
- 拖动宠物时按水平方向播放 `running-left` / `running-right`，松手回到当前活动对应的动作；点一下会挥手。
- 点击气泡会激活 DeepSeek Harness 窗口（DSH 目前没有会话级深链，因此无法直接定位到具体会话）。
- 兼容 9 行（1536×1872）与 11 行（ChatGPT 导出，1536×2288）两种网格，自动按宽度缩放。

## 构建桌面端

安装包里已经带了编译好的 `desktop/PetdexPet.app`。改过 `desktop/main.swift` 或 `desktop/web/index.html` 后重新构建：

```bash
bash desktop/build.sh     # 需要 macOS 命令行工具（swiftc），无第三方依赖
```

> 改了 Host `index.js` / Client `client.js` 后需要重启一次 Harness：DSH 的 HMR 只热重载 profile 配置（`hmr.root` 默认为空），不会热重载插件模块。也可以先用 `plugin_manager` 禁用再启用 `dsh-petpal` bundle 来重载。桌面宠物本身可以随时单独重启。
>
> 插件激活出错时不会让整个 Harness 启动失败：异常会写入 `~/.dsh/pets/.petdex/boot-error.log`，其余功能继续可用。

## 效果

![气泡：会话标题 + 一行当前动作](docs/bubble.png)

## 卸载

设置 → 插件里停用或移除本插件即可。宠物文件留在 `~/.dsh/pets`；如果桌面宠物还在运行，先在「设置 → 宠物」里关掉「桌面宠物」，或者直接结束 `PetdexPet` 进程。

## License

MIT © 2026 flowers-59f
