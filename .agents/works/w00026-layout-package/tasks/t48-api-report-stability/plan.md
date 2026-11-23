# t48 计划：nb-layout 的 API 报告与稳定性标注（第 3 稿）

第 3 稿按开发者 2026-11-23 的两个决定与第 2 轮设计审查（Claude Sonnet，重要 7、建议 3，[证据](evidences/design-review-2.txt)）重写：0.x 期间全部名字 `@experimental`，`@stable` 只由 nb-layout 自己的标注决定；非组件的标注写在源码声明的 JSDoc 上，只有 7 个组件经入口行尾加 `pack.ts` 后处理；报告补上可达未导出的类型、`@stable` 的签名闭包、全部工具链版本与组件段的取法。逐条处理见文末“设计审查”。

## Context

- **为什么做**：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第二档第 2、3 项（API 报告 CI；`@stable`/`@experimental` 全量标注）；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条：版本承诺只覆盖主题级的一小批 CSS 变量、README 的 `data-*` 表与标 `@stable` 的符号。
- **前提**：t47 已合入，`build:package` 出的四个入口声明逐字节稳定；入口是显式清单（`src/exports.test.ts`）。
- **开发者已定**（2026-11-23，会话里答复）：
  1. nb-layout 可以首发，`ui/nested-grid` 与 `ui/layout-drag` 可以晋升（晋升在本 Task 之外，按逐句核对的结果做）。
  2. 稳定范围：nb-layout 0.x 期间**全部名字 `@experimental`**，包括插件 SDK 转出的；SDK 写明它转出的 nb-layout 名字跟着 nb-layout 的标注走。
  3. `@stable` 由谁定：**nb-layout 自己的标注**；SDK 加一行转出不替 nb-layout 许诺。
- **探针**（[证据](evidences/probes.txt)）：组件的 `declare const _default$N` 上带不了注释，`.vue` 里导出的类型的 JSDoc 会进发布声明（`DropFeedbackPreview`，2026-11-23 看 `dist/package/vue.d.ts` 核实）；vue-component-meta 对 7 个组件出得了 props（带缺省值）、事件、插槽、expose，列不出 `panel-${string}` 这种模板字面量插槽名。
- **工作方式**：autonomous-delivery；从 master 开 worktree。第 3 轮（最后一轮）计划审查交 Claude Sonnet，阻塞。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 组件的公开面 | `vue-component-meta`（新开发依赖，版本与仓库的 vue-tsc 3.3.x 对齐） | props 带缺省值、事件与回调属性分开、expose 也出，类型是真名（探针 4） | 自写检查器展开：要自己过滤 Vue 自带属性、区分事件与回调、读 expose |
| 非组件的公开面 | `typescript` 的语法树：在发布声明上按名字找声明节点，`createPrinter` 打印 | 结构变化看得见，类型是真名 | `typeToString`：接口与多数别名只打出名字 |
| 报告工具 | 自写脚本组合上面两样，补上 api-extractor 的两类诊断（可达未导出、稳定签名引到不稳定的类型） | api-extractor 对组件只看到 `typeof __VLS_export$N` | api-extractor |

## 关键设计

### 标注：源码声明的 JSDoc、`src/vue/index.ts` 的组件行、`scripts/pack.ts`

- **非组件**：每个公开名字在源码里的声明（函数的每个重载、声明合并的每一处）的 JSDoc 带恰好一个 `@experimental` 或 `@stable`；已有 JSDoc 的加一行标签，没有的新建 `/** @experimental */`。约 150 个名字，现在全部 `@experimental`。它们随声明进发布声明，也随 SDK 打包的声明到插件作者的编辑器里。
- **组件**（7 个）：`src/vue/index.ts` 里 `export {default as X} from "./X.vue";` 那一行的行尾写 `// @experimental`。组件只在这一处导出，不碰 `module-exports.ts` 的去重。`pack.ts` 打完声明后，按入口末尾的导出列表（`_default$N as X`）找到那条 `declare const`，在它前面插入 `/** @experimental */`；组件行缺标注或标注不认识时打包失败。纯文本插入、按名字排序，同一份输入同一份字节，t47 的两次打包比对照样覆盖。
- **齐全与一致由报告脚本机检**（不在 `exports.test.ts`）：它读打包后的声明，每个公开名字的每一处声明恰好一个稳定性标签，否则报错。这样组件与非组件走同一处核对，且核的是使用方真拿到的东西。
- **`@stable` 的条件**（写进 README“版本承诺”）：标 `@stable` 由 nb-layout 维护者定，条件是名字所在的 Spec 是 `implemented`、签名闭包里的公开名字都是 `@stable`（报告机检）、并在变更记录里写明。0.x 期间没有 `@stable` 名字。
- **`@stable` 承诺什么**：签名与所在 Spec 的行为。不兼容的签名改动：删名字、改名、必填参数或属性增加、参数类型变窄、返回类型变宽、事件删除或载荷变窄；加可选参数与属性、新增事件不算。

### 插件 SDK：`packages/neuro-book/src/sdk/components.ts`、`plugin-sdk/README.md`、Spec `runtime/plugin-code-loading`

- 模块头的“这里每一项都是兼容承诺”改成：nb-ui 的名字是兼容承诺；nb-layout 的名字跟着 nb-layout 的标注走，现在全是 `@experimental`，变了按插件 API 的不兼容改动处理（提兼容起点、变更记录写明）。
- Spec `runtime/plugin-code-loading` 的“共享入口即兼容承诺”加一句同样的话；SDK README 的组件一节给插件作者写一句：用到 nb-layout 的组件，预期比 nb-ui 组件更常需要重新构建。
- 不加跨包对齐测试：SDK 的承诺按规定不超过 nb-layout 的标注，SDK 新转出一个名字不改变 nb-layout 的任何东西。

### API 报告：`packages/nb-layout/scripts/api-report.ts`（新），`api/*.api.txt`（入库）

- 读 `dist/package` 的四个入口声明，建一个 TypeScript 程序。每个入口一份 `api/<入口>.api.txt`：
  - **头**：工具版本各一行：vue-tsc 与它解析到的 `typescript`、报告脚本的 `typescript`、vue-component-meta 与它解析到的 `typescript`、`rolldown-plugin-dts`、`vue`。按包解析各自的版本（`createRequire` 从各自的入口解析），不写死。
  - **正文**：按名字码元排序（`a < b`），每个名字一段，首行 `<标注> <种类> <名字>`，弃用的名字首行后加 `@deprecated`。
  - **函数、常量、类型、接口、类**：打印这个名字的每一处声明节点（去注释）。断言打印结果不含 `$` 加数字与 `__VLS`：将来 rolldown 给同名声明加后缀时这里失败，提示改名。
  - **可达未导出**：从全部公开名字出发，沿声明里的类型引用遍历到不动点，凡是声明在 `dist/package` 里、又不在任何入口导出的类型（现在 9 个，如 `GridPlacementItem`、`DragStops`），在该入口末尾的“由公开名字引到、没有导出的类型”一节打印声明，并在命令输出里列为告警（要么导出，要么承认它是公开签名的一部分）。
  - **组件**：五段，取自 vue-component-meta（读源码 `.vue`，经 `tsconfig.vue.json`）：
    - props：只留声明在 `packages/nb-layout/src` 里的，每行 `名字?: 类型 = 缺省值`（缺省值是 vue-component-meta 求值后的字符串）；
    - 透传：源码 `defineProps` 的类型参数里，与本包之外的类型做交叉的（例如 `& HTMLAttributes`、`& Pick<HTMLAttributes, "id">`），按源码文字列出那个类型；`defineOptions({inheritAttrs: false})` 时另写一行 `inheritAttrs: false`；
    - 事件：用连字符名（`gesture-start`），`名字(参数)`；
    - 插槽：有 `defineSlots` 时打印它的类型参数（覆盖模板字面量名字），没有时用 vue-component-meta 列出的插槽（例如 `DropIndicatorLabel` 模板里的 `icon`）；
    - expose：名字与类型。
    - 交叉核对：vue-component-meta 的 props 名字都出现在发布声明里该组件实例类型的 `$props` 上，否则报错（防止源码与产物两条路径分叉）。
  - 类型文字里出现的绝对路径改写成包名或去掉。
- **闭包核对**：每个 `@stable` 名字的声明引到的公开名字也必须是 `@stable`，否则报错，列出路径。现在没有 `@stable`，核对照跑。
- `bun run api:report`：先跑 `build:package`，再写报告。`bun run api:check`：同样先构建，生成到临时目录与 `api/` 比：
  - 头不同：提示“工具链变了”，正文差异一并列出，要求 `api:report` 的这次再生成单独提交；
  - 正文不同：打印差异，失败，提示“公开面变了：确认后 `api:report` 更新”；差异里有 `@stable` 名字时，另要求 `CHANGELOG.md` 的 `[Unreleased]` 相对 `HEAD` 有改动，没有就失败。
  - 任何差异都失败：报告是入库的对照，不提示了事；`@experimental` 名字只需重跑 `api:report`。
- **接进门禁**：nb-layout 的 `package.json` 加 `api:report`、`api:check`；`docs/testing/README.md` 的验证门禁登记“改了 nb-layout 的公开入口或它们引到的声明时跑 `api:check`”；CI 的 `app-package` 作业在 `build:package` 之后跑 `api:check`（保留原来那一步，作业含义不变）。
- 与导出名测试的分工：`exports.test.ts` 管名字（清单、禁用词、文档里教的名字）；报告管签名、结构、组件五段、标注齐全与闭包。
- 已知限制（写进 README）：报告看不到运行时行为与 CSS；缺省值只对组件 props 有；Vue 或 TypeScript 升级会让报告整批变化（头变，单独提示）。

## Spec 与文档改动

- `docs/specs/runtime/plugin-code-loading.md` 输入一节的“共享入口即兼容承诺”：加 nb-layout 名字跟着 nb-layout 的标注走（开发者 2026-11-23 定）。
- `packages/nb-layout/README.md`：“版本承诺”一节（ADR 0054 第 10 条的三项、`@stable` 的条件与承诺内容、0.x 期间全部 `@experimental`、标注在哪里看：编辑器悬停与 `api/*.api.txt`、已知限制）。
- `packages/nb-layout/AGENTS.md`：新公开名字带标注；改公开面后 `api:report`；`@stable` 的条件。
- `packages/nb-layout/CHANGELOG.md`：`[Unreleased]` 写公开名字全部标了 `@experimental`、有了 API 报告。
- `packages/neuro-book/plugin-sdk/README.md` 组件一节、`src/sdk/components.ts` 模块头：见上。应用的变更记录 `[Unreleased]` 写一句给插件作者。
- `docs/testing/README.md` 验证门禁：登记 `api:check`。
- Work 后续：ADR 0054 第 10 条另两项（主题级 CSS 变量、README 的 `data-*` 表）没有机检。

## 切片

1. **标注**：非组件约 150 处 JSDoc（机械，派 Haiku，规则：每个公开名字的每处声明加 `@experimental`，已有 JSDoc 的加一行，不改别的文字）；组件 7 行行尾；`pack.ts` 插入组件标签；SDK 模块头、SDK README、Spec 那一句。验证：nb-layout `bun test`、`typecheck`、`build:package` 两次逐文件相同、`dist/package/vue.d.ts` 的 `NestedGrid` 那条 `declare const` 前有 `@experimental`；应用 `bun test src/sdk`、`plugin-sdk` 的 `pack.test.ts`。
2. **报告**：`api-report.ts`、`api/*.api.txt`、两个脚本、门禁登记、CI；单测用样本声明与样本组件：标注缺失与重复、重载每处都核、`@deprecated` 保留、可达未导出、闭包核对（样本里放一个 `@stable` 引 `@experimental`）、组件五段（无 `defineSlots` 的、`Pick<HTMLAttributes, …>` 透传、`inheritAttrs: false`、连字符事件名）、交叉核对、`$N` 断言、路径改写、码元排序、两次相同、头与正文分开比、`@stable` 差异要求变更记录。验证：`bun run api:check`；改一个签名看它失败；只改头看单独提示。
3. **收口**：AGENTS.md、README、变更记录、Work 后续、Task README、待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| 依据 | 覆盖 |
|---|---|
| ADR 0054 第 10 条：只承诺标 `@stable` 的符号 | 报告的标注齐全核对与闭包核对；`pack.ts` 的组件标签单测与构建核对 |
| 提案第二档第 2 项：API 报告 CI | `api:check` 在 CI 与本地门禁；`api-report` 的单测 |
| 提案第二档第 3 项：全量标注 | 报告的标注齐全核对（每个公开名字的每处声明） |
| 提案第 238 行：映射规则 | README 的 `@stable` 条件；闭包核对 |
| 开发者 2026-11-23：SDK 跟着 nb-layout 的标注走 | Spec `runtime/plugin-code-loading` 的那一句；SDK 模块头与 README |

## 不做与风险

- 不做主题 CSS 变量与 `data-*` 表的机检（记进 Work 后续）。
- 不导出 9 个可达未导出的类型：报告告警，导不导出等有使用方时再定。
- 风险：vue-component-meta 跟着 Volar 升级，输出格式会变；报告头记版本，变了单独提示。
- 风险：约 150 处 JSDoc 是机械改动，可能漏改或改坏已有注释；报告的齐全核对兜住漏改，diff 由主会话逐处审。

## 设计审查

第 2 轮（Sonnet，[证据](evidences/design-review-2.txt)）十条都成立：

1. 可达但没导出的类型不进报告（重要）：遍历到不动点，单列一节并告警。
2. `@stable` 集合对类型不闭合（重要）：开发者定 0.x 全部 `@experimental`；闭包核对照写，将来有 `@stable` 时生效。
3. 映射规则第 2 条不可判（重要）：删掉，换成 nb-layout 维护者按三个条件定 `@stable`。
4. SDK 转出即 `@stable` 让应用替 nb-layout 许诺（重要）：开发者定 nb-layout 自己定；SDK 写明跟着 nb-layout 的标注走；写了 `@stable` 承诺什么与不兼容的判据。
5. 版本头没覆盖决定声明字节的工具（重要）：头记全，按包解析，头与正文分开比。
6. 标注全写入口行尾、偏离业界（重要）：非组件写源码 JSDoc；只有组件走入口行尾加后处理；重载与声明合并每处都标、由报告核。
7. 组件段取法没写全（重要）：插槽、透传、`inheritAttrs: false`、事件名、缺省值各写取法，各配样本。
8. CI 专有、全部名字同样严格（建议）：接进本地门禁与 `docs/testing/README.md`；`@stable` 差异另要求变更记录。`@experimental` 差异仍然失败（只需重跑 `api:report`）：入库的对照不能只提示，否则很快过期；接受评审对 `@experimental` 差异看得粗。
9. 组件取自源码、去注释抹掉弃用（建议）：props 与产物声明交叉核对；保留 `@deprecated`。
10. 压缩别名还原多余（建议）：删掉，改成不含 `$` 加数字与 `__VLS` 的断言。

第 1 轮（Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）十条都成立，第 2 稿已处理。
