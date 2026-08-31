---
schema: nbook.task/v2
taskId: t04-nb-ui-adoption
role: tasker
---

# 接入 nb-ui 与第一个消费者

## 目标

让 `packages/neuro-book` 第一次真实消费 `@notnotype/nb-ui`：统一许可证、声明依赖、完成样式会合，并把 `JsonViewer.vue` 的六个图标按钮切到公共组件。同时产出第一份组件文档，验证[`组件规范`](../../../../../docs/standards/code/components.md)在真实组件上写得出来。

## 与 t01 设计的偏差

`t01-migration-design` 的 walkthrough 001 冻结了 A 到 P 的顺序，其中 A 段已由开发者取消并改写。t01 已闭合，不回改；本 Task 是取代其 A 段设计的 current 依据：

- 组件行为合同不再是 Spec。它已改写为不含迁移内容的编码规范，位置在 `docs/standards/code/components.md`，并登记进编码规范路由表。
- `ui.component-catalog` 不创建。组件索引改为由扫描组件文档生成的派生产物，不手工维护 `pending`/`ready`、owner 分区或 aggregate。
- 232 个组件不做一次性普查。组件文档按「碰到才写」渐进积累：新组件必须先写，迁移到的组件补写，其余在报告中列为待声明。
- `ui.component-lab` 已砍到只剩边界约束。Lab 的导航、检视面板、索引形状与交互合同刻意未定义，等原型建成并有组件真实迁移通过之后补写。
- 新顺序为：本 Task（B）→ 删除 preview 页面并先保留其场景数据 → Lab 原型（D）→ 种子组件走通全流程 → 回头补写 Lab 界面合同 → 主题切换（C）→ 渐进迁移剩余组件。主题切换与 Lab 没有硬依赖，已由开发者移到走通流程之后；原 P（清退 preview）提前执行，t01 冻结的 31 个场景基线随之降级为历史记录，不再是必须逐条消化的清单。

## 允许改动

- `packages/nb-ui/package.json`：`license` 由 `PolyForm-Noncommercial-1.0.0` 改为 `AGPL-3.0-only`。主应用与仓库根已是 `AGPL-3.0-only`，本次切换是消除既有不一致；核对分发说明是否需要同步更新，不需要则记录结论。
- `packages/nb-ui`：提供不引入 CSS side effect 的纯数据配色出口。当前 `themes/nbook/index.ts` 引入 `vars.css`，C 的首帧脚本无法安全导入该数据，因此纯数据入口必须在本 Task 交付。
- `packages/neuro-book/package.json`：新增 `@notnotype/nb-ui` workspace 依赖。`bun.lock` 只由安装命令更新，不手工编辑。
- `packages/neuro-book/nuxt.config.ts`：加入唯一的 `@notnotype/nb-ui/styles.css`，位置在 reset 之后、领域样式之前；补 transpile。**不启用 nb-ui 的 Nuxt module**，因为主应用已按顺序自动注册三个组件目录，无前缀自动注册会与 16 个同名组件碰撞。
- `packages/neuro-book/app/components/common/JsonViewer.vue`：六个图标按钮（三个模式加复制、展开、折叠）切换到 nb-ui `IconButton`，逐项保持 title、disabled、click 与图标行为，补齐可访问名称；切换完成后删除该组件的旧按钮样式。JsonViewer 本身仍是产品组件，不迁为通用库组件。
- 新增 `packages/neuro-book/app/components/common/JsonViewer.md`：本仓库第一份组件文档，正文详略按组件规范的分档决定，不机械照抄六节。JsonViewer 的复制按钮会写系统剪贴板，对应 `env:clipboard` 标签；该组件的标签组合预计不落在五种推荐配方内，属于档位 D 配方偏离，如实记录即可，不为它单开配方。
- 临时验证 Nuxt 对组件子目录 `index.vue` 的自动注册命名行为，用后即删，不在仓库留下该形态的组件。结论写入 walkthrough，供后续决定组件是否目录化。

## 开发者参与

- nb-ui 的 Tailwind 产物与主应用 UnoCSS 的层叠会合结果无法静态预测。若会合需要牺牲现有视觉或调整既有样式，由开发者决定取舍，Agent 只提供冲突清单与可逆方案。
- 第一份组件文档写完后由开发者过目，确认这套写法在真实组件上是否顺手。写起来别扭时修改组件规范，而不是将就着往下写 232 份。
- 浏览器人工验收需要开发者执行。依赖安装属于批准范围内的本地可逆动作，由 Agent 直接执行并报告 lockfile 变化。

## 验证

1. `bun run --cwd packages/neuro-book typecheck`。
2. 与改动表面相关的聚焦测试。
3. 启动开发入口，逐项核对六个按钮的 title、disabled、点击结果与图标，与切换前一致；确认每个按钮都有可访问名称。
4. 桌面（宽度不低于 1440px）与 `390×844` 真实页面验证 JsonViewer 布局与操作，记录实际视口值。
5. 确认无新增 console error 或 warning。
6. 记录 nb-ui 样式与主应用既有样式的实际冲突清单；无冲突时也要写明是如何确认的。

## 完成门禁

- 六个按钮行为逐项不变且都有可访问名称，旧按钮样式已删除。
- 没有为迁移保留 alias、adapter、双入口或静默 fallback。
- `JsonViewer.md` 存在，正文详略符合分档要求，frontmatter 的能力标签与实现一致。
- `bun.lock` 的变更只来自安装命令。
- 未运行或未授权的项目标注为未验证，不以静态阅读代替执行结果。

## 影响后续但不在本 Task 解决的待定项

- **组件目录化**：`PlotTreeView/index.vue` 加同目录文档的形态方向已认可，但需先验证 Nuxt 对子目录 `index.vue` 的组件命名行为。仓库当前没有任何组件使用该形态。验证通过后按「新组件与迁移到的组件」渐进转换，不做一次性全量改动。
- **fixture 位置**：跟随目录化结论。目录化则放入组件目录，否则集中放在开发专用目录并按整目录排除。
- **扫描报告工具**：推迟到有足够组件文档可扫之后再建。
- **主题切换的静默丢失**：C 将直接丢弃全部旧主题与用户自定义主题，切换时需要向用户给出一次说明，否则会被当作缺陷报告。

## 固定依据与非目标

- 公开目标：[Issue #191](https://github.com/notnotype/neuro-book/issues/191)。
- 组件规范：[`docs/standards/code/components.md`](../../../../../docs/standards/code/components.md)。
- Lab 边界：[`docs/specs/ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)。
- 现状证据：[t01 迁移设计](../t01-migration-design/README.md) 及其 walkthrough 与 evidence，其中 A 段设计已由本 Task 取代。

本 Task 不切换主题、不修改 `docs/specs/theme/system.md`、不建立 Lab、不迁移 JsonViewer 六个按钮以外的组件、不实现扫描报告、不删除任何 preview 页面、不建立 Workbench/View Host，也不执行 push、PR、远端写入、合并、发布或部署。
