# 提取模板过程中对开发体系的反思

按层记录。每条写：看到了什么（带证据）、模板怎么处理（“模板：”）、建议 NeuroBook 怎么改（“建议：”）。建议只是候选，改不改由开发者定；要做的另建 Task。证据里的提交数、行数、文件大小都是 2026-11-12 在 master 上查的。

## 第 1 层（2026-11-12）

### 1. 同一条规则在多处写正文

“`git diff --cached --check` 单独一步”同时写在根 `AGENTS.md` 的“发命令前”、`docs/testing/README.md` 的验证门禁、`docs/standards/repository-workflow.md`，另外在用户级规则和 Agent 记忆里各有一份。`.omp/RULES.md` 的 e2e 一条与根 `AGENTS.md` 的测试一节几乎逐字相同。

自己的规则说“每项规则只维护一个真相源”，但“发命令前”这种摘要是有意的（常在发命令时忘）。问题在于摘要没有标明是摘要，改正文时没人记得改摘要。

- 模板：保留“发命令前”，开头写明“正文在哪、为什么摘到这里”；不带 `.omp/RULES.md`。
- 建议：`.omp/RULES.md` 只留 omp 特有的内容，其余改成指向根 `AGENTS.md` 的一行。

### 2. 事故经验堆进规则正文

`docs/testing/README.md` 33 KB，“测试写法”一节约 25 段，其中 7 处带 Work 编号的事故（例如 Monaco 的不换行空格、指针捕获、happy-dom 丢 `@layer`）。这些是某个包、某个工具的已知坑，不是测试写法；读“测试写法”的人每次都要读完它们。

- 模板：只留跨项目成立的写法；在“规则怎么改”里定下“规则 + 一句理由，事故经过留在 Task”。
- 建议：把 e2e 与 DOM 测试的已知坑移到应用包自己的测试说明（例如 `packages/neuro-book/docs/testing-pitfalls.md`），`docs/testing/README.md` 只链接过去。

### 3. 生效日期与迁移说明混在规则里

`.agents/works/README.md` 里有“本节 2026-10-12 起生效”“2026-10-12 以前建的记录没有这个字段”“Task 不保存 `role`、`actionIssueId`、`agentWorkflow`…”；`.agents/` 下还有 legacy Task archive、`nbook.task/v2`、`governance-context/v2` 这些版本号。读规则的人要先分清哪句是现行规则、哪句是迁移期的说明。

- 模板：全部去掉。
- 建议：迁移完成的条目（字段已补齐、旧记录已迁走）删掉日期与过渡说明，留在 git 历史里。

### 4. 治理术语中英混用

`current`、`legacy`、`provenance`、`owner`、`fail-closed`、`Draft-Key`、`capability` 等直接夹在中文里，而 `docs/standards/code/common.md` 自己要求“用平常的中文”。

- 模板：换成“当前”“历史记录”“出处”“负责的模块”；`capability` 只留在 frontmatter 键名里。
- 建议：顺手整理时替换，不单独开工作。

### 5. 每个目录一对 README 与 AGENTS.md

`.agents/AGENTS.md`、`docs/AGENTS.md`、`docs/specs/AGENTS.md`（3 行，只指向 Skill）、`.agents/works/AGENTS.md`（大半复述 README）。分工是“README 写规则、AGENTS.md 写 Agent 的加载动作”，但实际的加载动作已经在根 `AGENTS.md` 的触发表里，下级 AGENTS.md 多是重复。

- 模板：只有根 `AGENTS.md`，触发表直接指向各 README。
- 待确认：下级 AGENTS.md 是否为了某个宿主自动加载（Codex 按目录逐级读 AGENTS.md）？是的话保留但只写一行指针；不是的话可以删。没有找到记录这个分工理由的文档。

### 6. 路由表被一次性路径占用

`docs/standards/code/README.md` 的编码规范路由表里有 4 行指向 w00005 某个 Task 下的实验脚本与 JSON。路由表是长期合同，一次性目录的规范跟着它的 Task 走即可。

- 模板：路由表下方写明“只写长期存在的路径”。
- 建议：删掉这 4 行，在 w00005 对应 Task 的 README 里写一句沿用哪套规范。

### 7. 文档与实际做法不一致：合入要不要请示

`docs/standards/repository-workflow.md` 写“合入 master 的时机由开发者决定”，而开发者 2026-10-20 已定“验证、审查处理完就直接合入”，这条只记在 Agent 记忆里。别的 Agent 或人读文档会照旧请示。

- 模板：合入是否请示留成占位，由项目定。
- 建议：把 10-20 的决定写进 `repository-workflow.md` 的合入一节。

### 8. Issue 与 Project 状态流程基本闲置

44 个 Work 里只有 9 个有 `issueId`，都是早期的；`.agents/issues/drafts/` 是空的。`repository-workflow.md` 仍有完整的 `status:*` 标签、Project 五态与“统一评审”流程，`PROJECT-STATUS.md` 也写“具体 TODO 以 GitHub Issue 为准”，实际待办在 Task 与 followups 里。

- 模板：不带 Issue 与 Project 流程，待办写成 Task。
- 建议：要么把这套流程移到“对外贡献”的文档（只在接受外部贡献时用），要么改写 `PROJECT-STATUS.md` 的说法与实际一致。

### 9. 通用流程文档里放着单次事故的处置程序

`repository-workflow.md` 的“敏感本地历史与生成物”一节是一次具体事故的处置步骤（CAS、reflog、gc 的顺序），对读这份文档的大多数任务无关。

- 模板：不带。
- 建议：移到 `docs/standards/runbooks/`（或对应 Task 的 walkthrough），流程文档留一行“遇到本地历史含敏感内容时读某文件”。

### 10. 包清单写了三份

根 `AGENTS.md` 的仓库结构、`packages/AGENTS.md` 的成员列表、根 `package.json` 的 `workspaces` 各列了一遍包，前两份还带着 Work 编号，新建包时要改三处。

- 模板：仓库结构只写职责与数据边界的地图，写明“不是完整清单”。
- 建议：`packages/AGENTS.md` 删掉成员列表，改为“以 `package.json` 的 `workspaces` 为准”。

### 11. 编号规则依赖 nbdev，手工做法藏在第二步

领号规则的主体是 `nbdev work new`，手工做法是“仍不可用才”。对没有 nbdev 的项目，规则的核心其实只有“取各处最大值加一、领号即提交”。

- 模板：把这条核心写成规则，附一行可直接运行的 git 命令；nbdev 放到第 4 层，作为并发会话多了以后的自动化。
- 对 NeuroBook：不用改。只是说明 nbdev 解决的是并发领号与面板，不是编号规则本身。

### 带过来时觉得值得保留、但想请你确认的

- **Spec 九节固定标题**：利于机器提取与审查，但对小能力偏重。模板保留了；小项目是否允许 `kind: behavior-lite`（只要目标、输出、失败、验收四节）？
- **记录只放主工作区**：解决了跨分支看不到进展与合入冲突，代价是 worktree 里的会话要跨目录写记录。模板保留了。

## 第 2 层（2026-11-12）

### 12. Skill 是回写最频繁的地方，正在变成事故集

10 月以来 `.agents/skills/` 有 67 次提交，大多是“回写 w00039 t34 的三条”这类。`reviewing` 204 行，正文里夹着 t26、w00031、w00039 t02、t34、t35 等案例；`implementation-planning` 的“写法”一节后半是性能预算、依赖摘要、关卡这几次具体事故提炼出的条目。条目本身多数有价值，但案例叙述让每次加载 Skill 都要读一遍历史。用户级 `task-reflection` 自己已经规定“具体案例写进 `references/lessons.md`”，仓库内的 Skill 没照做。

- 模板：规则留在 Skill，案例去掉，只在 Skill 索引里写下“规则 + 一句理由、案例进 lessons”。
- 建议：`reviewing` 与 `implementation-planning` 各拆出 `references/lessons.md`，正文每条只留判据与一句理由。预计 `reviewing` 能缩到 150 行左右。

### 13. 审查分派写了四处

“谁审什么”同时在 `reviewing` 的“派给谁”、`autonomous-delivery` 的“审查分工”、用户级 `~/.claude/CLAUDE.md` 的子代理调度表，以及 Agent 记忆 `review-routing-by-object` 里。四处措辞不完全一样，换模型时要改四处。

- 模板：只在 `reviewing` 的“派给谁”，留占位并要求写明谁在哪天定的；`autonomous-delivery` 只链接。
- 建议：NeuroBook 以 `reviewing` 为准；用户级 CLAUDE.md 只留与仓库无关的部分（例如 Haiku 的派发依据），审查分派改成“仓库有 `reviewing` 时以它为准”（这句其实已经写了，可以把表里的审查行删掉）；记忆那条删掉或改成指针。

### 14. 宿主怪癖写进了通用方法

`reviewing` 里的“报告写成 `.txt`（子代理不能写 `.md`）”、`autonomous-delivery` 里的 omp 续跑与额度处理、`diagnosing-bugs` 把 `.omp/RULES.md` 当秘密规则的来源。这些只对某个宿主成立，换宿主就是噪声，而它们在用户级规则里已有一份。

- 模板：只留与宿主无关的原则（报告逐条追加、不开子审查、截停后能恢复），具体工具的做法留给用户级规则。
- 建议：NeuroBook 的 Skill 删掉 omp 与 Claude Code 的操作细节，链接用户级规则；`diagnosing-bugs` 的秘密规则改指根 `AGENTS.md`。

### 15. 同一条流程写了两遍

`docs/README.md` 的“生命周期与维护”和 `docs/specs/README.md` 的“开发方式：规格驱动、验收先行”都描述“提案 → Spec → Task → 证据 → 晋升”，前者 5 步、后者 7 步，粒度不同、措辞不同。

- 模板：只在 `docs/README.md` 写一份 7 步流程，各步链接对应的 Skill。
- 建议：NeuroBook 保留 `specs/README.md` 那份（更完整），`docs/README.md` 改成一句加链接。

### 16. doc-review 写得太空

18 行，主体是“不按文件数拆任务或强制模型等级”“不重复等待批准”这类反驳旧规则的句子，没有说要查什么。

- 模板：改成先定目标读者，再按五项检查（名词解释、矛盾、例子、链接、能否照字面执行）。
- 建议：照模板的写法补上检查项。

### 第 2 层的待确认项（已定）

- 开发者 2026-11-12 定：`task-reflection` 与 `autonomous-delivery` 都放进模板。模板里的 `task-reflection` 是项目级的一份，回写位置表以它为准，根 `AGENTS.md` 只留触发条件与链接。

## 实际使用（2026-11-12）

模板复制到 Windows 开发机 的 `D:\CodeRepository\manus` 后，那里的 Agent（Manus Studio）做 MCP 终端调研时没有建任何 Work，调研笔记写进了宿主自带的 `.work/mcp-terminal-research/`，题目抄进了 `.local/manus/README.md`。

### 17. 没有“动手前先建 Work”这条硬规则

模板（以及 NeuroBook）只写了 Work 与 Task 长什么样、“一个 Work 至少有一个 Task”，没写什么时候必须建。NeuroBook 根 `AGENTS.md` 的触发表是“创建、推进或恢复 current 工作 → 读 works 规则；只读问答不新建 Work”，同样是“要建时读什么”，不是“必须建”。我在 NeuroBook 能照做，靠的是 nbdev 与自己的记忆；换一个没有这些的宿主，Agent 就沿用宿主的默认目录。同时还暴露出三处缺口：

- 宿主自带的工作目录（`.work/`、`outputs/`）算不算记录，没有写；
- 调研笔记放哪没有写：NeuroBook 有 7 个 Work 在 Work 层用了 `research/`，`.agents/works/README.md` 没有登记这个约定；
- 模板的领号命令只有 bash 写法，Windows 的 PowerShell 跑不了。

- 模板：根 `AGENTS.md` 的核心规则加“除只读问答外，动手前先找到或新建 Work 与 Task；调研、过程产物与证据写进 Task 或 Work 目录，不写进宿主自带的工作目录；宿主约定与本仓库冲突时以本仓库为准”；`.agents/works/README.md` 加 Work 层 `research/` 与“宿主工作目录不是记录”；领号补 PowerShell 写法（在 Windows 开发机 的临时仓库实测，能取到只在另一条分支上的编号）。
- 建议：NeuroBook 根 `AGENTS.md` 的核心规则补同样一条；`.agents/works/README.md` 的目录树补 `research/`。

### 18. 没有写提案的 Skill，流程顺序与实际做法不符

开发者的习惯是 proposal → spec → task → plan。NeuroBook 有写 Spec、写计划、审查的 Skill，没有写提案的：何时要提案、八节结构与生效规则在 `docs/proposals/README.md`，但“写之前调研什么、怎么和开发者定方向、审查意见怎么分类处理、接受后做什么”只存在于实际的 Task 里（w00043 t01：调研三份笔记放 Work 的 `research/`，提案审了两轮，审查意见分 A 照改、B 下放 Spec、C 交开发者、D 不改四类，三稿后交开发者）。

同时，`docs/README.md` 的“生命周期与维护”与 `docs/proposals/README.md` 都写“提案 accepted 后创建 Work 与 Task”，而实际上提案本身就在一个方向 Task 里写（w00043 t01-direction）。按字面，写提案这段工作没有 Task 可挂，调研与审查报告无处可记。

- 模板：新增 `writing-proposals`（方向 Task → 调研 → 讨论方向 → 写提案 → 设计审查与四类处理 → 开发者接受 → ADR 与 planned Spec → 实现 Task），把 w00043 t01 的做法写成步骤；`docs/README.md` 的流程改成“方向 Task：调研 → 讨论 → 提案 → 审查 → 接受 → planned Spec → 实现 Task → plan”，`docs/proposals/README.md` 写明提案在方向 Task 下写、接受后建的是实现 Task。
- 建议：NeuroBook 补同样的 Skill，并改正流程描述：`docs/README.md` 第 12 行与第 52 行、`docs/proposals/README.md` 第 107 行写的是接受后“创建或复用 Work 与 Task”；`docs/specs/README.md` 第 312 行写的是“创建 Work 与实现 Task”，与实际一致，不用改。可以并入 [t02](../t02-template-as-upstream/README.md)：模板成为上游后直接取用。

## 规范拆进模板（2026-11-12）

开发者要求把项目规范去 NeuroBook 化拆进模板，点名 UI 规范里沉淀的经验。拆的是 `packages/nb-ui/docs/` 的设计语言（1140 行）与开发规范、`docs/standards/code/` 的前端、组件、语言、脚本、合同、数据格式规范、`docs/standards/prompts.md`，以及 `docs/testing/README.md` 里与浏览器有关的部分。

### 19. 通用判据与 nbook 的取值、历史写在同一段里

设计语言的每一节都同时装着三样东西：可以搬到任何项目的判据（材质只有一层、阴影三档、对话框不是三段式盒子），nbook 主题的取值与配方（圆角 10、`nbook-lens` 30 与 14），以及开发者某天看过之后的决定（“2026-10-12 看过平铺后选回卡片”“2026-11-05 定”）。踩过的坑也一样：64 条里约 50 条是浏览器与常见库的通用行为，夹着 `lab:shot`、`check:dist`、Lab 路径与 Work 编号。拆的时候几乎每段都要改写，不能整段搬。

这对 NeuroBook 自己也是成本：读者要判断“这一句是规则还是当时的取值”，而取值本来已经在 `vars.css` 里，按文件头的说法本文“不抄取值”。

- 模板：拆成 `docs/standards/ui/` 下六份（README、design-language、engineering、components、frontend、pitfalls），只留判据与理由；变量名作为推荐的角色名，README 留一张“角色名对照”给项目登记真实名字；坑重新编号为 1 到 64，按“CSS 与渲染”“DOM 与组件”“探针与验收”分组，框架与库专属的单独成节（原子 CSS、无头组件库、Vue）。
- 建议：NeuroBook 的设计语言把“开发者某天定的取值”挪到主题自己的说明或决策记录里，正文只留判据；坑节可以直接从模板的 pitfalls 回取通用部分，本仓库只追加 nb-ui 专属的条目。并入 [t02](../t02-template-as-upstream/README.md) 一起考虑。

### 20. 界面规则分在四处，入口靠 Skill 一张表

视觉判据在 `packages/nb-ui/docs/design-language.md`，工程合同在 `packages/nb-ui/docs/ui-development-spec.md`，组件连接在 `docs/standards/code/components.md`，前端工程在 `docs/standards/code/frontend.md`，UI 验收分档在 `docs/testing/README.md`。`frontend.md` 自己写着“这两份规范此前只从 nb-ui 内部路由得到，主应用侧改样式的人找不到，材料语言因此被逐页重新发明过”：靠在 frontend.md 补一句指针修过一次。

- 模板：界面规范收在 `docs/standards/ui/` 一个目录，`code.md` 的路由表按前端源码路径指过去，`ui-development` Skill 只做“先读哪份”的表与交付前检查。
- 建议：NeuroBook 不必搬家（nb-ui 的文档跟着包走有道理），但可以在 `docs/standards/` 放一个界面规范的入口页，列这五处各写什么；比让每个读者从 Skill 的表里拼起来稳。

### 21. 规范里留着进度与过期的说法

- `docs/standards/code/frontend.md` 的“存量迁移方向”是一张旧应用 localStorage 键的迁移表（`novel.ide.local` 等），属于迁移进度，而 `components.md` 的“边界”一节写着“任何一次重构的进度不属于本规范”。
- `components.md` 写“本仓库用 Nuxt 自动注册，没有引入步骤”：新应用不是 Nuxt（`packages/neuro-book` 下没有 `nuxt.config`），这句是旧应用时期留下的。
- `docs/standards/code/README.md` 的路由表里有 4 行是 w00005 实验目录下的具体文件，而这类一次性目录照模板的规则应跟着 Task 的说明走，不进路由表。
- `docs/testing/README.md` 的“通用包测试合同（2026-09-11）”保留着“2026-09-22 修订：……原要求作废”的修订说明，读者要在脑子里把作废的部分划掉。

- 模板：没带这些；`code.md` 已写“表里只写长期存在的路径”。
- 建议：迁移表移进存储的 Spec 或对应 Task；删掉 Nuxt 那句；路由表去掉 w00005 的 4 行；通用包测试合同按现行规则改写，修订经过留给 Git 历史。都是小改，可以一个 Task 做完。

### 22. ui-development Skill 的语气与粒度和仓库其它 Skill 不一致

`ui-development` 用“唯一真相源”“100% 优先复用”“严禁”这类强调词，第 3 条检查是“对话框组件名不以 Dialog 结尾时在 `component-index-model.ts` 登记”这种工具细节，和其它 Skill“写步骤、判据与理由”的写法不一样；`description` 只说“指导……开发”，没写什么时候触发。

- 模板：重写成“先读什么、复用、交付前检查、回写”四节，`description` 写明触发条件与不触发的情况。
- 建议：NeuroBook 的 `ui-development` 照这个结构改写，Lab 登记这类工具细节放进 Lab 的 fixtures 说明。
