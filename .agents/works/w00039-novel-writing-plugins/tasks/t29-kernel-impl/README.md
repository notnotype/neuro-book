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

2026-11-02 经 nbdev 新建，尚未开工。

执行位置：`.worktree/w00039-t29-canon-kernel`，分支 `feat/w00039-t29-canon-kernel`。开发者 11-02：本次在单独的分支上进行，没有开发者允许不合并进 master。

2026-11-02 开发者指定按 autonomous-delivery 推进（Work README 决定表）。实施计划 [plan.md](plan.md)：nb-canon 新包加 canon 插件，八个切片；按条目的时间线做增量计算，差分测试守住“增量等于整本重算”。独立设计的对照在 [`evidences/independent-design.txt`](evidences/independent-design.txt)。合同是分支上的 Spec 第二版（提交 2f0b6ed7e），第一轮审查的处理见 t27 的证据。

计划审查：omp 写了 1 条后额度用完，按规则改派 Claude Opus 接手，共 27 条（阻断 1、重要 20、建议 6），全部成立（1 条接受取舍）；按它改出 Spec 第三版（分支 75a6ff4c7）并重写计划，处理见 [`evidences/plan-review-resolution.txt`](evidences/plan-review-resolution.txt)。依赖试验见 [`evidences/dependency-spike.txt`](evidences/dependency-spike.txt)。

实施进展（分支提交）：

- 第 1 片 cb9bd1913：包骨架与 core（schema、修订路径、地址、位置、精确档的数、中文数字、Component 登记与值校验）。
- 第 2 片 909920b1b：补丁的执行与整本重算的参照实现。
- 第 3 片 b7bdd8932：增量引擎与差分测试（6 个种子各 60 步；另跑过 20 个种子各 100 步全过；两处变异检查都被抓到）。差分测试抓到一处 Spec 没写的情况：核对点所在条目已删除时怎么办，定为不比较（model.md 输出 11）。规模见 [`evidences/scale-engine.txt`](evidences/scale-engine.txt)：三百万字时引擎建好约 0.5 秒、读一个条目中位约 0.3 毫秒、最新一章补记约 16 毫秒、改初值约 0.3 秒、按计划第一次读 0.3 到 0.45 秒；按计划模式起初按平方扫描（1.4 秒），建索引后达标。

- 第 4 片（拆成三段）：4a 3c40cf815 世界的重放与发布（临时 id、请求 id 与摘要、按对象判冲突、写入时校验、带来的变化、按根因合并的待处理、章序调整）；4b 90fc946de 还原与依赖；4c 5b1188b3b 就地改、记一笔与文字替换。实施中按“先改 Spec”补了：修订的 `idMap` 与 `tmp:` 临时 id（revisions.md 输入）、有 id 的列表的顺序叶子 `#order`。

## 下一步

第 5 片：渲染（MDX 白名单与切块、三值求值、两种渲染、带值写法、回写、出错块）。
