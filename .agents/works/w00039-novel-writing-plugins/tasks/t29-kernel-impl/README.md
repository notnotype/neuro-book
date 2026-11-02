---
schema: nbook.task/v2
taskId: t29-kernel-impl
status: active
updated: 2026-11-02
---

# 世界引擎内核实现（nb-canon）

## 目标与范围

按 t27 的内核 Spec 实现 nb-canon 包与插件接入：模型与计算、分段日志存储、白名单 MDX 渲染与带值写法、项目进程里的服务；星瑕样本在新内核上重放出与 t16 原型相同的结果。不做 Agent 工具、记账管线与正式的作者界面（Work README 决定表 2026-11-02）。

合同：实现 t27 写的内核 Spec（`docs/specs/canon/`，写好后补链接）；新建 capability，不改已有 Spec 的行为。

前置：t27 的 Spec 经开发者批准。

## 当前状态

2026-11-02 经 nbdev 新建，同日开工。

执行位置：`.worktree/w00039-t29-canon-kernel`，分支 `feat/w00039-t29-canon-kernel`。开发者 11-02：本次在单独的分支上进行，没有开发者允许不合并进 master。

2026-11-02 开发者指定按 autonomous-delivery 推进（Work README 决定表）。实施计划 [plan.md](plan.md)：nb-canon 新包加 canon 插件，八个切片；按条目的时间线做增量计算，差分测试守住“增量等于整本重算”。独立设计的对照在 [`evidences/independent-design.txt`](evidences/independent-design.txt)。合同是分支上的 Spec 第二版（提交 2f0b6ed7e），第一轮审查的处理见 t27 的证据。

计划审查：omp 写了 1 条后额度用完，按规则改派 Claude Opus 接手，共 27 条（阻断 1、重要 20、建议 6），全部成立（1 条接受取舍）；按它改出 Spec 第三版（分支 75a6ff4c7）并重写计划，处理见 [`evidences/plan-review-resolution.txt`](evidences/plan-review-resolution.txt)。依赖试验见 [`evidences/dependency-spike.txt`](evidences/dependency-spike.txt)。

实施进展（分支提交）：

- 第 1 片 cb9bd1913：包骨架与 core（schema、修订路径、地址、位置、精确档的数、中文数字、Component 登记与值校验）。
- 第 2 片 909920b1b：补丁的执行与整本重算的参照实现。
- 第 3 片 b7bdd8932：增量引擎与差分测试（6 个种子各 60 步；另跑过 20 个种子各 100 步全过；两处变异检查都被抓到）。差分测试抓到一处 Spec 没写的情况：核对点所在条目已删除时怎么办，定为不比较（model.md 输出 11）。规模见 [`evidences/scale-engine.txt`](evidences/scale-engine.txt)：三百万字时引擎建好约 0.5 秒、读一个条目中位约 0.3 毫秒、最新一章补记约 16 毫秒、改初值约 0.3 秒、按计划第一次读 0.3 到 0.45 秒；按计划模式起初按平方扫描（1.4 秒），建索引后达标。

- 第 4 片（拆成三段）：4a 3c40cf815 世界的重放与发布（临时 id、请求 id 与摘要、按对象判冲突、写入时校验、带来的变化、按根因合并的待处理、章序调整）；4b 90fc946de 还原与依赖；4c 5b1188b3b 就地改、记一笔与文字替换。实施中按“先改 Spec”补了：修订的 `idMap` 与 `tmp:` 临时 id（revisions.md 输入）、有 id 的列表的顺序叶子 `#order`。

- 第 5 片 d32f8885e：渲染与带值写法（MDX 依赖：micromark 及 mdxjs、GFM 表格与删除线、CJK 友好强调扩展，acorn 改为直接依赖）。

- 第 6 片 abc60ad8e：分段日志存储（`./node` 子路径）。文件操作经一个窄接口，注入失败的实现与 `node:fs` 实现跑同一组契约测试；超过一段上限的单行另开新段。
- 第 7 片 627a2c058：世界服务（单写者队列、独占租约、事件、补归纳、按请求 id 查结局、别的进程的行）。服务引用 node 存储，所以从 `./node` 导出。写服务测试时抓到第 4a 片的一处错：章序调整分配了修订 id 却没存回分配器，下一次发布会重用同一个 id，已修并在章序调整的测试里补断言。Spec 只给 `binder-invalid` 定了诊断码，服务的其余诊断（`reorder-not-recorded`、`duplicate-version`、`external-change`、`reduction-cache-bad-line`、`reduce-failed`）是实现取的名字。nb-canon 全包 208 条测试通过。

## 下一步

第 8 片：canon 插件与验收（项目入口、活页夹、远程服务与预算、贡献变化；两进程与真实项目子进程的测试；星瑕样本对照；插件侧完整规模脚本；重测 `measure-project.ts`）。
