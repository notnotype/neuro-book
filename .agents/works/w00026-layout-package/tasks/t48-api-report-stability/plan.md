# t48 计划：nb-layout 的 API 报告与稳定性标注（第 4 稿）

第 3 稿按开发者 2026-11-23 的两个决定改写：0.x 期间全部名字 `@experimental`；`@stable` 只由 nb-layout 自己的标注决定。第 4 稿处理第 3 轮设计审查（Claude Sonnet，重要 6、建议 2，[证据](evidences/design-review-3.txt)），并按开发者对第 4 条的答复，让 SDK 转出名的不兼容改动提兼容起点、由测试提醒。同一对象最多审三轮，第 4 稿不再交设计审查，余下的由实现审查兜住。逐条处理见文末“设计审查”。

## Context

- **为什么做**：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第二档第 2、3 项（API 报告 CI；`@stable`/`@experimental` 全量标注）；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条：版本承诺只覆盖主题级的一小批 CSS 变量、README 的 `data-*` 表与标 `@stable` 的符号；`GridSnapshot` 的兼容从 1.0 起，0.x 期间快照格式的破坏性变化同批给 `LAYOUT_DOC_VERSION` 写迁移。
- **前提**：t47 已合入，`build:package` 出的四个入口声明逐字节稳定；入口是显式清单（`src/exports.test.ts`）。
- **开发者已定**（2026-11-23，会话里以选择题答复）：
  1. nb-layout 可以首发；`ui/nested-grid` 与 `ui/layout-drag` 可以晋升（晋升是 t54，不在本 Task）。
  2. 稳定范围：nb-layout 0.x 期间**全部名字 `@experimental`**，包括插件 SDK 转出的；SDK 写明它转出的 nb-layout 名字跟着 nb-layout 的标注走。
  3. `@stable` 由 nb-layout 自己的标注定；SDK 加一行转出不替 nb-layout 许诺。
  4. SDK 转出的 nb-layout 名字发生不兼容的签名改动时，**提插件 API 的兼容起点**（`PLUGIN_API_SINCE`），由测试提醒；兼容的改动（加可选属性等）不提。
- **探针**（[证据](evidences/probes.txt)；第 3 轮审查对 `dist/package` 的实测）：组件的 `declare const _default$N` 上带不了注释；`.vue` 里导出的类型、`text.ts` 里的 `@throws` 都进发布声明；入口声明只有导入与导出列表，声明都在共享块里，共享块的导出名是压缩名；`createGrid` 的两个重载各自带标签；同一声明前有两块 JSDoc 时 `getJSDocTags` 只读最后一块；文件头注释在发布声明里挂在该文件第一个声明上。
- **工作方式**：autonomous-delivery；从 master 开 worktree；实现审查交 Claude Sonnet，不阻塞。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 组件的公开面 | `vue-component-meta`（新开发依赖，版本与仓库的 vue-tsc 3.3.x 对齐） | props 带缺省值、事件与回调属性分开、expose 也出，类型是真名（探针 4） | 自写检查器展开 |
| 非组件的公开面 | `typescript` 的检查器：`getExportsOfModule` 加 `getAliasedSymbol` 解到真声明，`createPrinter({removeComments: true})` 打印 | 入口只有导入导出，按名字找节点行不通；检查器解别名不依赖“声明名等于公开名” | `typeToString`：接口与多数别名只打出名字 |
| 报告工具 | 自写脚本，补上 api-extractor 的两类诊断（可达未导出、稳定签名引到不稳定的名字） | api-extractor 对组件只看到 `typeof __VLS_export$N` | api-extractor |
| 打标签 | 一次性的语法树改写脚本（不入库） | 位置能从语法树精确定位，确定、可重跑 | 派模型逐处改：单行注释改多行、头注释、重载实现签名都容易改错，第 3 轮第 5 条 |

## 关键设计

### 标注：源码声明的 JSDoc、`src/vue/index.ts` 的组件行、`scripts/pack.ts`

- **非组件**：每个公开名字的每一处**会进发布声明**的声明带恰好一个 `@experimental` 或 `@stable`，写在**这个声明自己的** JSDoc 块里：
  - 函数有重载时标每个重载签名，不标实现签名（它不进声明）；声明合并的每一处都标；类型成员上的注释不标。
  - “自己的块”是紧贴声明、中间没有空行的那一块。文件头注释与声明之间有空行，不算；这时新建 `/** @experimental */`。单行的 `/** 说明 */` 改成两行：`/** 说明\n * @experimental */` 照现有多行注释的缩进写。
  - `.vue` 的 `<script lang="ts">` 里导出的类型同样写在 `.vue` 里。
  - 一个语句里声明多个名字（`declare const a, b`）的禁止：只有第一个读得到标签，报告报错。
  - 这些标签随声明进发布声明，也随 SDK 打包的声明到插件作者的编辑器里。
- **组件**（7 个）：`src/vue/index.ts` 里 `export {default as X} from "./X.vue";` 那一行的行尾写 `// @experimental`。`pack.ts` 打完声明后，按 `vue.d.ts` 末尾导出列表的 `_default$N as X` 找到那条 `declare const`，在它前面插入 `/** @experimental */`；组件行缺标注或标注不认识时打包失败。纯文本插入，同一份输入同一份字节，t47 的两次打包比对照样覆盖。
- **插件 SDK 的声明也要有组件的标签**：`plugin-sdk/pack.ts` 从 nb-layout 源码另行生成 `components.d.ts`，不经过 nb-layout 的 `pack.ts`。它在已有的“按导出列表往 `components.d.ts` 插文本”那一步（aria 补充）旁边，对 nb-layout 的 7 个组件做同样的插入，标签读同一份 `src/vue/index.ts` 的行尾（读法与 nb-layout `pack.ts` 一样，各自几行，不跨包导入脚本）。`plugin-sdk/pack.test.ts` 断言 `NestedGrid` 的声明前有 `@experimental`。
- **一次性改写脚本**：输入是四个入口的公开名字（`moduleExports`），经检查器解到源码里的声明，按上面的规则插入标签；放在本 Task 的本地目录、不入库。先写齐全核对（报告的那一部分，见下文）看它失败，再跑改写脚本看它通过。改写后主会话逐文件审 diff。
- **`@stable` 的条件**（写进 README“版本承诺”）：由 nb-layout 维护者定，条件是名字所在的 Spec 是 `implemented`、签名闭包里的公开名字都是 `@stable`（报告机检）、并在变更记录里写明。0.x 期间没有 `@stable` 名字。
- **`@stable` 承诺什么**：签名与所在 Spec 的行为。不兼容的签名改动：删名字、改名、必填参数或属性增加、参数类型变窄、返回类型变宽、事件删除或载荷变窄；加可选参数与属性、新增事件不算。

### 插件 SDK：`src/sdk/components.ts`、`src/sdk/sdk.test.ts`、`plugin-sdk/README.md`、Spec `runtime/plugin-code-loading`

- **口径**（模块头、README 与 Spec 的“共享入口即兼容承诺”各写一句）：nb-ui、nb-workbench-layout 的名字与 SDK 自己声明的弃用别名，是 SDK 的兼容承诺（同今天）；nb-layout 的名字在 nb-layout 里标 `@experimental`，SDK 照样按兼容起点保护它们：它们的签名发生不兼容改动（判据同上一节）时提 `PLUGIN_API_SINCE`、变更记录的“不兼容的改动”写明。插件作者用到 nb-layout 的组件，预期比 nb-ui 的组件更常需要重新构建。
- **提醒的测试**（`sdk.test.ts` 新加一条）：读 nb-layout 入库的 `api/*.api.txt`，从 SDK 转出的 nb-layout 名字出发，沿报告里每段的“引用”行取闭包（现在约 48 个名字），把这些段按名字排序拼起来，与 SDK 里入库的快照 `src/sdk/nb-layout-surface.txt` 比。不同就失败，提示：“SDK 转出的 nb-layout 名字的签名变了：不兼容就提 `PLUGIN_API_SINCE` 并写变更记录，兼容的不提；判断后重写快照”。快照按仓库路径读文本，不导入 nb-layout 的脚本。

### API 报告：`packages/nb-layout/scripts/api-report.ts`（新），`api/*.api.txt`（入库）

- 读 `dist/package` 的四个入口声明，建一个 TypeScript 程序。每个入口一份 `api/<入口>.api.txt`：
  - **头**：工具版本各一行：vue-tsc 与它解析到的 `typescript`、报告脚本的 `typescript`、vue-component-meta 与它解析到的 `typescript`、`rolldown-plugin-dts`、`vue`。按包解析各自的版本（`createRequire` 从各自的入口解析），不写死。
  - **正文**：入口的导出用 `getExportsOfModule` 枚举，`getAliasedSymbol` 解到真声明；按公开名字码元排序（`a < b`），每个名字一段：
    - 首行 `<标注> <种类> <名字>`，弃用的加 `@deprecated`；
    - “引用”行：这一段的声明经检查器引到的其它公开名字（按名字排序），供闭包核对与 SDK 的快照用；
    - 函数、常量、类型、接口、类：打印每一处声明节点（去注释）。打印结果不含 `$` 加数字与 `__VLS`，否则报错，提示改名。
  - **标注齐全**：每个公开名字的每一处声明用 `ts.getJSDocTags`（它会上溯到变量语句）读稳定性标签，恰好一个，否则报错；同一声明前有几块 JSDoc 时只认最后一块，前面的块里有稳定性标签就报警告。组件按 `pack.ts` 插入的那一块核。
  - **可达未导出**：从非组件的公开名字出发，按符号引用（`getSymbolAtLocation` 加别名解析，类型引用与值引用都算，例如 `DropKind` 的计算属性键 `[dropKindData]`）遍历到不动点；凡是声明在 `dist/package` 里、又不在任何入口导出的（现在 9 个类型与 1 个值），在该入口末尾“由公开名字引到、没有导出的声明”一节打印，并在命令输出里列为告警。组件不参与遍历，它们走下面那一段。
  - **组件**：五段，取自 vue-component-meta（读源码 `.vue`，经 `tsconfig.vue.json`），类型节点都经 `createPrinter({removeComments: true})` 打印，不取源码文字：
    - props：只留声明在 `packages/nb-layout/src` 里的，每行 `名字?: 类型 = 缺省值`（缺省值是 vue-component-meta 求值后的字符串）；
    - attrs：`defineProps` 的类型参数里与本包之外的类型做交叉的（`HTMLAttributes`、`Pick<HTMLAttributes, "id">`；`/* @vue-ignore */` 随注释一起去掉）打印出来；另写一行属性落在哪：缺省 `attrs → 根元素`，`inheritAttrs: false` 时写模板里 `v-bind="$attrs"` 所在元素的标签名，没有就写 `attrs → 不落`；
    - 事件：连字符名（`gesture-start`），`名字(参数)`；
    - 插槽：有 `defineSlots` 时打印它的类型参数（覆盖模板字面量名字），没有时用 vue-component-meta 列出的插槽（例如 `DropIndicatorLabel` 的 `icon`）；
    - expose：名字与类型。
    - 交叉核对：vue-component-meta 的 props 名字都出现在发布声明里该组件实例类型的 `$props` 上，否则报错。
  - 类型文字里出现的绝对路径改写成包名或去掉。
- **闭包核对**：每个 `@stable` 名字的“引用”里的公开名字也必须是 `@stable`，否则报错，列出路径。现在没有 `@stable`，核对照跑。
- **快照格式**：`GridSnapshot*`、`GRID_SNAPSHOT_VERSION` 的段有差异时，`api:check` 另提示“核对工作台层的 `LAYOUT_DOC_VERSION` 与迁移”（ADR 0054 第 10 条）。
- `bun run api:report`：先跑 `build:package`，再写报告。`bun run api:check`：同样先构建（`--no-build` 跳过，CI 用），生成到临时目录与 `api/` 比：
  - 头不同：提示“工具链变了”，正文差异一并列出，建议这次再生成单独提交（只是提示，脚本不查）；
  - 正文不同：打印差异，失败，提示“公开面变了：确认后 `api:report` 更新”；
  - 差异涉及新旧任一侧带 `@stable` 的名字（含降级与删除）时，另要求 `CHANGELOG.md` 的 `[Unreleased]` 里有一条提到这个名字的记录，没有就失败。不查 git。
- **接进门禁**：nb-layout 的 `package.json` 加 `api:report`、`api:check`；`docs/testing/README.md` 的验证门禁登记“改了 `packages/nb-layout/src` 就跑 nb-layout 的 `api:check`”；CI 的 `app-package` 作业在 `build:package` 之后加一步 `api:check --no-build`，作业名加上“nb-layout 的公开面与 API 报告一致”。
- 与导出名测试的分工：`exports.test.ts` 管名字（清单、禁用词、文档里教的名字）；报告管签名、结构、组件五段、标注齐全与闭包；SDK 的快照管“SDK 转出的子集变了没有”。
- 已知限制（写进 README）：报告看不到运行时行为与 CSS；缺省值只对组件 props 有，且是求值后的字符串；Vue 或 TypeScript 升级会让报告整批变化（头变，单独提示）。

## Spec 与文档改动

- `docs/specs/runtime/plugin-code-loading.md` 输入一节的“共享入口即兼容承诺”：加上一节的口径（开发者 2026-11-23 定）。
- `packages/nb-layout/README.md`：“版本承诺”一节（ADR 0054 第 10 条的三项与快照一条、`@stable` 的条件与承诺内容、0.x 期间全部 `@experimental`、标注在哪里看：编辑器悬停与 `api/*.api.txt`、已知限制）。
- `packages/nb-layout/AGENTS.md`：新公开名字带标注、写法（自己的块、重载每个、组件行尾）；改 `src` 后 `api:check`，公开面变了 `api:report`；`@stable` 的条件。
- `packages/nb-layout/CHANGELOG.md`：`[Unreleased]` 写公开名字全部标了 `@experimental`、有了 API 报告。
- `packages/neuro-book/plugin-sdk/README.md` 组件一节、`src/sdk/components.ts` 模块头：见上。应用的变更记录 `[Unreleased]` 写一句给插件作者。
- `docs/testing/README.md` 验证门禁：登记 `api:check`。
- Work 后续：ADR 0054 第 10 条另两项（主题级 CSS 变量、README 的 `data-*` 表）没有机检；9 个可达未导出的声明要不要导出。

## 切片

1. **报告的骨架与齐全核对**：`api-report.ts` 先做到“枚举导出、解别名、读标签、齐全核对、打印非组件段与引用行”；单测用样本声明（缺失、重复、两块 JSDoc、重载、变量语句、多声明符、`$N` 断言、码元排序）。对现有产物跑，看它报全部缺标签。验证：`bun test scripts`。
2. **标注**：一次性改写脚本打非组件的标签；组件 7 行行尾；nb-layout `pack.ts` 与 SDK `plugin-sdk/pack.ts` 插入组件标签；SDK 模块头、SDK README、Spec 那一句。验证：齐全核对通过；nb-layout `bun test`、`typecheck`、`build:package` 两次逐文件相同、`vue.d.ts` 的 `NestedGrid` 声明前有 `@experimental`；应用 `bun test src/sdk`、`plugin-sdk/pack.test.ts`。
3. **报告的其余部分**：可达未导出、组件五段与交叉核对、闭包、头、路径改写、快照提示、`api:report`、`api:check`（含 `--no-build`、`@stable` 的变更记录要求）、`api/*.api.txt` 入库、门禁登记、CI；SDK 的快照测试与 `nb-layout-surface.txt`。单测：样本组件（无 `defineSlots`、`Pick<HTMLAttributes, …>`、`inheritAttrs: false` 加 `v-bind="$attrs"`、连字符事件名）、值引用的可达未导出、闭包（样本里放一个 `@stable` 引 `@experimental`）、两次相同、头与正文分开比、`@stable` 降级要求变更记录。验证：`bun run api:check`；改一个签名看它失败、SDK 快照测试失败；只改头看单独提示。
4. **收口**：AGENTS.md、README、变更记录、Work 后续、Task README、待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| 依据 | 覆盖 |
|---|---|
| ADR 0054 第 10 条：只承诺标 `@stable` 的符号 | 报告的标注齐全核对与闭包核对；两处 `pack.ts` 的组件标签核对 |
| ADR 0054 第 10 条：快照格式变了同批写迁移 | `api:check` 对快照名字的提示 |
| 提案第二档第 2 项：API 报告 CI | `api:check` 在 CI 与本地门禁；`api-report` 的单测 |
| 提案第二档第 3 项：全量标注 | 报告的标注齐全核对（每个公开名字的每处声明） |
| 提案第 238 行：映射规则 | README 的 `@stable` 条件；闭包核对 |
| 开发者 2026-11-23：SDK 跟着 nb-layout 的标注走、不兼容改动提兼容起点 | Spec `runtime/plugin-code-loading` 的那一句；SDK 的快照测试 |

## 不做与风险

- 不做主题 CSS 变量与 `data-*` 表的机检（记进 Work 后续）。
- 不导出 9 个类型与 1 个值：报告告警，导不导出等有使用方时再定。
- 风险：vue-component-meta 跟着 Volar 升级，输出格式会变；报告头记版本，变了单独提示。
- 风险：SDK 的快照测试按仓库路径读 nb-layout 的报告，报告格式改了要一起改；它只提醒，判断“兼容与否”仍由人做。

## 设计审查

第 3 轮（Sonnet，[证据](evidences/design-review-3.txt)）八条都成立：

1. 变更记录“相对 `HEAD` 有改动”在 CI 与提交后都不成立（重要）：改成 `[Unreleased]` 里有提到该名字的记录，不查 git；新旧任一侧带 `@stable` 都算；头不同只提示。
2. 可达未导出只算类型、组件会带进内部名（重要）：按符号引用遍历，值也算；组件不参与遍历。
3. 组件标签到不了 SDK 的声明（重要）：SDK 的 `pack.ts` 做同样的插入，读同一份行尾。
4. SDK“按不兼容处理”与 `@experimental` 说不通、没有机检、`TabStrip` 与弃用别名归属没写（重要）：交开发者，答复是提兼容起点、测试提醒；加快照测试；写明 nb-workbench-layout 与弃用别名是 SDK 自己的承诺。
5. 派模型打 150 处标签规则有缺口、切片 1 没机检（重要）：改成一次性语法树脚本；规则写全（自己的块、单行注释、重载实现、成员、`.vue`）；切片顺序改成先有齐全核对再打标签。
6. 按名字找声明会失灵（重要）：写明检查器枚举导出、解别名、`getJSDocTags`、多块只认最后一块、禁止多声明符。
7. 组件段按源码文字会带进注释与排版（建议）：一律经 printer；attrs 写落在哪个元素。
8. CI 重复构建、作业含义、门禁判据、快照迁移没映射（建议）：`--no-build`；改作业名；判据写成“改了 `src` 就跑”；快照名字的差异提示核对 `LAYOUT_DOC_VERSION`。

第 2 轮（Sonnet，重要 7、建议 3，[证据](evidences/design-review-2.txt)）十条都成立，第 3 稿已处理：可达未导出进报告；`@stable` 闭包机检；工具链版本记全、头与正文分开比；非组件标注写源码 JSDoc、只有组件走后处理；组件段取法写全；`api:check` 接进本地门禁；组件与产物交叉核对、保留 `@deprecated`；删掉压缩别名还原；映射规则第 2 条删掉；`@stable` 由谁定与稳定范围交开发者（答复见 Context）。

第 1 轮（Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）十条都成立，第 2 稿已处理。
