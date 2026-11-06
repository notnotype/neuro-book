# 任务：只读计划审查 w00039 t29：世界引擎内核（nb-canon 与 canon 插件）的实施计划，兼看 Spec 第二版

你在 worktree `/home/notnotype/CodeRepository/neuro-book/.worktree/w00039-t27-review`（detached，提交 2f0b6ed7e）。审查对象有两样：

1. **实施计划**：主工作区 `/home/notnotype/CodeRepository/neuro-book/.agents/works/w00039-novel-writing-plugins/tasks/t29-kernel-impl/plan.md`（它在主工作区的 master 上，不在你的 worktree 里）。
2. **Spec 第二版**：你 worktree 里的 `docs/specs/canon/` 五份（components、model、revisions、rendering、project）。第一版的审查报告与逐条处理在主工作区 `.agents/works/w00039-novel-writing-plugins/tasks/t27-kernel-spec/evidences/design-review.txt` 与 `design-review-resolution.txt`。

计划接下来会被照字面实施。找出它的问题。假定作者过于自信：找没写出来的假设、与现有代码不符的事实、照计划做会返工的地方、测试测不到判据的地方、切片顺序的问题。不要复述、不要给总体评价；找不到问题时明确写“仔细检查后没有发现”。

## 依据

- 计划依据的 Spec：上面的五份（第二版）。
- 独立设计（另一个模型只拿目标出的方案，计划已采纳其中几处）：主工作区 `.agents/works/w00039-novel-writing-plugins/tasks/t29-kernel-impl/evidences/independent-design.txt`。
- 现有代码与参照：
  - 插件写法的参照：`packages/neuro-book/src/plugins/storage/`（项目入口拥有数据、浏览器入口经远程服务调用、`project-child.test.ts` 的真实项目子进程测试）；
  - 锁：`packages/neuro-book/src/backend/locked-replace.ts` 的 `holdLock`；
  - 远程服务与项目实例：`docs/specs/runtime/plugin-channel.md`、`runtime/services.md`、`runtime/projects.md`；控制目录：`docs/specs/workspace/files.md`；活页夹清单：`docs/specs/workspace/folder-kinds.md`；
  - 包的规矩：`packages/AGENTS.md`、`docs/modules/monorepo-boundaries.md`、`docs/testing/README.md`（测行为、依赖用真的、不用 mock 与假计时器、子进程在失败时也收口）；
  - 原型（行为参照，不是合同）：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00039-t16-drafts/packages/neuro-book/src/plugins/drafts/web/components/world-engine/` 的 `model.ts`、`engine.ts`、`story.ts`；
  - 规模测量：主工作区 `.agents/works/w00039-novel-writing-plugins/tasks/t09-storage/scripts/` 与 `evidences/`。
- 开发者已确认的决定（主工作区 `.agents/works/w00039-novel-writing-plugins/README.md` 决定表 2026-11-02）：内核放新的工作区包 `nb-canon`，纯 TS、前后端共用，运行时只依赖 TypeBox 与 MDX 解析库；插件在 `packages/neuro-book` 里接存储、服务与界面；第一版分四段（模型与计算、分段日志存储、渲染与带值写法、接进应用）；不做 schema 升级函数、截到上限、Agent 工具与记账管线、正式作者界面、内置 Component 的完整字段清单；在单独分支上做、不合并；按 autonomous-delivery 推进。上面没列的是作者自己的写法，可以质疑。

## 重点

1. **计划里的事实与现有代码是否相符**：storage 插件的入口与远程服务写法、`holdLock` 的签名与行为、远程消息上限、项目子进程测试的写法、包的登记方式；计划说“照某处写法”的地方逐个核对。
2. **增量计算的设计能否守住 Spec model 的语义**：按条目的时间线、跨条目原子性、脏传播、按计划的覆盖层、核对点在遍历之后比较、计划进展按实际模式与位置判定；有没有哪条 Spec 输出在这个设计下做不到或要绕；差分测试能否真的抓到增量与全量的不一致（随机序列要覆盖哪些操作才有用）。
3. **Spec project 输出 14 的速度在这个设计下是否可达**，量法是否与 Spec 的口径一致。
4. **测试与验收映射**：每个 Spec 编号是否真有测试能判定；两进程、写一半、写入失败、别的进程写的行这些能否用真实运行时测出来；星瑕样本与原型对照的做法是否可行（原型的数据形状与 Spec 第二版不同处怎么办）。
5. **切片顺序与提交边界**：每片能否独立验证；前面的切片会不会因为后面的需要返工（例如修订的路径规范、请求 id、独占租约放在 service 里）。
6. **Spec 第二版**：只看第一轮处理里列为“成立，要改”的条目是否真的改到了、改的地方有没有引出新的矛盾或照字面做不到的地方；不要重报第一轮已处理的问题。

## 审查维度

1. 与已定设计一致；2. 依赖的机制真的存在（读 Spec 或实现确认，不按名字推断）；3. 接口与合同；4. 遗漏（失败路径、并发与跨进程、资源释放、兼容）；5. 对照参照（原型 `engine.ts`）列出参照有、计划与 Spec 都没有的项；6. 验收映射；7. 别扭与反常之处（和普遍做法不一样、要绕一下的地方，给改法）；8. 上游选择（质疑到开发者已确认的决定时照写，标明“质疑已确认的决定”）。另外补充遗漏的细节与更有用的做法。

## 规则

- 只读：不修改任何仓库文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t29-kernel-impl/reports/plan-review/tmp/`。
- 不 `bun install`；要跑脚本时用主工作区已有的 node_modules。不跑开发服务与 e2e。
- **不开子审查、不派子代理**：自己按顺序读。
- **每核实一条就追加写入报告文件，不要等到最后**；报告文件只追加，不整份重写、不覆盖已写的条目。运行可能到时间上限被直接截停。
- 有数字就给数字；问题是真的就直说。
- 用中文写。

## 报告

报告文件：`/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t29-kernel-impl/reports/plan-review/report.txt`（只追加）。

每条发现用 `### N. 标题` 开头，编号连续、不重复，写：

- **严重程度**：阻断 / 重要 / 建议；**类别**：正确性 / 不变量 / 一致性 / 遗漏 / 测试 / 写法；**对象**：计划或某份 Spec；
- **位置**：计划的小节或 Spec 的输出、场景编号；
- **现象**、**为什么是问题**、**如何核实**、**建议改法**。

撤回或收窄的条目，在原标题后追加“（撤回）”或“（收窄，见第 N 条）”。最后写“未发现问题的方面”、各级数量，以及有效发现的编号列表。
