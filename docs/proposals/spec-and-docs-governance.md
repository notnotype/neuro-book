---
schema: nbook.proposal/v1
status: accepted
created: 2026-10-07
decided: 2026-10-07
supersedes: []
superseded-by: null
specs:
  - docs/specs/storage/persistence.md
  - docs/specs/storage/boundaries.md
  - docs/specs/runtime/services.md
  - docs/specs/runtime/application.md
  - docs/specs/runtime/glossary.md
adrs: []
---

# 规格驱动开发：文档分工与 Spec 写法

起因：开发者在 w00017 K4 交付后指出，现有 Spec“有些重要的地方没有写明写清楚，也有些不重要的地方也写进来了”，要求把计划、提案、Spec 与其它文档放在一起考虑，并明确项目的开发方式。本稿的 frontmatter 是第 5 节提议的提案格式，先在这里试用。

## 问题

### Spec

1. **实现细节与历程挤占了合同。** `docs/specs/runtime/` 下已实现或已在实现的 Spec 每份 1–2.4 万字。`plugins.md` 2.36 万字，其中“实现合同”6200 字、“证据”3400 字、11 处“随 tNN”；`plugin-channel.md` 2 万字、16 处 Task 引用，“证据”4100 字，实际是一份代码符号清单。`services.md` 的实现合同写到门面 Proxy 怎样处理 `then`、缓存键由哪几项组成、诊断原因叫什么：换一种实现就要改，却不是调用方能依赖的东西。
2. **调用方依赖的交互规则没写，或写错了地方。** K4 中，按调用方门面的工厂运行时，内核还没把调用方身份登记为“已签发”，代理在工厂里立刻委托会被拒；这条不在任何 Spec 里，是撞上才知道的。K3 中，内核在 `createApplication` 的同步段就开始启动激活；撞上之后回写进了 `application.md` 的“实现合同”，不在描述行为的章节。
3. **同一个决定写在好几处正文里。** K4 的 S0 改了 12 份文档，其中两份已 `accepted` 提案的正文也要跟着改，计划里又复述一遍 Spec 的行为。改得越多，越容易前后不一致。
4. **规则本身有缺口与矛盾：**
   - 已实现的 Spec 怎么加新的待实现行为没讲。README 禁止“部分实现”、要求按能力拆分；实际做法是在已实现的 Spec 里给新条目标“（随 t55）”（`services.md`、`plugins.md`）。
   - 条目编号的稳定性没有规定。测试名引用“输出 10”“场景 19”，中间插一条，编号与测试名就对不上。
   - “已实现、待批准晋升”的中间状态没有写法，结果是注册表“说明”列里的大段实施历程（例如 `projects` 那一行）和证据里的“实现进展”段落。
   - README 的 Bug 流程与末尾的完成条件仍引用已取消的 Reviewer 角色，与 [P-005](p-005-development-workflow-governance.md) 冲突。
   - 跨两份 Spec 的交互合同该写在哪份没讲。
   - 同一个术语（调用方身份、代次、收口）在多份 Spec 里各定义一遍；规范定义了 `kind: glossary`，却一份都没有。
   - `architecture` 与 `behavior` 两种 Spec 的分工不清：`storage/boundaries.md` 与 `persistence.md` 大量重叠，K4 两份都得改。
5. **固定章节里有两节常常空转。** “验收与 Smoke”多半把“输出”逐条再说一遍（K4 的 `persistence.md` 8 个场景基本与输出 1–7 一一对应），改一条规则要改两处；“边界与兼容”重复 frontmatter 的 `owners` 与实现合同的依赖方向，已知限制又和“不承诺”重叠。
6. **写法与规则混在一起。** `docs/specs/README.md`（规则与注册表）、`AGENTS.md`（Agent 步骤）、`TEMPLATE.md`（模板）三处都在讲怎么写，互相重复；Agent 真正需要的写作步骤没有一个触发入口。

### 提案

1. **状态写法五花八门，机器读不出来。** 现有提案的状态有五种写法：`## 状态` 一节、`状态：accepted`、`- **状态**：accepted（…）`、带反引号的；ADR 则写 `- 状态：Accepted`。README 索引里的状态是手写的。已经出现不一致：`workbench-commands.md` 标 `draft`，正文却写着“2026-09-19 批准分批实施”。
2. **接受后变成路线图与活文档。** `multi-instance-runtime-topology.md` 含 K1–K6 切片与走查，16 行决策记录里混着“主 Agent（待开发者审批）按 omp 审查修订”这类过程记录；它与 `plugin-data-model.md` 在 2026-10-07 `accepted` 后又随 t54、t55 改了正文，于是和 Spec 一样成了“当前合同”。
3. **结构各写各的，篇幅大。** 多份提案在 350–570 行，问题、方案、走查、切片、待定项混在一起；README 的最小结构里没有“待定项”，各提案自己发明写法。
4. **什么时候算“完成沉淀”可以归档，没有说。** 多切片的提案因此一直留在活跃区，也一直被修改。
5. **与 ADR 重复。** 提案的决策记录与理由和 ADR 写的是同一件事（例如拓扑稿与 ADR 0024）。

### 机检

`scripts/ci/check-documentation.ts` 对 Spec 检查 frontmatter、九个固定标题、注册表登记与已实现 Spec 的三条证据标签；对 ADR 只检查文件名与标题编号一致；对提案只检查链接与锚点，不检查状态、结构与是否登记在索引里。问题 1 中的状态不一致因此没人发现。

## 目标与非目标

目标：

- 每类信息只有一处正文：行为在 Spec，取舍理由在提案与 ADR，实施经过在 Task，内部做法在代码与注释，写作方法在 skill。
- Spec 短到能快速读完、细到每句都能被测试或审查判定；跨模块的时序与寿命必须写出来。
- 一次行为变化只改一份 Spec 与必要的链接。
- 提案与 ADR 的状态能被机器读取与核对。
- 写明项目的开发方式。

非目标：不改 Work/Task 模型（P-005）、Spec 的成熟度与 capability 注册；不一次性重写全部存量文档；不引入可执行规格工具（Gherkin 一类）。

## 方案

### 1. 文档分工与寿命

| 文档 | 回答什么 | 寿命 |
|---|---|---|
| 提案 | 为什么做、有哪些备选、怎么取舍 | `accepted` 后正文冻结；之后的变化写进 Spec 或新的提案、ADR，原提案只在 frontmatter 记 `superseded-by` 或在决策记录追加一行 |
| ADR | 一个难以逆转的架构决定和它的理由 | 不改，只能被新的 ADR 取代 |
| Spec | 现在或下一次实现必须成立的行为 | 行为变化时原地改；唯一的当前合同 |
| 计划（`plan.md`） | 这一次怎么做：内部设计、切片、验收映射、验证 | 实施中随事实修订；Task 完成后留作历程 |
| Work、Task README 与证据 | 切片怎么推进、做到哪了、证据在哪 | 随工作推进，完成后冻结 |
| 代码注释、模块头、包 `AGENTS.md` | 代码里看不出来的原因与约束、目录约定 | 随代码改 |
| 测试 | Spec 条目与场景的可执行版本 | 随 Spec 改 |
| Skill | 怎么写、怎么审、怎么做 | 随方法改进 |

同一件事只在一处写正文，其它地方链接。计划的验收映射写 Spec 编号，不复述内容；计划里的内部设计在完成后仍需要知道的，进代码注释或模块头，不回写 Spec。

### 2. Spec 写什么、不写什么

**必须写**：对外可观察的行为（输入、输出、状态与转换、失败码与恢复）；**交互合同**（调用方能依赖的先后与寿命：什么时候可用、什么时候作废、谁先谁后、断线或重启后会怎样），写在“状态与转换”，跨两个能力的写在提供方的 Spec；对外的格式与兼容（只写兼容所需的部分，例如“库格式版本 1，不认识的版本不改写”，不写表结构）；编号的条目与场景。

**不写**：实现做法（去代码与注释）、取舍理由与备选（去提案与 ADR）、历程（去 Task 与 git）、证据叙述（证据只留固定几行）。

**两条判据**：换一种实现、行为不变，这句话要不要改？要改，就不属于 Spec。这句话能写成测试或审查判据吗？不能，就删掉或改写到能。

### 3. Spec 规则的修订

1. **编号稳定**：输出条目、失败码与验收场景都编号，只在末尾追加，删除时保留空号；测试名引用编号。
2. **已实现的 Spec 加新行为**：整块新能力另起一份 Spec；在已有能力上加几条行为时，新条目末尾标“（planned）”，实现并验证后去掉，不写 Task 编号。
3. **已实现、待晋升**：`planned` 的 Spec 实现后照常写三条证据标签；注册表“说明”列只写一句范围，加“待晋升”，不写实施历程。
4. **两节的内容收窄**：“验收与 Smoke”只写跨多条规则的组合场景与特殊环境（多进程、多窗口、重启、真实浏览器），单条规则由“输出”条目本身验收，最后一行写 Smoke 入口；“边界与兼容”只写公开接口、版本与兼容、信任边界，已知限制移到“目标与非目标”。九个固定标题保留，不适用的写一行“无”。
5. **实现合同收成短节**：公开入口（包入口与公开符号）、owner 与依赖方向、不超过五条维护者必须知道且有测试锁定的内部不变量。
6. **术语表**：建 `docs/specs/runtime/glossary.md`（`kind: glossary`），收运行时的共用术语；各 Spec 只定义自己新引入的词。
7. **architecture 只写跨能力的归属规则**：与某一个 behavior Spec 重叠的内容并入那份 Spec；`storage/boundaries.md` 按此收窄。
8. **去掉 Reviewer 角色**：Bug 流程中“必须经 Reviewer 复核”改为“请开发者确认”，完成条件改为可机检与需人工核对的两组检查项。

### 4. 写法交给 skill

- **`writing-specs`**（新的项目 skill）：怎么定位能力、先列假设、写合同、编号、实现后补证据；含模板。取代 `docs/specs/TEMPLATE.md` 与 `docs/specs/AGENTS.md` 里的写作步骤：`TEMPLATE.md` 删除，`docs/specs/AGENTS.md` 只留一句指向 skill 与 README。
- **`reviewing`**（新的项目 skill）：设计与实现的审查；默认请另一个模型独立审查，可交叉审查。
- `docs/specs/README.md` 只保留规则、成熟度、机检项与注册表。

### 5. 提案的修订

1. **frontmatter**：

   ```yaml
   ---
   schema: nbook.proposal/v1
   status: draft            # draft | reviewing | accepted | rejected | superseded
   created: 2026-10-07
   decided: null            # accepted、rejected 时的日期
   supersedes: []           # 被本稿取代的提案
   superseded-by: null
   specs: []                # 本稿接受后改动或新建的 Spec
   adrs: []                 # 本稿产生的 ADR
   ---
   ```

   正文不再写“状态”一节。ADR 用同样的方式写 `status` 与 `decided`。
2. **结构**：问题、目标与非目标、当前行为与证据、方案（含备选与取舍）、影响、对 Spec 的预期改动、**待定项**、决策记录。走查、切片与推进不进提案：切片写在 Work README，推进写在 Task。
3. **决策记录只记开发者的决定**：Agent 按审查意见所做的修订记在 Task 证据，不进决策记录。
4. **接受即冻结**：接受时把关键的长期决定写成 ADR、把行为写进 Spec；提案正文此后不改。行为与长期决定都已落到 Spec 与 ADR 后，提案移入 `docs/archived/`。
5. **索引**：`docs/proposals/README.md` 的活跃清单只写标题与一句话，状态以 frontmatter 为准。

### 6. 机检

`docs:check` 增加：

- 提案与 ADR 的 frontmatter：`status` 取值、`accepted` 与 `rejected` 必须有 `decided`、`superseded` 必须有 `superseded-by`；
- `draft`、`reviewing`、`accepted` 的提案登记在索引里，`rejected`、`superseded` 的不在活跃目录；
- Spec 正文（“证据”一节除外）出现 Task 引用（`tNN`、`wNNNNN`）时给出警告；“证据”一节出现固定标签与批准依据之外的行时给出警告。

### 7. 开发方式：规格驱动、验收先行

1. **探明**：拿不准的技术点先做小实验实测，结论进 Task 证据，不进 Spec。
2. **决定**：有长期取舍时写提案，开发者接受后冻结。
3. **写合同**：按 `writing-specs` 更新 `planned` Spec。
4. **计划**：`plan.md` 写内部设计、切片与验收映射（Spec 编号 → 测试）。
5. **验收先行**：每片先写这片对应条目的合同测试并看它失败，再实现到通过；交付前做变异检查。
6. **审查**：按 `reviewing` 审查设计与实现。
7. **收口**：按固定标签写证据；全部有证据后，经开发者批准晋升 `implemented`。

单元层面不要求严格的 TDD；测试覆盖 Spec 条目与失败方式（现有测试规范）。界面类改动另由 Component Lab 场景验收。

### 备选方案与取舍

- **维持现状，只补几条规则**：现有规则已写了“黑盒”，实践仍然漂移；没有“不写什么”的判据与文档寿命，漂移会继续。
- **可执行规格（Gherkin 一类）**：把规格绑在工具上，中文写起来别扭；测试按编号命名已经能对上。不采用。
- **只把测试当规格**：代码出现之前没有可读的合同。不采用。
- **提案作为持续维护的活文档**：等于两份当前合同。不采用。
- **合并章节、减少固定标题**：能省几行“无”，但要改 `docs:check` 与全部存量 Spec。不采用，改为收窄两节的内容。

## 示例

`storage/persistence.md` 已按第 2、3 节试做一遍（216 行、1.32 万字 → 183 行、0.95 万字）：去掉开头的改写说明、旧机制取舍表、表结构与事务写法、模块文件清单；新增“时序与寿命”一组交互合同；证据改为三条固定标签。写交互合同时发现“断线重连后订阅重建、先收到当时的快照”这条没有专门的测试，已列入 K4 的修正。

接受后按同样方式清理了 `runtime/services.md`（179 行、1.34 万字 → 175 行、1.08 万字）：实现合同收成公开入口、依赖方向与五条内部不变量，证据只留固定标签与批准依据，“状态与转换”补上 K4 的交互合同；`runtime/application.md` 把 K3 那条移到“状态与转换”；`storage/boundaries.md` 收窄为跨能力的归属规则（141 行 → 98 行）。

## 数据、接口、安全、迁移、发布与回滚影响

只改文档、skill 与文档检查脚本；不影响产品代码、数据与发布。存量提案与 ADR 已按第 5 节补 frontmatter（2026-10-07）；存量 Spec 改到哪份清理哪份。回滚：撤回对应提交。

## 对 Spec 与治理文档的预期改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/README.md` | 第 1–3 节的规则；去掉写作步骤与 Reviewer；注册表“说明”列只写范围 |
| `docs/specs/AGENTS.md` | 只留指向 `writing-specs` 与 README 的一句 |
| `docs/specs/TEMPLATE.md` | 删除（模板在 `writing-specs`） |
| `docs/specs/runtime/glossary.md` | 新建 |
| `docs/proposals/README.md` | 第 5 节；最小结构加“待定项”；索引只写标题与一句话 |
| `docs/adr/README.md` | ADR 的 frontmatter |
| 存量提案与 ADR | 补 frontmatter；`workbench-commands.md` 的状态按事实修正 |
| `.agents/skills/` | 新增 `writing-specs`、`reviewing`；`implementation-planning` 的验收映射写 Spec 编号、不复述 Spec |
| `docs/testing/README.md` | “测试写法”链接第 7 节，不重复 |
| `scripts/ci/check-documentation.ts` | 第 6 节；必需文件去掉 `TEMPLATE.md` |
| 存量 Spec | 先做 `storage/persistence.md`（已试做）与 `runtime/services.md`；补 K4 的交互合同，把 K3 那条从 `application.md` 的实现合同移到“状态与转换” |

## 待定项

1. 第 3 节第 2 条：在已实现的 Spec 里用条目级“（planned）”标记（推荐），还是一律另起 Spec。
2. 第 3 节第 7 条：`storage/boundaries.md` 收窄（推荐），还是整份并入 `persistence.md`。
3. 存量 Spec：改到哪份清理哪份（推荐），还是一次性清理。
4. 冻结范围：全部 `accepted` 提案冻结正文（推荐），还是推进中的大提案（如拓扑稿）例外。
5. 第 6 节的机检：全部采用（推荐），还是先只加提案 frontmatter 的校验。

## 决策记录

| 日期 | 决策者 | 结论 |
|---|---|---|
| 2026-10-07 | 开发者 | 同意“规格驱动、验收先行”的方向，要求写提案 |
| 2026-10-07 | 开发者 | 要求把 Spec 规范的缺口、提案的结构问题与机检并入本稿；写作方法交给 skill，考虑删除 `TEMPLATE.md` |
| 2026-10-07 | 开发者 | 接受，五个待定项按推荐 |
