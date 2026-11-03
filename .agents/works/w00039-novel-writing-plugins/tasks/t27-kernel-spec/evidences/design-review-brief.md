# 任务：只读设计审查 w00039 t27：世界引擎内核的五份 planned Spec

你在 worktree `/home/notnotype/CodeRepository/neuro-book/.worktree/w00039-t27-review`（detached，提交 f8aeaeaef）。审查对象是 `docs/specs/canon/` 下五份 Spec：

- `components.md`（canon.components：Component 类型与字段声明）
- `model.md`（canon.model：条目、剧情变更与状态）
- `revisions.md`（canon.revisions：修订、发布与还原）
- `rendering.md`（canon.rendering：渲染与带值写法）
- `project.md`（canon.project：作品里的世界——日志、打开与恢复、单写者、世界服务、独占写入、归纳补算、速度）

这几份 Spec 接下来会被照字面实现（新包 `nb-canon` 加 canon 插件）。找出它的问题。假定作者过于自信：找没写出来的假设、没处理的边界、隐含的耦合与共享状态、彼此矛盾的地方、照字面实现会返工的地方、异常输入下的失败。不要复述、不要给总体评价；找不到问题时明确写“仔细检查后没有发现”。

## 依据

- 已接受的提案：`docs/proposals/world-engine-kernel.md`（第四版；第四部分第 1 到 9 节是行为来源）。
- ADR：`docs/adr/0037-world-engine-story-change-log.md`、`docs/adr/0038-world-engine-entry-text-is-whitelisted-mdx.md`、`docs/adr/0039-world-engine-segmented-revision-log.md`。
- 提案第三轮审查推到 Spec 的 24 条细节与处理：主工作区 `/home/notnotype/CodeRepository/neuro-book/.agents/works/w00039-novel-writing-plugins/tasks/t02-story-model/evidences/design-review-r3-resolution.txt`。
- 存储方案与测量：主工作区 `.agents/works/w00039-novel-writing-plugins/tasks/t09-storage/storage-draft.md` 与同目录 `evidences/`。
- 作者界面原型的类型与计算（行为参照，不是合同）：`/home/notnotype/CodeRepository/neuro-book/.worktree/w00039-t16-drafts/packages/neuro-book/src/plugins/drafts/web/components/world-engine/` 下的 `model.ts`、`engine.ts`。
- Spec 的写法规则：`docs/specs/README.md`（九节、两条判据、编号、planned 只写黑盒）。
- 开发者已确认的决定（都在主工作区 `.agents/works/w00039-novel-writing-plugins/README.md` 的决定表，日期 2026-11-01 到 11-02，出处是 w00039 的会话）：
  - 骨架用事件溯源，剧情变更日志统一设定、剧情与情节，计划是还没写的变更；条目由主 MDX 加按 Component 分块的状态组成（11-01）。
  - 随剧情变化的文字整段替换，不做文本 diff 与三方合并；作者在看到的样子上就地改，默认算改设定（11-02）。
  - 记账默认生效、整章可撤销，有问题的进待处理；所有写入走同一条发布通道、带版本、留改动记录、可逐条还原（11-02）。
  - 几笔累出来的数不直接改，在流水里改某一笔或补一笔；第一版不做情节之间的因果连接；剧情线数据上是条目（11-02，t16 第 1 轮后）。
  - 初值与“第 1 章开头”分开，前史夹在中间；修订只存变了的字段；“与设定冲突”记成一条待定的剧情变更；“带来的变化”在发布时算好存进修订；数值追踪做精确与语义两档，语义档的值是文字，由小模型从最近一个确定的起点归纳、按输入缓存（11-02，t16 第 2 轮后）。
  - 记账时把正文重述设定的句子链到字段上（11-02）。
  - 存储：按 256 KiB 分段的只追加 JSONL 日志，内存重放，不用数据库；条目不做成文件；第一版不开放经文件改设定（11-02，ADR 0039）。
  - 内核优先；第一版不做 schema 升级函数（只存版本号）与数值溢出“截到上限”（只做拒绝）（11-02）。
  - 写 Spec 前确认的六条假设：章的身份与先后由宿主从活页夹给；语义档归纳失败不挡发布；独占写入期间别的写入得到 `busy`；有后续依赖时不单独还原；三百万字的性能要求（打开 2 秒、读一个条目 20 毫秒、最新一章发布 100 毫秒、第 1 章发布 1 秒）；id 由程序生成不复用（11-02）。

上面没列的都是作者自己的写法，你可以按维度 8 质疑。质疑到开发者已确认的决定时，照样写，但标明“质疑已确认的决定”。

## 重点

1. **五份之间的一致性**：交叉引用的输出编号是否指对了；失败码、诊断名与术语在几份里是否一致；同一件事有没有在两份里写成两种合同。
2. **计算的确定性与先后**：计划进展由“生效且套上了的兑现”推出，而按计划模式又要用计划进展；拆出计划的组、核对点的挂靠与比较位置、语义档以核对点为新起点、不完整的传播与截止——这些之间有没有循环依赖、歧义或照字面写不出来的地方（`model.md` 输出 5 到 13）。
3. **修订**：按对象判冲突加 `reads` 的值核对，能不能防住丢失更新；就地改的路由是否覆盖所有来历形状（列表元素与子键、语义档、不完整、未知、前史、实例字段）；还原依赖的三条来源与“只加元素的列表互不依赖、补偿只移除本次加的”会不会留下悬空引用；“预览与发布算出的带来的变化逐字相同”能否成立（`revisions.md` 输出 5 到 12、场景 4）。
4. **带值写法与回写**：装饰的识别会不会和作者正文里的括注撞；注记与源文表达式“按顺序一一对应”在文字同时被改时是否可判定；JSON 边界扫描与 `->` 的词法扫描；不完整、未知、不可用三种情况在回写时的处理是否完整（`rendering.md` 输出 8 到 13）。
5. **日志与进程**：写一半的识别（没有换行结尾、解析不了）与“别处的坏行”怎么区分；分段边界；fsync 失败后截回；两个进程的锁加长度核对（别的进程刚开新段时怎样）；独占令牌的寿命与断开；补归纳与发布、读取的竞态；速度要求的口径能否被测（`project.md` 输出 2 到 15）。
6. **写法**：是否符合 `docs/specs/README.md`：planned 只写黑盒、不写实现做法；每条输出能写成测试；九节齐全；不适用写“无”。

## 审查维度

1. **与已定设计一致**：提案、ADR 与开发者的决定逐条覆盖，没有悄悄改变已定项。
2. **依赖的机制真的存在**：Spec 依赖现有机制（项目实例、远程服务、跨进程锁、控制目录、贡献点）的顺序、时序或寿命保证时，读该机制的 Spec 或实现确认（`docs/specs/runtime/projects.md`、`runtime/plugin-channel.md`、`workspace/files.md`、`agent/contributions.md`，锁在 `packages/neuro-book/src/backend/locked-replace.ts`），不按名字推断。
3. **接口与合同**：类型与语义一致；失败有通道；后续实现照字面做会不会返工。
4. **遗漏**：失败路径、并发与跨进程、资源释放、兼容与迁移。
5. **对照需求与参照**：对照提案与原型（`engine.ts`），列出参照有、Spec 没有的项。
6. **验收映射**：每条判据能用真实运行时写成测试。
7. **别扭与反常之处**：和普遍做法（事件溯源、只追加日志、同类编辑器）不一样、要绕一下才说得通的地方；逐处判断是有理由的取舍还是能优化，给出改法。
8. **上游选择**：方案在迁就的更底层选择（已接受的 ADR、提案）当初的理由现在还成不成立；不成立的列为问题并给出代价。
9. **待确认项**：无单列；对上面“六条假设”逐条给一句判断。

## 规则

- 只读：不修改任何仓库文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t27-kernel-spec/reports/design-review/tmp/`。
- 不 `bun install`；需要跑脚本时用主工作区或 t16 草稿 worktree 已有的 node_modules。不跑开发服务与 e2e。
- **不开子审查、不派子代理**：自己按顺序读，读完一份就写这一份的发现。
- **每核实一条就追加写入报告文件，不要等到最后**；报告文件只追加，不整份重写、不覆盖已写的条目。运行可能到时间上限被直接截停。
- 有数字就给数字；问题是真的就直说。
- 用中文写。

## 报告

报告文件：`/home/notnotype/CodeRepository/neuro-book/.local/agent/works/w00039-novel-writing-plugins/tasks/t27-kernel-spec/reports/design-review/report.txt`（只追加）。

按影响排序写不了时按发现顺序写，最后补一个按影响排序的编号列表。每条发现用 `### N. 标题` 开头，写：

- **严重程度**：阻断 / 重要 / 建议；**类别**：正确性 / 不变量 / 一致性 / 遗漏 / 写法；
- **位置**：文件与输出、场景或失败码的编号；
- **现象**、**为什么是问题**、**如何核实**、**建议改法**。

撤回或收窄的条目，在原标题后追加“（撤回）”或“（收窄，见第 N 条）”。最后写“未发现问题的方面”、对六条假设的判断、各级数量，以及有效发现的编号列表。
