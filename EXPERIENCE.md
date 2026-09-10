# dsh-toolfold 实战沉淀（配套 AGENTS.md）

> 历次结对的根因、修法和坑位。通用约定与红线在 `AGENTS.md`；
> 动手前先读与本次改动相关的章节。发现缺了"后人会再踩"的一条，
> 按 `AGENTS.md` §5 提议扩充。

## 1. 版本兼容校验链路

- 唯一真相源是 `package.json` 的 `engines.dsh`：加区间只改这一行，再重新构建。
- 链路：构建期由 `tsdown.config.mjs` 经 `define(__DSH_ENGINES__)` 烙进 `lib/index.js`；
  host 用 `src/host/version.js` 的纯匹配器判定 `ok` / `old` / `new` / `unknown`；
  区间原文经路由 `dsh.range` 下发，console 警告与卡片 tooltip 直接引用。
- `client` 里不许出现写死的区间字符串；README 只写"以 `engines.dsh` 为准"，不抄具体数字。
- 匹配器是 npm semver 的**子集**：支持 `||`、比较器（`>=` `<=` `>` `<` `=`）、
  裸版本（即 `=`）、逗号分隔、运算符后空格（如 `>= 0.1.5-rc.1`）、prerelease 门控
  （未具名的 tuple，其 prerelease 不算满足，如 `0.1.3-rc.1` 不满足第一段）；
  不支持 `^`、`~`、`x-range`、`*`、连字符区间——含这些写法的分支作废，
  无可用分支时判 `unknown`（静默失败，绝不误报）。
- `old` / `new` 划分：低于所有下界判 `old`；其余未命中判 `new`
  （含 `||` 缝隙，如 `0.1.4`）。
- 选型备忘：`engines` 是"只警告不拦截"，对得上感叹号行为；
  `peerDependencies` 是"安装直接失败"，语义太重，不用来表达兼容区间；
  另开 `dsh.*` 字段或新文件都不如 `engines.dsh`（VS Code 的 `engines.vscode` 是同类先例，
  新文件还要进 `files` 白名单，多一个漏配风险）。

## 2. 设置卡片 chrome

- 官方契约（`slot-contract.d.ts` 与 package README 原话）：`settings.plugin.item` slot
  只负责按 namespace 配对与堆叠，**卡片的一切（chrome、控件、文案）归插件自己**。
  第一方的 `PluginCard` 是内部组件，不对外开放，别去套——它的 staged-draft 表单模型
  跟我们的 live-write 也不是同一个交互模型。
- loader seed 表成员（`require` 直通，无需声明）：`react`、`react-dom`、
  `@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、
  **`dsh-client-ui-primitives`**（全套图标，含 `IconChevronDownOutline14`）、
  `dsh-client-ui-dockkit`。取证位置：0.1.5-rc.1 前端 bundle 的 `My()` seed 函数。
- 参考实现：`src/client/primitives.js`（官方图标优先，像素一致的内联 SVG 兜底）。
- 待定：官方卡片边框圆角是 `.5px` / `border-l4` / `16px`，我们的是 `1px` / `border-l2` / `12px`；
  目前只对齐了箭头，边框圆角是否跟进由维护者定。

## 3. 折叠引擎硬约束

1. **不折单条**：内层 run 至少 2 条调用，单条永远原样渲染。
2. **外层条禁止带 `data-chat-flow-kind`**：否则 `rowList` 会把它当流程行，
   段 key 每帧漂移，表现为"双份的条"。行距用 CSS 补（`styles.js` 有专用规则）。
3. **内外层状态分离**：内层用 `expanded`，外层用独立的 `sectionExpanded`
   （`expanded` 会按可见行裁剪，收起的段会丢状态）。展开外层必须把该段内层 run 标为展开，
   否则"展开啥都没有"；内层条在外层展开时保持隐藏，一段只留一条条。
4. **外层条是该段最后一个调用的克隆**：标题后缀 `· N 次调用`（N 为全段总数），
   收起、展开两种状态标题都不许空。
5. **与官方 Compact 共存**：官方折叠收起时插件袖手旁观；我们的条镜像 `hidden`，
   只在官方展开后才在里面生效。保留显示（kept）的 settled 思考跟随调用组折叠，
   隐藏的思考仍起分隔作用。
6. **`twoLevel` 只控制外层**：关闭等于纯 0.1.9 行为，内层照折。

## 4. 历史坑位速查

| 现象 | 根因 |
|---|---|
| `0.1.5-rc.1` 报感叹号 | host 写死单区间，只改了 `package.json`（已根治，见 §1） |
| `>= 0.1.5-rc.1` 解析整段作废 | 分词器没容忍运算符后空格（已修，见 §1） |
| 双份的条 | 外层条带了 `data-chat-flow-kind`（见 §3.2） |
| 外层展开空白 | 内层 run 没联动展开（见 §3.3） |
| engine-smoke 莫名挂 3 项 | 改 `bridge.js` 时弄丢 `var compatWarned`，`setCompat` 抛错吞警告 |
| 卡片箭头与官方不一致 | 用了文字 `▾`，官方是 14px SVG（已换官方图标，见 §2） |
| `require` 在 harness 里炸掉整个插件 | 官方包的 `require` 必须懒加载加 try/catch（harness 的 require 全抛错） |
