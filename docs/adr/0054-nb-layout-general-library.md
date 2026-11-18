---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-18
superseded-by: null
---

# ADR 0054：nb-layout 做成通用布局库：工作台层拆进不发布的新包，nb-layout 发 MIT 与编译产物，第一个外部使用方是 nb-story

- 日期：2026-11-18
- 决策者：开发者
- 关联工作：[w00026 t31](../../.agents/works/w00026-layout-package/tasks/t31-general-layout-library/README.md)
- 相关文档：[提案](../proposals/nb-layout-general-library.md)
- 部分取代：[ADR 0044](0044-workbench-single-layout-tree.md) 第 6 条的“布局工具全部进 `nb-layout`”与“`./vue` 依赖 nb-ui”：工作台层拆出，`./vue` 不再依赖 nb-ui；其余决定不变（Splitter 与分隔线核心仍在 nb-layout，nb-ui 不重导出）
- 补充：[ADR 0029](0029-workspace-packages-publish-source-to-npm.md) 决定 6 留着“其它工作区包需要发布时另作决定”，本 ADR 就是 nb-layout 的这个决定：它发编译产物，不照决定 2 发源码；ADR 0029 的其余决定不变

## 背景

ADR 0044 第 6 条把布局工具全部收进 `@notnotype/nb-layout`，理由是统一用一套库、Splitter 不留两份，没有写要给别的项目用。开发者 2026-11-16 定：nb-layout 应该是可以复用的通用布局工具，后面可以发到 npm。

现在的包有一半是工作台的领域模型（布局文档、投影、落点规则，约 2300 行，要求活动栏、状态栏、区域名、视图容器与入口条）；拖动控制器在应用里；失败有四种形状且都没有码；入口约 132 个导出，62 个无人使用；Vue 层读 nb-ui 的文案端口、层级常数与约 45 个 CSS 变量；许可证是 AGPL-3.0-only；也没有发布路径。证据见提案与 t31 的三份审查。

## 决策

1. **工作台层拆进新的工作区包** `@notnotype/nb-workbench-layout`（`private`，不发布）：布局文档、投影、落点规则、`presented-ids`、夹具、`TabStrip` 与标签条几何，以及拖动控制器的工作台适配层。nb-layout 只留网格、求解、分隔线、拖动会话与落点几何，`.` 纯 TS，`./vue` 是 Vue 适配与组件。依赖只能向下：nb-layout 不导入工作台层。拆成新包的理由有两条：
   - **许可证**：nb-layout 发 MIT，工作台层是 AGPL 仓库里的领域代码，不放进 MIT 的包；
   - **依赖方向由包边界守住**。
2. **布局文档不做成参数**，也不做成通用的停靠模型：它的概念（条、区域、容器、入口条）还在加，只有一个使用方，抽出来的形状没有第二个例子校验。出现第二个形状不同的使用方时，再从两个形状里抽公共部分。
3. **nb-layout 的 `./vue` 不依赖 nb-ui**：CSS 变量改 `--nb-layout-*` 命名空间并带回退、桥接样式放 nb-ui 的 `tokens.css`（只写变量名，不导入 nb-layout）、层级常数改变量、文案改库自己注入的标签。`dependencies` 只剩 `tabbable`，`peerDependencies` 只剩 `vue`。
4. **失败一种形状**：`{ok: false, code, message, params?}`，`message` 是库内英文、只给日志看；码集合开放，宿主必须有默认分支，新增码不算破坏。
5. **nb-layout 发 MIT**（开发者 2026-11-18：“可以发 MIT”）。发布前：
   - 包内 `LICENSE` 换成 MIT 全文，`package.json` 的 `license` 改 `MIT`，发布脚本的许可检查与第三方声明过滤按包区分，不静默丢掉 MIT 声明；
   - MIT 的包以后不从 AGPL 的代码搬内容，写进包的 AGENTS.md；
   - Trellis 只借了交互想法（ADR 0044 第 5 条）：核对没有逐字复制，核对结果记在实施的 Task 里。
6. **发编译产物**，作为这个包的发布形态：Vite 库模式出 ESM、类型声明、`style.css`；源码包仍 `private`、`exports` 仍指向 `src`，发布目录由脚本生成；版本独立、手工管理、先发 `0.x`，变更记录照 [ADR 0053](0053-release-stages-and-changelog.md) 第 4 条放 `packages/nb-layout/CHANGELOG.md`；承诺的宿主是 Vue 3 加 Vite。这条的前提不是“只承诺 Bun”（ADR 0029 选源码的理由），而是目标变成了“别的项目用”。**排在第二档**，见第 7 条。
7. **分两档做**：
   - **第一档，现在做**：拆出工作台层、统一错误形状、去掉 nb-ui 依赖、入口改显式清单加导出名测试、`useDragSession` 与 `useGridHost`、整理拖动控制器并把纯的部分（卡片的缩放与追赶、帧调度）抽进库、t14（nb-story 与开发者面板迁到 nb-layout 的 Splitter）；
   - **第二档，以后做**：编译产物流水线与发布脚本的第三条通道、API 报告 CI、`@stable`/`@experimental` 全量标注、手感编排（撕下来源、来源收起后重判、空位粘住等）进库、默认英文文案；
   - 手感编排进库要等有第二个宿主验证过：Lab 里一个不是标签页的宿主，或官方示例应用。
8. **第一个外部使用方是 nb-story**（开发者 2026-11-18：“第一个外部使用方就是 nb-story（到时候可以改造）”）。第二档在把它改造成用 nb-layout 的 NestedGrid、拖动这些公开面时做，形状由它校验。t14 只用 Splitter，校验不了 NestedGrid 与拖动，所以它不算这个使用方。
9. **对插件 SDK 的影响**：SDK 已重导出 `Splitter*` 类型与 `TabStrip`。`Splitter*` 改名为 `GridGesture*` 时，SDK 保留旧名作别名并给弃用期；`TabStrip` 由 SDK 从工作台层重导出，插件作者的导入名不变。
10. **版本承诺**：只承诺主题级的一小批 CSS 变量、README 里的 `data-*` 表与标 `@stable` 的符号；`GridSnapshot` 的兼容承诺只从 1.0 起，0.x 期间快照格式的破坏性变化要同批给工作台层的 `LAYOUT_DOC_VERSION` 写迁移。

## 备选方案

- **布局文档做成通用的停靠模型，控制器一起进库**：第三方拿到接近 dockview 的整套能力，但只有一个使用方，扩展字段与钩子的形状没有校验，工作量是推荐的数倍，发布后每加概念就要破坏或加参数。出现第二个形状不同的使用方时再从工作台层往这条路走。
- **单包加 `./workbench` 子路径、照旧发源码**：最省事，但发布包带着约 2300 行无关代码，“不承诺的子路径”只靠约定守住。
- **单包、发编译产物、发布目录白名单**：解决了上一条的缺点，但一个目录里放 MIT 与 AGPL 两种文件，许可证与依赖方向都只靠约定。
- **换成现成的布局库**：ADR 0044 第 5 条的理由对工作台仍成立；对第三方，要回答的是和 dockview、splitpanes、reka-ui、allotment 的差异，这些库的现状没有核实，第二档开工前核实。
- **手感引擎一次全进库**：真实耦合比“三处依赖”深，泛化后约 25 个回调、4 个以上类型参数，又只有一个使用方；先整理、只抽纯的部分，编排等第二个宿主。
- **现在就做完发布准备**：t14 只校验 Splitter，其余公开面没有使用方，做早了就是承诺一批没验证过的接口。

## 后果

- 工作台、编辑器插件与 SDK 的导入路径改到新包，约 56 个文件，机械改；CSS 变量改名动到主题合同（nb-ui 的 `tokens.ts`、`tokens.css`、`nbook` 主题的 `vars.css`、`theme/system.md`、6 个 e2e），靠桥接样式让主题作者写的旧名继续生效。
- 发布脚本现有的两条通道对 nb-layout 都不合适：生成包通道默认版本是产品版本，源码包通道写死 AGPL 与 `engines.bun`；第二档要加第三条通道：独立版本的生成包。构建不可复现时，registry 上同版本字节不同要有处理。
- nb-layout 现在没有 `"private": true`：拆包时先加上，发布路径建好之前从包目录直接发出去的是源码。
- 应用包与 SDK 把 MIT 的 nb-layout 打进 AGPL 的 bundle：第三方声明脚本现在一律不列 `@notnotype/*`，要改成按包的许可判断，否则 MIT 版权声明被丢掉。
- ADR 0044 的后果里写“nb-story 的发布依赖从 8 个包变成 9 个，要写新 ADR 部分取代 ADR 0029”：nb-story 的 nb-ui、nb-form、nb-agent-ui 在 `devDependencies`，网页打包进包里；nb-layout 同理的话发布依赖不变，不需要为此另写 ADR（实施 t14 时核实）。
- 发到 npm 是外部、不可逆的动作，由开发者执行；本 ADR 不排发布时间。
- 实施细节（错误码的逐处划分、旧名到新名对照表、构建工具的已知坑、SDK 弃用期的长度）在提案与各 Task，不在这里。
