---
schema: nbook.task/v2
taskId: t47-build-pipeline
status: active
updated: 2026-11-22
---

# 编译产物流水线与发布脚本的第三条通道

## 目标与范围

nb-layout 出编译产物（ESM、类型声明、style.css）、发布脚本加“独立版本的生成包”通道、MIT 许可证与第三方声明按包判断（ADR 0054 第 5、6 条，提案“第二档：发布流水线”“MIT：要处理的事实”）；nb-story 的网页构建改读编译产物。发到 npm 由开发者执行。形状按 t43 的核实与 nb-story 的接入定。

合同：[`story/cli-skill`](../../../../../docs/specs/story/cli-skill.md) 输出 19（网页包比源码旧的提示）补一句范围：读编译产物的工作区包记它的源文件；nb-layout 的行为合同（`ui/nested-grid` 等）不变。发布形态按 ADR 0054 第 6 条，写在包 README 与[发布手册](../../../../../docs/standards/releasing.md)。

## 输入

- [t43](../t43-tier2-verification/README.md) 的“给 t47 的输入”：出声明沿用 `rolldown-plugin-dts`、声明不可复现、`style.css` 与 `sideEffects`、`lab-sources` 不发、产物去注释、Trellis 核对已完成。
- [t46](../t46-english-default-text/README.md)：建 nb-layout 的变更记录时，“不兼容的改动”写没有注入时的缺省语言从 zh-CN 改成 en-US；新增 `layoutCatalogTranslate`（`./text`）。

## 当前状态

2026-11-22：六个切片都实施完，在分支 `w00026/t47-build-pipeline`（worktree `.worktree/w00026-t47-build-pipeline`），实现审查待处理（omp `--model @review`）。[计划](plan.md)第 2 稿，末尾“实施中改的”记了与计划不同的三处。

此前：计划第 1 稿开工前跑了两个探针（[证据](evidences/probes.txt)）；第 1 轮设计审查（omp `--model @review`，阻断 2、重要 3、建议 4，[证据](evidences/design-review.txt)）除第 1 条都成立，改到第 2 稿，不再开第 2 轮。

### 提交

| 提交 | 内容 |
|---|---|
| `4c3dc1634` | 切片 1：`build:package`（`scripts/pack.ts`）出 `dist/package/`，`--web` 出 `dist/web-build/`；声明先 `vue-tsc` 一次出全部再打包；构建完自查；源码包加 `./style.css` |
| `f41d05c15` | 切片 2：nb-layout 改 MIT（`LICENSE`、`license`、README、包规则、变更记录、根 README 的许可证一节）；第三方声明只不列与发布包同许可的自家包 |
| `36efba624`、`fcce6affe` | 切片 2 补：应用包与 SDK 的第三方声明补上工作区里许可不同的依赖（Vite 与 Bun 的清单看不见工作区的包）；私有、没写许可的工具包跳过 |
| `cadc9892f` | 切片 3：生成包分产品版本与版本独立两种；`private` 的只冒烟不进清单，发版准备与 Release 说明不看它，上一个标签下 `private` 的按新包；nb-story 对 nb-layout 写 `workspace:^` |
| `ccce9912c` | 切片 5：nb-story 的网页构建读 `dist/web-build/`；网页包新旧记录换成产物的源文件；`dist/web/THIRD-PARTY-NOTICES.md` |
| `8dfbeca44`、`398b019c3` | 切片 4：发布冒烟加 nb-layout 的宿主、版本独立的生成包连生成两次比字节、nb-story 的声明里有 nb-layout；CI 的 `app-package` 加完整构建；冒烟里静态服务对不在的文件回 404 |

### 验证

- nb-layout：`build:package` 两次逐文件相同；四个入口的声明导出数与源码入口相同（122、33、6、3）；`bun test` 418 条、`typecheck` 通过。
- 发布脚本：`vitest run scripts/release` 116 条通过（`packages.test.ts` 新增 4 条：产品包与版本手工提的目录、`private` 的看法、MIT 的生成包检查、许可写错报出）；`tsc -p scripts/tsconfig.json` 通过；`release:check` 通过。
- 第三方声明：`third-party-notices.test.ts`（新）3 条；变异（改回按名字过滤）2 条失败；SDK 构建后 `THIRD-PARTY-NOTICES.md` 里有 nb-layout。
- nb-story：`typecheck`、`bun test src` 701 条通过（含网页包新旧记录的新用例）；网页构建读产物后 `frame`、`side-by-side`、`viewer` 三个 e2e 文件 53 条通过；新旧记录里有 62 个 nb-layout 源文件、0 个产物文件；`dist/web` 的第三方声明里有 nb-layout 的 MIT。
- 发布冒烟（本机，`prox bun run release:smoke`，不发布）：13 个包检查、打包，nb-layout 只冒烟不进清单（清单 12 个包）；nb-layout 宿主（README 起步、四个入口的类型、构建、浏览器里拖动与方向键、样式）通过；其余照旧通过。第一次跑完以 1 退出：宿主冒烟的静态服务读不在的 favicon 抛了未处理的错误，修在 `398b019c3`，重跑在 `398b019c3` 上通过、以 0 退出（负载约 2）。
- 合入前补核（advisor 提的）：`bun install --frozen-lockfile` 通过（锁文件不用改）；两次构建各打一个 tarball，SHA-256 相同（`release-plan` 比的是整个 tarball）；应用包的 `THIRD-PARTY-NOTICES.md` 里有 nb-layout；`release-notes.ts --dry-run --previous <最近的标签>` 列出 10 个源码包、没有 nb-layout（还是 `private`）。
- CI 的 `check` 作业对照（`--since` 分支起点）：`governance:check` 与 `docs:check` 的失败都不在 t47 改的文件上（网络插件的消息目录没登记、别处测试的固定等待、`bots/view.md` 的登记）；`test:affected --typecheck` 两处失败：`plugin-sdk/pack.test.ts` 断言 SDK 的声明里一个 `@notnotype/` 都不许出现，是 t47 有意改掉的旧规则，改成“只列 MIT 的 nb-layout”后通过（`08aff0ed0`）；`message-catalogs.test.ts` 的网络插件目录没登记，master 上同样失败。
- 计划“验收映射”与实际覆盖的对照：`release-plan.test.ts`、`publish`、`pack-smoke` 的单测没有写。版本独立的包按历史包处理靠 `PRODUCT_PACKAGES` 的单测加 `publish.ts` 一行接线（读代码核过）；`private` 的只冒烟不进清单靠本机冒烟（清单 12 个包，没有 nb-layout）；发版准备与 Release 说明不看 `private` 的靠 `versionedPackage` 的单测加上面的演练。没有验证：`pack-smoke --from registry` 的新写法（nb-layout 首发前 registry 上没有它，这条路径要首发之后才跑得到）、流水线上的发布。
- 插件 SDK 的声明两次构建不同（`components.d.ts` 36 行，属性先后），与 nb-layout 原来的问题同源：记进 Work 的后续，不在本 Task 改。

## 下一步

实现审查（omp `--model @review`）→ 处理 → 合入。首发 nb-layout 是开发者的决定（发布手册“一次性准备”的新包首发）。
