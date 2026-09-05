# Changelog

所有显著变更将记录于此。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.1.9] - 2026-09-05

> ⚠️ **版本支持**：本节改动将随 `0.1.9` 发布；自 `0.1.9` 起，本插件仅支持 DSH `>= 0.1.2-rc.1` 且 `< 0.1.3`（安装节有同样提示）。

### 缺陷修复
- **折叠条行距对齐官方**：`.ccxBar` 去掉上下 `3px` 透明内边距（`padding:0`）。条是无边框无背景元素，透明 padding 会被读成行间白边——实测每侧多出 3px（条↔行 30px、条↔条 33px，而官方行↔行字墨边距 27px = 流 `margin-top:16px` + 24px 行盒内字墨各 ~5.5px）。官方行本身零内边距，去掉后折叠条回到同一节奏。
- **思考行复活**：答案流进曾被清空隐藏的思考行时自动恢复可见，不再误判为空行。
- **关引擎保留卡片样式**：引擎规则与卡片 chrome 拆成两个 style 标签，停用折叠不再剥掉卡片外观。
- **压掉 16px 空带**：隐藏思考的 wrapper 一并折叠，回答上方不再留空。

### 功能变更
- **思考显示三档下拉**（自动跟随官方折叠 / 始终保留 / 始终隐藏，默认自动）：原来自动开着时保留是个摆设，现在没有无效组合；老配置自动沿用，可回滚。设置卡与 README 已同步。
- **总开关**：一键停用/恢复全部折叠（关闭后聊天回到产品默认显示，卡片常驻随时可重开）。
- **跟随官方 Compact 折叠**：官方收起整块过程时思考自动保留可见（即下拉的默认档）。
- **版本不匹配警告**：运行的 DSH 超出支持范围时，设置卡显示 ⚠ 图标（hover 看详情）并打一条一次性 console 警告。
- **适配 DSH 0.1.2**：`settingsNamespace()` helper 被移除，改用裸字符串命名空间；新增 `engines.dsh` 下限，删除 `dsh-settings` peer 依赖。

### 工程变更
- **浏览器半模块化**：`lib/client.js`（约 2244 行单文件）与字符串手术生成的 `lib/dynamic-body.js` 重构为 `src/client/` 下的模块源（`settings` / `bridge` / `styles` / `engine` / `card` / `react-env` / `index`），由 tsdown 构建（`tsdown.config.mjs`，与 host 半共三个 entry）：
  - `lib/client.js(.map)` —— 安装通道 loader 产物（`window.__ModuleLoader__.load`，经 `exports["./client"]` 加载），行为与旧文件一致；
  - `lib/dynamic-body.js(.map)` —— 动态通道 body（同一模块图去掉 loader 包装），供动态插件会话与 `tools/live-probe.mjs` 使用；
  - React 不再静态导入：构建 wrapper 将通道提供的 React 种入 `globalThis.__dshToolfoldReact`（安装通道 `require('react')` / 动态通道闭包参数 `React`），无 React 的无头环境仅跳过设置卡片注册。
- **构建期产物**（删除旧生成器 `lib/build-dynamic.cjs`）：`lib/client.js` / `lib/dynamic-body.js`（及 `.map`）已 gitignore，由 `prepare: pnpm build`（tsdown）重建——`pnpm publish` 与 git-hosted 安装都会先跑 prepare 再打包，`files` 白名单只含构建产物（`lib/index.js`、`lib/client.js`，不含 src / map）。`package.json` 增加 `prepare` / `build` / `build:watch` 脚本与 `tsdown` devDependency。改动流程：只改 `src/` → `pnpm build` → 验证。
- **host 半搬家**：`lib/index.js` → `src/host/index.js`（与 `src/client/` 对称；ESM，无需 scoped package.json），由 tsdown 第三个 entry（`platform: 'node'`，`schemastery` 保持 external）构建回 `lib/index.js`——`main` / `exports["."]` / `files` 指向不变。至此 `lib/` 下 100% 生成物，`.gitignore` 收成一行 `lib/`（源码层/产物层不再混放）。
- **工具去本机硬编码**：`jsdom`（29.1.1）与 `playwright`（1.61.1）收为 devDependencies，`tools/engine-smoke.mjs` / `tools/live-probe.mjs` 改按包名解析；live-probe 的 Chrome 路径改为 `CHROME_PATH` 环境变量优先，否则按平台取第一个存在的默认位置。`pnpm install` 后 `test:engine` / `probe:live` 开箱即用。
- **新增 `pnpm-lock.yaml`**：安装可重复。
- **发布管线**：Publish 前加 `pnpm install`；dry-run 校验 + `--provenance` OIDC 可信发布；发布条件收窄为仅 release 触发（取消手动发布）；`engines.dsh` 上限收窄到 `<0.1.3`。

## [0.1.8] - 2026-08-28

### Fixed
- 修复运行时收起"先动一下再突然收起"：当模型产生大量工具调用、且它们是最新信息时，run 在收起动画期间仍在增长。旧实现（自 0.1.3 起）假定行集合固定：折叠条点击闭包持有的是创建时的旧 run 快照，动画只覆盖原始行，随后按旧行数计时的完成定时器把整个增长后的 run 一次性合并，新流入的行瞬间消失。现点击改为操作当前 run（`bar._ccxRun`）而非创建时快照；`syncBars` 将动画期间新增的行折入同一瀑布（`extendCollapse`：rise 类 + 高度收缩 + 各自 stagger）并重排完成定时器（`armCollapseFinish`），最后一行动画结束才应用合并。（`lib/client.js`, `lib/dynamic-body.js`）

### Changed
- npm 发布工作流增加 OIDC 权限（`id-token: write`、`contents: read`），发布改用 OIDC 身份认证（移除 `NODE_AUTH_TOKEN` 环境变量），并禁用 `package-manager-cache`。
- `package.json` 增加 `repository` 字段指向 GitHub 仓库。
- 重构 README：重组章节（安装、快速开始、默认行为、功能、设置、性能、限制），新增"默认行为 – 首次使用"说明（为什么思考会消失、为什么调用默认分组，以及快速修复指引），补充安装方法与徽章，并同步翻译为 `README.en.md`。

## [0.1.7] - 2026-08-26

### Fixed
- npm 发布命令增加 `--no-git-checks`，跳过 pnpm 的 git 状态检查，避免在 CI 检出态下发布失败。

### Changed
- 将发布工作流 Node 版本由 `lts/*` 固定为 `24`，与当前构建环境对齐。

## [0.1.6] - 2026-08-26

### Fixed
- 修复 WSL `bash` 工具在折叠后标题消失的问题。`BashRow` 使用 `data-sample="bash"` 独立渲染，无 `data-disclosure-row`，旧克隆逻辑回退到空的 `[data-tool]` 导致折叠条只剩计数。现按优先级克隆：`[data-disclosure-row]`（通用 `ToolRow` / `pwsh`）→ `[data-sample="bash"]`（Bash 头部）→ `[data-tool]` 首子 → `lastRow.firstElementChild`，并保持 120 ms 节流。（`lib/client.js`, `lib/dynamic-body.js`）

### Changed
- 重构 npm 发布工作流 `.github/workflows/npm-publish.yml`：改为 `release.created` 触发，使用 `pnpm@11` + `setup-node` LTS 并通过 `secrets.npm_token` 发布。

## [0.1.5] - 2026-08-21

### Added
- 兼容 DSH `v0.1.1-rc1` 的设置存储与类型。

### Fixed
- 修正 `peerDependencies` 中 `@deepseek-ai/dsh-settings` 的预发布版本区间（`>=0.1.0-rc.7 <0.1.1 || >=0.1.1-rc.0 <0.1.2`），避免 pnpm 解析冲突。

## [0.1.4] - 2026-08-20

### Fixed
- 适配 DSH 0.2.4 `settings.plugin.item` 由 `list` 改为 `keyed`：注册时同时提供 `key: 'toolfold'` 与 `id`，`toolfold settings card failed to register` 消失，设置卡在新版 Web 中重新出现。
- 同步 `peerDependencies`：`@deepseek-ai/dsh-settings@^0.1.0-rc.7` 与实际 `0.0.1-rc.1` 的差异说明。

## [0.1.3] - 2026-08-16

### Fixed
- 修复多条目折叠动画尾段卡顿：`ccxRise` 与高度收缩统一使用 `cubic-bezier(0,0,0.58,1)`，清理计时改为 `max(0,N-1)*step+dur+60`（收起）/`+260`（吸底），长卡片不再“先透明后瞬收”。

### Changed
- 更新依赖 `deepseek-seetings` 版本。

## [0.1.2] - 2026-08-16

### Added
- `splitThink`（思考分隔调用组）默认开启：已完成的思考把前后两组工具调用隔开、各自独立折叠；关闭时恢复旧的“思考并入同组”行为。

### Fixed
- 修复 `think` 若在两工具块之间整组被误合并为一条折叠条的问题。

## [0.1.1] - 2026-08-16

### Added
- 首个可用版本：连续 `tool-call` 折叠为最后一条的单行摘要 + “已折叠 N 个工具调用”，支持 `durMs / keepThink / splitThink / stats` 四项设置（DSH `settings` 服务 → `~/.dsh/settings.yaml`，回退到 Host 路由与 `localStorage`）与瀑布动画。
- `toolfold` 远端包与一键安装、设置双半通信（Host `GET/POST /api/dsh-toolfold/settings` + Client 桥）。

[0.1.9]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Minecraftbe/dsh-toolfold/releases/tag/v0.1.1
