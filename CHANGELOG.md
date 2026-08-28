# Changelog

所有显著变更将记录于此。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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

[0.1.8]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Minecraftbe/dsh-toolfold/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Minecraftbe/dsh-toolfold/releases/tag/v0.1.1
