# t48 计划：nb-layout 的 API 报告与稳定性标注（第 1 稿）

## Context

- **为什么做**：[提案](../../../../../docs/proposals/nb-layout-general-library.md)第二档的第 2、3 项（API 报告 CI、`@stable`/`@experimental` 全量标注）；[ADR 0054](../../../../../docs/adr/0054-nb-layout-general-library.md) 第 10 条：版本承诺只覆盖主题级的一小批 CSS 变量、README 的 `data-*` 表与标 `@stable` 的符号。提案第 238 行要求标注前先写一条映射规则或先晋升 Spec。
- **前提**：t47 把 nb-layout 做成了编译产物，四个入口的声明逐字节稳定（[t47 证据](../t47-build-pipeline/evidences/probes.txt)）；入口文件是一行一个名字的显式清单，`src/exports.test.ts` 核对（ADR 0054 第一档）。nb-layout 还是 `private`，首发由开发者决定：在那之前标注不是已经发出去的承诺，改起来便宜。
- **开发者已定**：第二档顺序（2026-11-22 追认）。别的都是作者的推荐。
- **探针**（[证据](evidences/probes.txt)）：组件的声明上没有注释，标注写不进声明；用类型检查器读产物的声明能按名字列出组件的 props（没有 `$N` 内部名），要过滤 Vue 自带与透传的属性、改写模块路径。
- **工作方式**：autonomous-delivery；t47 合入之后从 master 开 worktree。计划审查按审查分工交 Claude Sonnet（前端包的 API 形状），阻塞。

## 技术选型

| 问题 | 选用 | 理由 | 否决 |
|---|---|---|---|
| 从声明出报告 | 仓库已有的 `typescript` 编译器接口，读 `dist/package/*.d.ts` | 组件的 props、事件、插槽经类型检查器按结构展开，不带 vue-tsc 的内部名 | api-extractor：新依赖；组件在声明里只是 `typeof __VLS_export$N`，它不展开，报告里看不到 props；直接把声明快照当报告：`$N` 编号随加组件整体挪动，差异很吵 |
| 标注放哪 | 入口文件清单那一行的行尾注释 | 组件的声明上带不了注释（探针 1）；入口清单本来就是公开面的真相源，`moduleExports` 给出每个名字的行号 | 声明上的 JSDoc：组件没有；另一张表：与清单两处维护 |

## 关键设计

### 标注：`packages/nb-layout/src/index.ts`、`src/vue/index.ts`、`src/vue/text.ts`、`src/locales/index.ts`

- 每个公开名字所在的那一行行尾写 `// @stable` 或 `// @experimental`；`export {default as NestedGrid} from "./NestedGrid.vue"; // @experimental` 这种一行一个的写法同样。
- 映射规则（写进 README 的“版本承诺”）：名字的行为合同所在的 Spec 是 `implemented`、并且仓库里 Lab 之外有使用方（新应用的工作台、nb-story、开发者面板）时标 `@stable`，否则 `@experimental`。现在 `ui/nested-grid`、`ui/layout-drag` 都是 `planned`，`ui/sortable-list` 是 `implemented` 但只有 Lab 在用：全部标 `@experimental`。晋升 Spec 是开发者的决定，与首发一起交（Task README 与最终汇报）。
- `src/exports.test.ts` 加一条：每个公开名字恰好一个标注；标注只认这两个词。
- README 加“版本承诺”一节：承诺的范围（ADR 0054 第 10 条）、映射规则、1.0 之前 `@experimental` 的签名会变、标注在入口清单里看（发布包里在 API 报告里）。

### API 报告：`packages/nb-layout/scripts/api-report.ts`（新），`api/*.api.txt`（入库）

- 读 `dist/package/` 的四个入口声明（要先 `build:package`），每个入口一份 `api/<入口>.api.txt`：按名字排序，每行 `<标注> <种类> <名字>: <签名>`。
  - 种类：`function`、`const`、`type`、`interface`、`class`、`component`。
  - 函数与常量写类型检查器给的类型；类型与接口写展开后的结构（`typeToString`，不截断）。
  - 组件分三段写自己的 props、事件、插槽（名字与类型）：只留声明在 `dist/package/` 里的属性，Vue 自带的（`key`、`ref`、`class`、`style`、`onVnode*`）与透传的 HTML 属性声明在 Vue 或 DOM 的声明文件里，丢掉。
  - 类型文字里的 `import("<路径>/shared-xxx").Name` 改写成 `Name`（公开类型的名字在入口里唯一；改写之后报告不随路径与块名变）。
  - 标注取自入口清单（上一节），报告里每行带着，评审时看得到一个名字从 `@experimental` 变 `@stable`。
- `bun run api:report` 写报告；`bun run api:check` 生成到临时目录与 `api/` 逐字节比，不同就以 1 退出，打印差异与“确认公开面要这样变，就运行 bun run api:report 更新”。
- CI：`.github/workflows/ci.yml` 的 `app-package` 作业在 `build:package` 之后加 `bun run api:check`。
- 与导出名测试的分工：`exports.test.ts` 管名字（显式清单、禁用词、文档里教的名字、标注齐全）；报告管签名与类型的变化。
- 报告的确定性：同一份产物两次生成逐字节相同（单测：对一份小的样本声明跑两次）；属性按名字排序，不按声明先后。

## Spec 与文档改动

- 不改 Spec：标注是包的发布承诺，写在 README 与 ADR 0054 第 10 条；Spec 的成熟度不动（晋升交开发者）。
- `packages/nb-layout/README.md`：“版本承诺”一节。
- `packages/nb-layout/AGENTS.md`：改公开面时更新报告（`api:report`），新名字要带标注。
- `packages/nb-layout/CHANGELOG.md` 的 `[Unreleased]`：公开名字都标了稳定性，1.0 之前全部 `@experimental`。

## 切片

1. **标注**：四个入口每个名字带标注；`exports.test.ts` 核对；README“版本承诺”。验证：`bun test src/exports.test.ts src/readme.test.ts`、`bun run typecheck`。
2. **报告**：`api-report.ts`、`api/*.api.txt`、`api:report` 与 `api:check`、CI 一步、单测（样本声明：组件的过滤、类型改写、排序、两次相同；改一个签名报告变）。验证：`bun run build:package && bun run api:check`；改一处签名看 `api:check` 失败。
3. **收口**：AGENTS.md、变更记录、Task README、待确认清单；实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| 依据 | 覆盖 |
|---|---|
| ADR 0054 第 10 条：只承诺标 `@stable` 的符号 | `exports.test.ts`（每个名字恰好一个标注）；README“版本承诺” |
| 提案第二档第 2 项：API 报告 CI | `api:check` 在 CI 的 `app-package` 作业；`api-report` 的单测 |
| 提案第 238 行：先写映射规则 | README 的映射规则；全部 `@experimental` 的现状写在 Task README |

## 验证

- 切片内按上表；收口跑 nb-layout 的 `bun test`、`typecheck`、`build:package`、`api:check`。
- 不验证：npm 页面怎么显示（首发之后）。

## 不做与风险

- 不晋升 Spec，不把任何名字标 `@stable`（交开发者）。
- 不做 nb-workbench-layout、插件 SDK 的报告（SDK 只转出 `NestedGrid`，它的公开面由应用的 `sdk.test.ts` 管）。
- 风险：类型检查器的 `typeToString` 在 TypeScript 升级时措辞会变，报告跟着变一批。兜底：差异里一眼看得出是格式变化，`api:report` 一次更新；在报告文件头写生成它的 TypeScript 版本。

## 待确认清单（实施时写进 Work 的清单）

- 标注放在入口清单的行尾注释，声明上不另写。
- 映射规则（Spec `implemented` 且 Lab 之外有使用方才 `@stable`），现在全部 `@experimental`。
- 报告是自写的类型检查器脚本，不用 api-extractor；报告格式（每行一个名字，组件分 props、事件、插槽）。
