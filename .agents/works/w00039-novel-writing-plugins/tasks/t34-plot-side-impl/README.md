---
schema: nbook.task/v2
taskId: t34-plot-side-impl
status: active
updated: 2026-11-05
---

# 剧情侧的实现

## 目标与范围

按开发者 2026-11-05 批准的剧情侧 Spec（[t33](../t33-plot-side-spec/README.md)）实现内核的新机制与剧情插件，在内核分支 `feat/w00039-t29-canon-kernel` 上，开发者允许前不合并进 master。先写实施计划（`plan.md`），开发者确认后分阶段交付。阶段的先后按[剧情侧提案](../../../../../docs/proposals/world-engine-plot-side.md)的待定项 2：条目引用、讲述的位置与标注、在场（后面都依赖）→ 知情与伏笔 → `nb-time` 与时间说法 → 世界线 → 目标与态度、决策与守卫 → 诊断与窄问题的完整一套。

合同：要实现的 Spec（都在分支上，`status: planned`）：

- 内核：`docs/specs/canon/model.md`、`components.md`、`revisions.md`、`project.md` 的新条目，新建的 `worldlines.md`、`time.md`；
- 剧情插件：`docs/specs/plot/knowledge.md`、`foreshadowing.md`、`goals.md`、`decisions.md`、`brief.md`、`checks.md`。

依据：ADR 0041（`docs/adr/0041-world-engine-kernel-mechanisms-plot-plugin-semantics.md`）、0042、0043；t33 的三轮审查证据。

## 已定

| 日期 | 决定 |
|---|---|
| 2026-11-05 | 开发者看过计划要点（“可以，使用 /autonomous-delivery 推进”）：照 [`plan.md`](plan.md) 推进；阶段 A 的 8 片与实现审查一路做完，本该开发者确认的点记进 Work 的[待确认清单](../../pending-confirmations.md)；后续阶段开工前补细计划并审查；主会话写代码；审查在 omp 额度恢复前派 Claude Opus 子代理；在内核分支上，不合并、不 push |
| 2026-11-05 | 开发者：omp 有回退链，可以继续用；本次计划审查用快速审查：Claude Opus 的结论处理完就开工，omp 在后台继续，它的报告回来后单独处理 |

## 当前状态

2026-11-05：
- 计划第二版（处理计划审查 P1 的 17 条，[`evidences/plan-review-P1-resolution.txt`](evidences/plan-review-P1-resolution.txt)）；P2（omp，快速审查里后台跑的那一份）8 条，到 2 小时上限截停，处理见 [`evidences/plan-review-P2-resolution.txt`](evidences/plan-review-P2-resolution.txt)：第 2、4 条改了代码，第 5、7 条改计划，第 8 条在 A9 补集成测试并评估改订阅文件服务的变更事件，第 3、6 条不成立，第 1 条是审查 worktree 取错了提交。
- 阶段 A：
  - A1 已提交（分支 26e40e341）：日志格式 2；未决问题改成决策（样本里答过的问题是 Agent 答的，记成带建议的待定决策，答案在建议里，读取时标“作者未确认”）；讲述的 id（程序发、全局不复用）与按来源的形状校验，只查新写或改过的讲述；修订里按路径声明哪些数组按 id 拆；列表末尾的追加互不依赖。nb-canon 248 个测试、canon 插件 8 个测试通过，两个包类型检查通过。
  - A2 已提交（e2bb03c3e）：服务持有正文快照（打开时读一次，`textChanged` 只重读那一章，canon 插件在章节文件变化时调它）；读取结果带世界版本、正文快照与读取输入的摘要，游标绑定读取输入；`canonicalJson`（RFC 8785，遇到非法值抛错）。nb-canon 257 个测试、canon 插件 8 个测试通过。章节文件的监视在 A9 补一条插件层的测试。
  - A3 已提交（7651345e8）：`ref` 字段、以引用为键的列表（元素名读取时取被引用条目在这个位置的名字）、修订存这次新写的引用 `refs`（依赖与改动记录按条目筛只读它，插件停用后不变）、`ref-invalid`；临时 id 按保留写法替换。差分测试加了以引用为键的列表与改名。nb-canon 262 个测试通过。
  - A3b 已提交（e21059746）：列表元素的语义档子字段（事件与归纳按 `命名空间.字段[元素].子字段` 记，元素加去或整个换掉时清空，语义档的核对点在元素上也是新的起点）；`fieldOf` 改成取地址指到的叶子（元素子字段上的数值核对点从此会比较，Spec 本来就这样要求）。差分测试加了元素子字段的事件。nb-canon 264 个测试通过。

  - A4 已提交（70670350c）：讲述在读取时按正文快照定位（段、段内偏移，按章与正文缓存），失联带原因，`tellings` 按读的先后排、可按讲述位置截取“读过的”、按章范围、条目、是否生效筛；`telling-lost`、`duplicate-quote` 先作为每条的提示给出，A8 并进提示组。写入时数原句出现次数改用与定位相同的切段（原先按整章数，原句首尾带空白时两边会不一致）。canon 插件的规模脚本加了讲述的测量；1000 章的正式测量等 P2 结束、负载降下来再跑（20 章试跑：不带筛选的第一页 1.5 毫秒）。nb-canon 271 个测试通过。

  - A5 已提交（51f242cca）：标注种类与诊断的登记（前缀、重复两步判定共用 `components/declarations.ts`；标注的 schema 白名单关键字、`refs` 路径只经过 `properties` 与 `items`），载荷用 TypeBox 的 JSON Schema 校验器；新加或改过的标注按登记查（同一位置逐字相同的算原样留着），载荷里的引用并进统一的引用校验与修订的 `refs`；只读的标注在 `object` 与 `tellings` 的结果里带 `mark-kind-unknown`、`mark-version-unsupported`；读取输入摘要带三张版本表；服务的 `setRegistry` 换成 `setRegistries`。插件侧的贡献点与接收在 A9 接。发现剧情 Spec 的标注种类 id 写成 `plot.*`，按登记规则要带插件 id 前缀，记进计划阶段 B。nb-canon 280 个测试通过。
  - A6 已提交（2b95f94ae）：参与者 `cast`（马甲写成本体加 `as`，`invalid-cast`）、叙述 `nature: narration`（`narration-with-patches`、`narration-without-telling`）、`presence`（实际模式与按计划模式，另给没记参与者的条数）、本章涉及的条目算上参与者、`changes` 加性质与计划进展的筛选；引擎两边加 `plannedAt`（按计划模式在一个位置计入的计划），差分测试比对。涉及的条目与参与者按 Spec 也查“已出场”（原先只查补丁的条目）。顺带修了 t29 的老问题：没有补丁的已写变更在增量更新里不记套用结果，兑现不了计划；差分测试的模拟器加了没有补丁的变更（20 个种子、每个 100 步一致）。安放范围 `{after, through}` 的两头是分叉的切口与触发处，挪到阶段 D（计划已改）。nb-canon 285 个测试通过。

  - A7 已提交（6979e523c）：决策的状态表做成一张表（`world/decisions.ts`），写入校验与授权检查共用；作者授权（`world/authorization.ts`）：宿主与内核共用 `authorizationBinds`，内核先逐字比 `binds` 再交宿主验签名；出处只由内核写（`source-not-writable`）；缺来源排在校验之后报（`author-source-required` 带需要的清单）；还原拆成“算补偿与需要的授权”与“核对后发布”，`preview` 收还原请求；修订存请求原样的授权（换过临时 id 的签名验不过，有变异检查）。`decisions` 读取带说明：作者未确认、作者没说理由、重新打开前定下的、挂的条目已删。样本里“放弃”的问题改记成待定（放弃要作者来源）。nb-canon 294 个测试通过。应用的远程合同只跟着改了 `decisions` 的形状，`revert` 带授权、`preview` 收还原请求在 A9 接。

  - 计划审查 P2 的第 2、4 条已改（0ea52acab）：游标绑定读取参数；临时 id 只在引用位置上换（A3 原先把与临时 id 相同的任何字符串都换掉，不合 components 输出 18）。
  - A8 拆成两片（内容多，拆开各自验证）：A8a 已提交（759254a32），引擎两边的待处理按模式算（按计划模式时核对点、套不上与嫌疑区间都算上计入的计划），排序表收成 `engine/pending.ts` 一处，差分测试两种模式都比（20 个种子、每个 100 步一致）。nb-canon 298 个测试通过。

## 下一步

1. A8b：插件诊断（登记计算与数据版本、去重、截断、已处理与旧版本决策、没算出、停用另列、缓存、耗时）、提示组（讲述失联、原句重复、标注与 Component 的版本与类型不在）、`pending` 的组与游标与各组总数、`CanonReadView`。
2. A4 的 1000 章测量已跑（[`evidences/scale-a4.txt`](evidences/scale-a4.txt)）：都在预算内；打开到可以读 1508 ms（t29 时 1065），日志 22.0 MB（t29 时 13.5），主要是修订存下的 `refs`，交实现审查一并看。
