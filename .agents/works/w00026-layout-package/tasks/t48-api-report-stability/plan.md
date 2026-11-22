# t48 计划：nb-layout 的 API 报告与稳定性标注（第 2 稿）

第 2 稿按第 1 轮设计审查（Claude Sonnet，阻断 2、重要 5、建议 3，[证据](evidences/design-review.txt)）重写：非组件的名字打印声明节点（不用类型检查器展开、不碰压缩名）；组件用 vue-component-meta 出 props、事件、expose，插槽另读 `defineSlots`；标注写进发布包的声明；映射规则写成可判的口径，插件 SDK 转出的名字按它已许下的兼容承诺标 `@stable`；报告的确定性与 `api:check` 的流程补齐。逐条处理见文末“设计审查”。

## Context

- **为什么做**：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第二档第 2、3 项；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条：版本承诺只覆盖主题级的一小批 CSS 变量、README 的 `data-*` 表与标 `@stable` 的符号。
- **前提**：t47 已合入，`build:package` 出的四个入口声明逐字节稳定；入口是显式清单（`src/exports.test.ts`）。nb-layout 还是 `private`。
- **开发者已定**：第二档顺序。待追认的：插件 SDK 转出的 nb-layout 名字标 `@stable`（[待确认清单](../../pending-confirmations.md) t48 那一行）。晋升 `ui/nested-grid`、`ui/layout-drag` 不在本 Task，交开发者。
- **探针**（[证据](evidences/probes.txt)）：组件声明上带不了注释；vue-component-meta 对 7 个组件出得了 props（带缺省值）、事件、带类型的插槽、expose，118 毫秒；它列不出 `panel-${string}` 这种模板字面量插槽名。
- **工作方式**：autonomous-delivery；从 master 开 worktree。第 2 轮计划审查交 Claude Sonnet（前端包的 API 形状），阻塞。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 组件的公开面 | `vue-component-meta`（新开发依赖，与仓库的 vue-tsc 3.3.x 同一族，版本跟它对齐） | props 带缺省值、事件与回调属性分开、expose 也出，类型是真名（探针 4） | 自写类型检查器展开：要自己过滤 Vue 自带属性、区分事件与回调、读 expose（第 1 轮审查第 3 条），出来的类型还带压缩名 |
| 非组件的公开面 | `typescript` 的 `createPrinter({removeComments: true})` 打印产物声明里的声明节点 | 结构变化看得见；打包后的声明里类型、接口、函数是真名（第 1 轮第 1、2 条） | `typeToString`：接口与多数别名只打出名字，跨块的引用是压缩名 |
| 报告工具 | 自写脚本组合上面两样 | api-extractor 读同一份声明，组件只看到 `typeof __VLS_export$N` | api-extractor |

## 关键设计

### 标注：四个入口文件、`scripts/pack.ts`

- **真相源**：入口清单里每个公开名字那一行的行尾 `// @stable` 或 `// @experimental`。`exports.test.ts` 读入口的原始行（不经 `moduleExports` 的去重）核对：每个名字所在的行恰好一个标注；同一个名字出现在几个入口（例如 `GridLayoutCommitResult` 在 `.` 与 `./vue`）时标注相同。
- **映射规则**（可判，写进 README“版本承诺”）：名字标 `@stable`，当且仅当
  1. 插件 SDK 把它转出（`packages/neuro-book/src/sdk/components.ts` 与 SDK 其它入口里对 `@notnotype/nb-layout` 的转出）：SDK 已经许下兼容承诺；或者
  2. 它所在的 Spec 是 `implemented`，并且有仓库里 Lab 之外的产品代码在用。
  现在：第 1 条得出 7 个组件与它们的类型（约 16 个），第 2 条的 `ui/sortable-list` 与状态栏设置页（`StatusLinePage.vue`）落在第 1 条里；其余全部 `@experimental`，写成“暂缓：`ui/nested-grid`、`ui/layout-drag` 还是 `planned`，晋升由开发者决定”。
- **SDK 与 nb-layout 对齐的测试**：应用的 `sdk.test.ts`（或同目录的新测试）读 SDK 入口里对 `@notnotype/nb-layout` 的转出名字，再读 nb-layout 入口的标注，断言它们都是 `@stable`。以后有人把 SDK 转出的名字改成 `@experimental`，或 SDK 多转出一个 `@experimental` 的名字，这里失败。
- **让 npm 上的使用方看得到**（第 1 轮第 5 条）：`pack.ts` 打完声明之后，按入口清单把标注写成 JSDoc 标签：
  - 函数、常量、类型、接口：加在产物声明的那个声明上（已有 JSDoc 的并进去，没有的新建）；
  - 组件：加在入口导出的那个 `declare const _default$N` 上（按末尾导出列表 `_default$N as 名字` 找）。
  - 纯文本处理、按名字排序，同一份输入写出同一份字节；发布冒烟的 `sameBytesTwice` 与 t47 的两次打包比对照样覆盖。单测：样本声明上加标注、已有 JSDoc 的合并、组件按导出列表定位。

### API 报告：`packages/nb-layout/scripts/api-report.ts`（新），`api/*.api.txt`（入库）

- 每个入口一份 `api/<入口>.api.txt`，第一行是生成它的工具版本（TypeScript、vue-component-meta），之后按名字码元排序（`a < b`，不用 `localeCompare`）。每个名字一段，首行 `<标注> <种类> <名字>`：
  - **函数、常量、类型、接口、类**：下面接产物声明里那个声明节点的打印（去注释）。跨块导入的压缩别名（`Z as GridRect`）按入口与共享块的导出列表还原成真名。
  - **组件**：四段，取自 vue-component-meta（读源码 `.vue`，经 `tsconfig.vue.json`）：
    - props：只留声明在 `packages/nb-layout/src` 里的（`noDeclarations: false` 给出声明文件），每行 `名字?: 类型 = 缺省值`；用 `& HTMLAttributes` 透传的组件另写一行“透传：HTMLAttributes”；
    - 事件：`名字(参数)`；
    - 插槽：打印源码里 `defineSlots` 的类型参数（覆盖 `panel-${string}` 这种模板字面量的名字，vue-component-meta 列不出）；
    - expose：名字与类型。
  - 类型文字里出现的绝对路径（`node_modules/…`、包目录）改写成包名或去掉；单测：把路径前缀换掉，报告不变。
- `bun run api:report`：先跑 `build:package`，再写报告。`bun run api:check`：同样先构建，生成到临时目录与 `api/` 比。工具版本那一行不同而正文相同时单独提示“工具链升级了，确认后 api:report 更新”；正文不同时打印差异与“公开面变了：确认后 api:report 更新，变了 `@stable` 名字的签名要在变更记录的不兼容改动里写”。
- CI：`.github/workflows/ci.yml` 的 `app-package` 作业把 nb-layout 那一步换成 `bun run api:check`（它自己先构建）。
- 与导出名测试的分工：`exports.test.ts` 管名字（清单、禁用词、文档里教的名字、标注齐全一致）；报告管签名、结构与组件的四段；SDK 对齐的测试管“SDK 承诺了的都是 `@stable`”。
- 已知限制（写进 README）：报告看不到运行时行为与 CSS；缺省值只对组件 props 有；Vue 或 TypeScript 升级会让报告整批变化（第一行版本变，单独提示）。

## Spec 与文档改动

- 不改 Spec。
- `packages/nb-layout/README.md`：“版本承诺”一节（ADR 0054 第 10 条的三项、映射规则、现在的状态、标注在哪里看：编辑器悬停与仓库里的 `api/*.api.txt`）。
- `packages/nb-layout/AGENTS.md`：新名字要带标注；改公开面后 `api:report`；SDK 转出的名字必须 `@stable`。
- `packages/nb-layout/CHANGELOG.md`：`[Unreleased]` 写公开名字标了稳定性、SDK 转出的是 `@stable`。
- Work 后续：ADR 0054 第 10 条另两项（主题级 CSS 变量、README 的 `data-*` 表）没有机检（第 1 轮第 10 条），不在本 Task。

## 切片

1. **标注**：四个入口加标注；`exports.test.ts` 的两条核对；SDK 对齐的测试；README“版本承诺”与映射表。验证：nb-layout `bun test src/exports.test.ts src/readme.test.ts`、`typecheck`；应用 `bun test src/sdk`。
2. **标注进发布包**：`pack.ts` 写 JSDoc 标签；单测。验证：`build:package` 两次逐文件相同、`dist/package/vue.d.ts` 里 `NestedGrid` 那条声明带 `@stable`；`bun test scripts`。
3. **报告**：`api-report.ts`、`api/*.api.txt`、`api:report`、`api:check`、CI；单测（组件四段与过滤、压缩别名还原、路径改写、码元排序、两次相同、改一处签名报告变）。验证：`bun run api:check`；改一个签名看它失败、只改工具版本看单独提示。
4. **收口**：AGENTS.md、变更记录、Work 后续、Task README、待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| 依据 | 覆盖 |
|---|---|
| ADR 0054 第 10 条：只承诺标 `@stable` 的符号 | `exports.test.ts`（标注齐全、一致）；SDK 对齐的测试；发布声明里的 JSDoc 标签（`pack.ts` 单测与构建核对） |
| 提案第二档第 2 项：API 报告 CI | `api:check` 在 CI；`api-report` 的单测 |
| 提案第 238 行：映射规则 | README 的规则与现状；SDK 对齐的测试 |

## 不做与风险

- 不晋升 Spec；第 2 条规则下的名字（除 SDK 已承诺的）不标 `@stable`。
- 不做主题 CSS 变量与 `data-*` 表的机检（记进 Work 后续）。
- 风险：vue-component-meta 跟着 Volar 升级，输出格式会变；版本与 vue-tsc 对齐，报告第一行写版本，变了单独提示。
- 风险：SDK 对齐的测试跨包读 nb-layout 的入口文件（按仓库路径读文本，不导入源码），nb-layout 入口改名时要一起改。

## 设计审查

第 1 轮（Sonnet，[证据](evidences/design-review.txt)）十条都成立：

1. 类型与接口只打出名字（阻断）：非组件改为打印声明节点。
2. 改写 `import()` 得到压缩名（阻断）：打印声明节点，压缩别名按导出列表还原。
3. 组件漏 expose、事件与插槽取法没写、内部名泄漏（重要）：用 vue-component-meta 出 props、事件、expose，插槽打印 `defineSlots`；透传单独一行。
4. 事实错误（重要）：`SortableList` 有状态栏设置页这个使用方；SDK 转出 7 个组件与类型。改正，并按 SDK 已许下的承诺定标注（待开发者追认）。
5. npm 上看不到标注（重要）：`pack.ts` 写进声明。
6. 映射规则不可判（重要）：改成两条可判的口径，现状写成“暂缓”。
7. 跨机器不确定（重要）：码元排序、去绝对路径、工具版本单独一行。
8. 同名多入口、去重漏行（建议）：读原始行，同名标注一致。
9. `api:check` 读旧产物、版本头（建议）：先自己构建；版本行单独提示。
10. 没评估 vue-component-meta、ADR 第 10 条另两项（建议）：评估了并选用（探针 4）；另两项记进 Work 后续。
