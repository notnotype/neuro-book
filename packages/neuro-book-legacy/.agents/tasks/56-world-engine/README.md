# World Engine (世界引擎)

> Active task directory format: `NN-kebab-case-name/`. Archived tasks move to `docs/tasks/archived/<task-slug>/`.

## Relative documents refs

- [schema-design.md](schema-design.md)：subject schema 字段格式与完整魔幻世界示例（草案）。
- [sqlite-and-api.md](sqlite-and-api.md)：Project SQLite 表结构与世界引擎 API 契约（草案）。
- [agent-tools.md](agent-tools.md)：世界引擎暴露给 Agent 的工具集设计（草案）。
- [worked-example.md](worked-example.md)：奇幻世界从模板创建到演化 1 tick 的完整实例（验证模型自洽）。
- [reference/content/simulation.md](../../../assets/reference/content/simulation.md)：当前 `simulation/` 目录规范（events.jsonl / memory.jsonl / subjects / entities / runs）。
- [reference/content/subjects.md](../../../assets/reference/content/subjects.md)：subject 六文件分工与 RAG 机制。
- [reference/plot/system.md](../../../assets/reference/plot/system.md)：当前 Plot 系统规范（作者视角剧情结构）。
- [docs/tasks/42-simulation-rollback-mechanism/README.md](../42-simulation-rollback-mechanism/README.md)：现有 simulation 回滚方案。
- [docs/tasks/43-subject-rag-memory/README.md](../43-subject-rag-memory/README.md)：subject 记忆 RAG。

## User Request / Topic

- 设计一个「世界引擎」来取代当前的 `plot + simulation(events.jsonl + memory.jsonl)` 组合。
- 第一版**不考虑无时间的情况**（不存在「有空间无时间」的设定）。允许倒叙、回忆等叙事手法，但底层世界时间是**连续、线性、单调前进**的。
- 核心概念：**时间线 timeline + 时间刻 / 切面（slice / entry）**。切面用于标注一个重要时间节点，记录该节点上各 subject 的状态变化。
- 架构要灵活：任意时刻的**世界状态**都可以由「该时刻之前的所有切面」reduce 计算得来。例如倒叙看 3 月，就 reduce 3 月前的所有切面，3→6 月的切面不参与。给某人物补设定 / 给大陆补历史 = 在合适时间点新增切面即可。
- subject：参与世界模拟的主体（不限于智慧生物，王国、大陆也可以是 subject），有自己的状态，状态随时间 / 切面演变。

## Goal

设计并落地一个以**单调线性时间轴**为骨架的世界引擎：以「时间线 + 切面」表达世界演化，切面记录各 subject 的状态变更，任意时刻世界状态可由时刻前切面 reduce 得到；逐步取代现有 plot + simulation 的运行态表达。

- Outcome：存在一套可比较、可 reduce 的时间 + 切面 + subject 数据模型；能回答「任意 instant 的世界状态是什么」。
- Verification surface：模型层单测（时间比较、reduce 截断、同 instant 冲突、`editSlice`、`deleteSlice`、E/A issues）；后续接入真实 simulation workflow。
- Constraints：第一版不破坏现有 plot / simulation 既有数据；时间真相源单一，显示层可换不影响已存数据。
- Boundaries：先做设计与核心模型，不急于改 Agent profile / 前端。
- Iteration policy：每轮讨论确定一块（时间 → 切面 → subject → reduce → 迁移），定论写回本文档。
- Blocked stop condition：遇到与现有 plot/simulation/agent 架构冲突且无法在不制造技术债的前提下解决时，停止并报告。

## Current State

- 当前 World Engine 已采用 `WorldSubject` / `WorldSlice` / `WorldPatch` 事件溯源模型；patch 不存旧值字段，后端不自动改写后续切面，任意时刻状态仍由切面序列 reduce 得到。
- 当前 Project 配置入口是 TypeScript 单文件：`world-engine/schema/index.ts`（Zod schema）和 `world-engine/calendar.ts`（项目 Calendar）。`schema.yaml` / `calendar.yaml` 是历史方案，不再作为当前配置入口。
- 当前 Agent 工具入口统一为 `execute_world`。CodeAct 沙箱只暴露分组 API：`world.time.*`、`world.subject.*`、`world.search.*`、`world.slice.*`；旧固定工具和旧平铺 `world.*` API 只保留在历史 walkthrough / migration 语境。
- 当前 timeline 查询按 slice 组织：`world.slice.get(sliceId)` 只接受 sliceId；按 subject 查相关切面使用 `world.slice.list({subjectIds, subjectMode, withPatches:true})`。返回明细字段使用 `patches` / `patchId` / `withPatches`。
- 当前 issue 契约以 [reference/world-engine/issues.md](../../../assets/reference/world-engine/issues.md) 和 [Task 76](../76-world-engine-issue-contract/README.md) 为准：后端返回 `label/severity/title/message/explanation`，Agent 和 UI 不再按 code 自行生成解释。
- Workbench / Preview 仍提供世界线调试、slice 写入编辑、subject filter、issue review、主体文件建议等 UI 能力；其历史实现流水里可能保留 `mutation` / `schema.yaml` 等旧名，以下记录仅作为当时实现背景，不代表当前 API 术语。

### Historical Implementation Notes

- 第四十四轮曾收紧旧 Preview 后续处理提交条件；当前最新路线已移除对应 UI。
- 第四十五轮已完成一次用户视角浏览器实跑：新建真实 Project、运行一键示例世界、写入后续 slice、编辑较早 slice；旧后续处理步骤已随新路线移除。
- 第四十六轮已优化 Preview Project 选择体验：顶部增加 Project 搜索，按 title / projectPath / summary 过滤，并保证当前选中 Project 不会被搜索词隐藏。
- 第四十七轮曾优化旧 Preview 后续处理结果反馈；当前最新路线已改为展示写入 / 编辑 / 删除返回的 `issues`。
- 第四十八轮曾修正旧 Preview 后续处理提示范围；当前最新路线已取消对应字段。
- 第四十九轮已在主 IDE Header 增加 World Engine 入口，可从当前 Project 直接打开 `/world-engine.preview?projectPath=<当前 Project>`。
- 第五十轮已把 Header 入口升级为主 IDE 内嵌 World Engine Workbench：可浏览当前 Project 的 subjects、timeline、schema，查询 selected subject 状态，一键创建示例世界；工作台右上角仍可打开独立 Preview 调试页。
- 第五十一轮已把正式 mutation 写入 / 编辑器迁入主 IDE Workbench：新增 `Edit` tab、Mutation Builder、schema 快捷填充、`writeSlice` 和 `editSlice` 整块替换入口。
- 第五十二轮已补齐 Workbench 创建 subject 入口，并为 Mutation Editor 增加 dirty guard，避免切换载入 slice 或 subject 时覆盖未保存草稿。
- 第五十三轮已为 Workbench Mutation Builder 增加 schema-aware value 控件：数字、布尔、enum、ref 属性会显示对应输入控件，减少直接手写 JSON。
- 第五十四轮已为 Workbench Mutation Builder 增加 attr path 输入：schema 下拉仍可快速选择已声明属性，同时可手写 `memory.师门` 这类开放 object key；开放 object key 会继承根 object 的 itemType 投影来驱动 value 控件。
- 第五十五轮曾为旧 Workbench 补齐后续处理顶部动作；当前最新路线已移除该入口。
- 第五十六轮已为 Workbench Selected Slice 增加“查询此时状态”：选中 timeline slice 后可直接查询当前 subject 在该 slice 时刻 reduce 后的状态。
- 第五十七轮已为 Workbench Selected Slice 增加“查询切面主体”：可一次查询该 slice mutations 触及的所有 subject 在该时刻 reduce 后的完整状态。
- 第五十八轮已为 Workbench Timeline 增加“当前 subject”过滤：可只显示 mutations 触及当前选中 subject 的 slice，并同步展示过滤后 / 总计的 slice 与 mutation 数。
- 第五十九轮已为 Workbench Selected Slice 增加触及主体快捷 chip：可从 slice 检查器直接切换当前 subject，并把 State Query 时间对齐到该 slice。
- 第六十轮已为 Workbench State Query 增加结构化摘要视图：查询结果会按 subject / attr 展示可扫读摘要，同时保留原始 JSON。
- 第六十一轮已把 State Query 摘要视图抽离为 `WorldEngineStateSummary` 子组件，降低主 Workbench 体量，为后续继续扩展留出空间。
- 第六十二轮已把 Selected Slice 检查器抽离为 `WorldEngineSliceInspector` 子组件，保留触及主体 chip、查询此时状态、查询切面主体、mutation 摘要与 JSON 预览，主 Workbench 体量降到 614 行。
- 第六十三轮已为 Workbench Timeline 增加搜索过滤，可按 slice id / time / title / summary / kind 和 mutation subject / attr / op / value 查找事件，并区分无数据、当前 subject 无结果、搜索无结果三种空状态。
- 第六十四轮已把 Timeline 列表、当前 subject 过滤、搜索过滤、计数和空状态抽离为 `WorldEngineTimeline` 子组件，主 Workbench 体量降到 581 行。
- 第六十五轮已为 Workbench Mutation Builder 增加 object value 的 key/value 行编辑器，可用表单生成对象 JSON，减少开放 object 属性手写 JSON 的成本；固定 fields 子表单仍留待 schema 投影补齐后再做。
- 第六十六轮已把 `getWorldSchema` 投影扩展到 `itemType` 与递归 `fields`，前端 `resolvePreviewAttrPath` 可直接用 fields 解析固定 object 子字段，也继续支持开放 object key。
- 第六十七轮已为 Workbench Mutation Builder 增加固定 object fields 子表单：字段 key 只读，value 按字段 schema 使用 number / boolean / enum / ref / text 控件，并继续保留开放 object 的自由 key/value 模式。
- 第六十八轮已修正固定 object fields 子表单的写入语义：字段默认不写入对象，只有勾选“启用字段”后才进入生成的 JSON，避免自动默认值误写 ref / number / bool 字段。
- 第六十九轮已把 Workbench Mutation Builder UI 抽离为 `WorldEngineMutationBuilder` 子组件，父编辑器继续负责 slice 保存、dirty guard、schema shortcuts 和 mutation JSON 校验，降低后续继续扩展 Builder 的维护风险。
- 第七十轮已为 Workbench Mutation Builder 增加“载入首条”入口，可把当前 mutations JSON 的首条 mutation 回填到 Builder 表单，降低编辑已有 slice 时的手写 JSON 成本。
- 第七十一轮已把 Builder 回填入口升级为“选择并载入”：可从当前 mutations JSON 中选择任意 `#N subject.attr op` 回填到 Builder，编辑多 mutation slice 时不再只能载入首条。
- 第七十二轮已为 Builder 增加“替换所选”，可将当前表单内容原位写回所选 mutation；原“替换”按钮改名为“替换全部”，避免逐条编辑与整组覆盖混淆。
- 第七十三轮已为 Builder 增加“删除所选”，可按当前选择删除某条 mutation；删除最后一条后会保留空数组并提示保存前需补 mutation，继续遵守后端拒绝空 mutations 的契约。
- 第七十四轮已为 Builder 增加“上移 / 下移所选 mutation”，移动后会同步选中索引，便于连续调整同一 slice 内 mutation 的 reduce 顺序。
- 第七十五轮已收紧 Builder 的 mutation 选择索引同步：追加后选中新追加项，替换全部 / schema shortcut / 新建模式后选中第 1 条，手写 JSON 导致列表变短时自动夹回有效索引。
- 第七十六轮已把 mutations JSON 校验前移到 Workbench Editor UI：非法 JSON 或空 mutations 会直接显示错误并禁用保存按钮，避免走到后端必然拒绝的提交。
- 第七十七轮已把 mutation 列表替换 / 删除 / 移动 / 索引夹取抽成 `world-engine-preview` 纯函数，并补行为测试覆盖多 mutation 编辑语义。
- 第七十八轮已把 Builder 顶部 mutation 列表选择 / 载入 / 上移 / 下移控制条抽成 `WorldEngineMutationListControls` 子组件，降低 Builder 复杂度。
- 第七十九轮已把 Builder 底部追加 / 替换所选 / 删除所选 / 替换全部动作区抽成 `WorldEngineMutationActionButtons` 子组件，继续降低 Builder UI 体量且不改变事件契约。
- 第八十轮已把 Builder 的 object value / fixed fields 输入区抽成 `WorldEngineObjectValueEditor` 子组件，为后续支持嵌套 object / collection 控件留下更清楚的落点。
- 第八十一轮已把固定 object fields 中的嵌套 object 字段从普通 text 输入升级为 JSON textarea，减少把嵌套对象误写成字符串的概率。
- 第八十二轮已为固定 object fields 的嵌套 object 字段补提交前形状校验：JSON textarea 必须解析为非数组 object，避免把数组 / 字符串等非法值提交到后端后才报错。
- 第八十三轮已统一 Mutation Builder 的 value 类型读取：list / collection 优先使用 `itemType` 推导默认值、ref 下拉和 value mode，不再依赖投影里兼容性的 `type` 字段。
- 第八十四轮已让独立 `/world-engine.preview` 的 Mutation Builder 显示当前 value 类型提示（如 `list<ref(location)>` / `collection<ref(item)>`），让 `itemType` 语义在 Preview UI 中可见。
- 第八十五轮已拆分独立 `/world-engine.preview`：新增 `WorldEnginePreviewProjectPanel`、`WorldEnginePreviewActions`、`WorldEnginePreviewMutationBuilder`，把 Project/Schema、Actions 表单和简化 Builder 从页面内联模板中移出，页面体量降到 799 行。
- 第八十六轮已让主 IDE Workbench Mutation Builder 也显示当前 value 类型提示（如 `list<text>` / `collection<ref(item)>` / `scalar:int`），与 Preview 的 `itemType` 可见性对齐。
- 第八十七轮已为主 IDE Workbench Mutation Builder 增加“插入其后”：可把 Builder 当前 mutation 插入到所选 mutation 后方，并自动选中新插入项，减少多 mutation slice 调整顺序时的反复上移 / 下移。
- 第八十八轮已为主 IDE Workbench Mutation Builder 增加“复制所选”：可把当前选中的 mutation 克隆到下一位、自动选中副本并回填 Builder，方便基于相似 mutation 快速微调。
- 第八十九轮已补齐主 IDE Workbench 的 `list/collection itemType=object` 输入：默认值生成 `{}`，Builder 显示顶层 JSON textarea，提交前要求 value 必须是非数组 JSON object。
- 第九十轮已让主 IDE Workbench 开放 object 行编辑器继承根 object 的 `itemType`：例如 `itemType=object` 的开放 key 会显示 JSON textarea 并自动填 `{}` 默认值，`ref(item)` / 数值 / 布尔等 itemType 也会获得对应控件与默认值。
- 第九十一轮已收紧开放 object 行的 `itemType` 继承触发条件：空 key 行先保持普通输入，只有填写 key 后才按根 object `itemType` 切换 value 控件，避免空行过早变成 JSON textarea。
- 第九十二轮已统一开放 object key 的 trim 语义：value 控件推导、固定 field 匹配和最终写入都使用裁剪后的 key，避免 key 前后空格导致显示控件与实际写入路径不一致。
- 第九十三轮已拆出 `WorldEngineMutationEditorHeader`：主编辑器顶部按钮、编辑提示和 dirty guard 提示进入独立组件，`WorldEngineMutationEditor.vue` 文件体量回到 800 行以下。
- 第九十四轮已拆开 Builder 默认 op 与默认 value：`collectionRemove` 等用户手动选择的合法 op 不会在默认值刷新时被重置回 schema 默认 op。
- 第九十五轮已为 `collectionRemove` 增加当前 State Query 结果辅助：当查询结果里当前 subject 的 collection attr 是数组时，Builder 会显示已有项下拉，减少手写删除值。
- 第九十六轮已补齐 `collectionRemove` 下拉 value 同步：候选项出现但当前 Builder value 不在候选集合里时，会自动写入第一项，避免界面显示第一项但提交旧值。
- 第九十七轮已把 `collectionRemove` 候选项推导抽成 `collectionRemoveValueOptions()` 并补行为测试，覆盖完整 attr key、点分嵌套路径、对象项格式化和非数组回退。
- 第九十八轮已拆出 `WorldEngineSliceDraftForm`：slice metadata、mutations JSON、校验提示和提交按钮进入独立组件，Mutation Builder 通过 slot 保持原位置。
- 第九十九轮已拆出 `WorldEnginePreviewStatePanel`：独立 Preview 的 World State、Subjects、Timeline 和 State Query 展示进入子组件，`world-engine.preview.vue` 降到 746 行。
- 第一百轮已让独立 Preview 的 Builder 默认 value 刷新与 Workbench 对齐：schema shortcut 仍决定默认 op，普通 subject / attr 刷新只更新 value，不覆盖用户手动选择的合法 op。
- 第一百零一轮已为独立 Preview Builder 接入 `collectionRemove` 当前状态候选：Preview Query 结果会传入 Builder，删除 collection 项时可从已有项下拉选择，并自动同步默认候选值。
- 第一百零二轮已补后端 facade 回归测试，覆盖 `collectionAdd` 对 `collection ref(item)` 去重以及 `collectionRemove` 删除已有 ref 项。
- 第一百零三轮已补齐后端 `itemType: object` 契约：schema loader 允许 `list/collection/object` 的 `itemType` 使用 `object`，service 层要求对应 item value 必须是 JSON object，并用 facade 测试覆盖 object collection 稳定 JSON 去重/删除与 object list append。
- 第一百零四轮代码审查发现并修复开放 object 的 `itemType: object` 子路径解析 bug：`findAttrSchema()` 现在会把 `memories.second` 解析为 object 属性，而不是非法的 `scalar type=object`；同时补测试确认 `scalar type: object` 仍被拒绝。
- 第一百零五轮已补 HTTP API 层 object itemType 契约测试：通过 `/api/projects/world-engine/**` 使用日历字符串写入 object collection/list/open-object 子值、删除 object collection 项、查询 state，并验证非 object item 会返回 400。
- 第一百零六轮已对齐前端开放 object 的 `itemType: object` 路径投影：`resolvePreviewAttrPath()` 和 Workbench object 行编辑器现在会把 `deepMemory.first` 视为 object 属性，而不是 `scalar type=object`，并补 util 测试覆盖手写路径。
- 第一百零七轮已补独立 Preview Mutation Builder 的 object value 护栏：object/list<object>/collection<object> 的 value 会显示 JSON textarea，并在追加 / 替换 mutation 前校验必须是非数组 JSON object。
- 第一百零八轮已让独立 Preview Mutation Builder 也支持手写 attr path：可输入 `memory.师门` 这类开放 object key，页面侧复用 `resolvePreviewAttrPath()` 推导 op、value hint、默认值和 object 校验；Preview 页面当前约 755 行。
- 第一百零九轮已把 Workbench 的 JSON object 形状校验收敛到共享 `isJsonObjectValue()` util，移除本地重复的 `jsonRecordOrNull()`，降低 Preview / Workbench object 校验漂移风险。
- 第一百一十轮已修复 `collectionRemove` 下拉对 JSON-like 字符串的类型丢失：字符串 `"80"` / `"true"` / `"null"` 会以 JSON 字符串字面量作为提交值，避免被宽松解析成 number / boolean / null。
- 第一百一十一轮已收紧一键示例世界的 schema 预检：示例依赖的 `list/collection` 值类型会按 `itemType` 优先判断，错误或缺失值类型会在预检阶段提示，不再等到真实写入后端才失败。
- 第一百一十二轮已修复 Workbench enum 下拉对 JSON-like 字符串枚举项的类型丢失：新增 `formatJsonInputValue()` 共享保真格式化，enum 与 `collectionRemove` 提交值都会在必要时使用 JSON 字符串字面量。
- 第一百一十三轮已按新路线移除前端旧后续处理交互和 DTO，Preview / Workbench 均展示 `{sliceId, issues}`、`{subjects, issues}` 与 slice `issues`，接入 `deleteSlice` 删除入口；后端读时补齐 `dangling-ref` E issue，profile 与文档同步为不存旧值字段、不自动改写后续切面、E/A issues、项目日历字符串契约。
- 第一百一十四轮代码审查补齐一键示例世界 issue 反馈：Preview / Workbench 示例写入现在都会保留并提示 slice 返回的 `issues`，避免示例入口绕过新路线反馈面；同时把 Workbench mock 预览里的旧 kind 示例改为 `backstory`，并清理当前文档里的旧交互表述。
- 第一百一十五轮清理静态测试和工具描述中的旧路线字面量：保留旧入口不存在的断言，但不再让测试源码携带旧 endpoint / 状态名；`delete_world_slice` 描述也收敛为物理删除 cleanup，不暗示可恢复撤销。
- 第一百一十六轮代码审查补齐独立 Preview 的 action issues 通道：写入 / 示例世界 / 删除 slice 返回的 issues 会作为“本次操作 issues”单独展示；State Query issues 只承载查询结果，不再被删除返回值临时复用。
- 第一百一十七轮代码审查修复 `createSubject` 空切面边界：当 subject schema 没有 default mutation 时只创建 subject 身份，不再创建无 mutation 的 init slice，保持“切面 = 状态变更”约束。
- 第一百一十八轮同步稳定设计文档与 Agent 工具描述：`create_world_subject` 明确无 default 不创建空切面，`worked-example` 回退示例改为不可恢复 `deleteSlice`，`agent-tools` / `schema-design` 状态改为第一版已落地。
- 第一百二十六轮收尾核查 profile 提示词：系统 profile `world.engine` 已明确 `create_world_subject` 只有 schema default 非空时才写入 init slice，空 default 类型只注册 subject 身份；同步重新编译 profile runtime artifact，避免 catalog 继续加载旧提示。
- 第一百二十七轮继续收紧稳定文档与 Agent 工具描述：`README` 的 default 决策段、`sqlite-and-api` facade 注释和 `create_world_subject` 工具描述均已明确“非空 default 才写 init slice；否则只注册 subject 身份”，并用 Agent 工具测试钉住该描述。
- 第一百二十八轮代码审查修复 Workbench 删除 slice 后的选择跳转：删除当前 slice 后刷新 timeline 时不再自动选中其他 slice，避免 Inspector 立刻跳到另一条切面造成“刚删完却还在看切面”的误解；普通加载、写入和示例世界仍保持默认选中逻辑。
- 第一百二十九轮代码审查修复独立 Preview 切换 Project 后的提示残留：切换 Project 会同步清空上一 Project 的 `notice` / `error`，避免成功/失败提示跨 Project 留在页面顶部。
- 第一百三十轮收口源码注释契约：`WorldEngineService.createSubject()` 与 `CreateWorldSubjectResult` 类型说明已对齐“非空 default 才写 init slice；空 default 类型只注册身份”，避免源码注释继续暗示总会创建初始化切面。
- 第一百三十一轮修复独立 Preview 新建 Project 成功提示：`createProject()` 现在先等待 `loadProjects(project.projectPath)` 完成 Project 切换清理，再显示“已创建”提示，避免 round-129 的切换清理把新建成功反馈立刻清掉。
- 第一百三十二轮修复独立 Preview 初始 Project 选择：没有 `?projectPath=` 参数打开页面时，现在会跳过空字符串并回退到当前选择或 Project 列表第一项，避免空 query 阻断默认 Project fallback。
- 第一百三十三轮去重独立 Preview Project 加载：`loadProjects()` 程序化更新 `selectedProjectPath` 时会抑制同步 watcher，避免同一次 Project 列表刷新触发两次 `loadWorld()`；用户手动切换 Project 仍会清理会话态并重新读取世界数据。
- 第一百三十四轮修复独立 Preview 无效 Project path fallback：URL 或候选里的 `projectPath` 只有仍存在于当前 Project 列表时才会被选中，旧链接 / 已删除 Project path 会回退到列表第一项。
- 第一百三十五轮清理独立 Preview Project 选择旧 helper：删除已无生产引用的 `firstProjectPath()` 和旧语义测试，避免后续误用“只要非空就可选”的过期规则。
- 第一百三十六轮修复主 IDE Workbench Edit tab 初始草稿：编辑器创建时会直接用已加载 schema calendar 生成默认 time，并从当前选中 subject / 首个 subject 派生初始 mutation subject，不再依赖 schema watcher 之后才补值。
- 第一百三十七轮修复主 IDE Workbench Edit tab 异步 schema 默认值与 dirty guard 的交互：schema watcher 自动补 time 时，如果此前草稿是 clean，补完后仍标记 clean，避免把系统默认值误判为用户未保存草稿。
- 第一百三十八轮让主 IDE Workbench Edit tab 初始 mutation 也按当前 subject schema 派生：优先 `events`，否则使用当前类型第一个 attr，避免第一屏 Builder 固定写向不存在的 `events`。
- 第一百三十九轮把初始 mutation 派生规则收敛为 `defaultMutationForPreviewSubject()` util，并补行为测试覆盖优先 `events`、fallback 首个 attr 和空 schema fallback。
- 第一百四十轮按用户调整暂停前端推进，专注后端与 API 设计：撤回被打断的前端草稿；修复 `itemType: object` 的 schema default 校验缺口，`list` / `collection` 的默认元素和开放 `object` 的默认子值现在都必须是 JSON object，并补 facade 与 HTTP API 回归测试。
- 第一百四十一轮继续后端/API 契约收口：`createSubject` 现在会在写库前检查重复 subject id，并返回稳定 409 业务错误，避免 API / Agent 调用者看到 Prisma 唯一约束细节；facade 与 HTTP API 均已补回归测试。
- 第一百四十二轮继续后端/API 查询契约收口：当 schema 已声明 subject types 时，`queryState(type)`、`listWorldSubjects(type)`、HTTP `state/query`、`GET subjects?type=` 和 Agent `get_world_state(type)` 都会拒绝 schema 未声明的 type，避免拼错类型时静默返回空结果。
- 第一百四十三轮继续后端/API issue 定位收口：`dangling-ref` 对 `list` / `collection` ref 元素会记录具体元素来源 slice，避免多个 slice 依次写同一属性时把缺失 ref 误归到最后一次属性变更；本轮重新编译 system profile artifacts 并提高 `world.engine` profile catalog 测试超时，目标后端/API/Agent 测试通过，`bun run typecheck` 仍被当前无关 `server/low-code-form/*` 类型错误阻塞。
- 第一百四十四轮继续后端/API A issue 语义收口：`base-shifted` / `masked` 的下游检测从“完全相同 attr”扩展为“同一路径或父子路径相关”，例如编辑过去的整体 `stats` object 会提醒下游 `stats.hp add` 的累加基变化；issue 的 `attr` 指向实际下游问题路径，便于 API/Agent/UI 定位到需要确认的 mutation；目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百四十五轮继续后端/API A issue 覆盖收口：父路径整体 `set/unset` 现在会按下游子路径分别收集第一条相关 A issue，避免 `stats.note set` 吞掉后续 `stats.hp add` / `stats.mp add` 的提醒；若下游父路径整体覆盖当前路径则停止扫描，保持“整体已被覆盖”的语义。目标后端/API/Agent 测试通过；`bun run typecheck` 当前被无关 `server/agent/profiles/profile-home.test.ts` 类型错误阻塞。
- 第一百四十六轮继续后端/API 查询契约收口：`queryState({attrs})` 现在只返回与查询 attr 相关的 E issues，避免查询 `hp` 时带回 `location` 的 `dangling-ref` 噪音；查询父属性会保留子路径问题，例如 `inventory` 会返回 `inventory[0]`。无 attrs 查询与 `getWorldState` 继续返回全部 E issues；目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百四十七轮继续后端/API `editSlice` A issue 收口：原样保存已有 mutation 不再重复返回 `base-shifted` / `masked`；移动 slice instant 时会同时从旧位置和新位置观察下游影响，并排除当前 slice 自身，避免漏掉“把基准切面移到下游相对 op 之后”的提醒。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百四十八轮继续后端/API `editSlice` 删除旧 mutation 的 A issue 收口：编辑切面时会把被移除的旧绝对 mutation 也纳入 advisory 检测，避免删掉 `hp set 80` 后因 default `hp=100` 仍存在而没有 E issue、却静默改变下游 `hp add` 结果；目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百四十九轮继续后端/API 契约测试收口：HTTP API 已补 `editSlice` 删除旧绝对 mutation 时返回下游 `base-shifted` 的回归测试，确认日历字符串 API 边界也暴露 round-148 的 `{sliceId, issues}` 语义；同时把 facade 测试 afterAll 清理 hook timeout 放宽到 30s，避免临时 Project 清理阶段假红。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十轮回到作者真实路径补 Preview 多 mutation 编辑闭环：独立 `/world-engine.preview` 的 Mutation Builder 复用 `WorldEngineMutationListControls` 与 `WorldEngineMutationActionButtons`，可选择、载入、替换、插入、复制、删除和移动单条 mutation；本轮窄测 `app/utils/world-engine-ide-entry.test.ts` 通过，`bun run typecheck` 被无关 Agent pending approval/resolution 类型漂移阻塞。
- 第一百五十一轮修复多 mutation 编辑删空后的续写闭环：新增 `parseMutationListJson()` 作为编辑器内部解析，允许 `[]` 临时草稿；主 IDE Slice Composer 和独立 Preview 的“追加”都可在删掉最后一条后补回 mutation，而 `parseMutationJson()` 继续保证提交前非空。`app/utils/world-engine-preview.test.ts` 与 `app/utils/world-engine-ide-entry.test.ts` 通过。
- 第一百五十二轮修复独立 Preview Project 参数兼容：`/world-engine.preview` 同时接受 `projectPath` 和主 IDE 通用的 `project` query，避免手动以 `?project=workspace/ming-ding-zhi-shi-2` 打开时回退到错误 Project。`app/utils/world-engine-ide-entry.test.ts` 通过。
- 第一百五十三轮修复独立 Preview 编辑载入上下文：timeline 载入已有 slice 编辑后会把第一条 mutation 同步进 Builder，并将 mutation selection 回到第 1 条；schema 快捷填充和默认 mutation 草稿也同步重置 selection。`app/utils/world-engine-ide-entry.test.ts` 通过。
- 第一百五十四轮修复独立 Preview subject 点击后的写入上下文：点击左侧 subject 时，如果当前仍是自动 mutation 草稿且不在编辑已有 slice，会同步默认 mutation 到该 subject；作者手写 mutations 或编辑已有 slice 时不覆盖。`app/utils/world-engine-ide-entry.test.ts` 通过。
- 第一百五十五轮修复独立 Preview 编辑保存后的下一步草稿：保存已有 slice 编辑成功后会调用新建草稿重置路径，避免表单退出编辑模式但仍保留旧 slice 的 title/summary/mutations；取消编辑时默认 mutation 也优先沿用当前 Builder subject。`app/utils/world-engine-ide-entry.test.ts` 通过。
- 第一百五十六轮修复独立 Preview 写入飞行中可编辑问题：Write Slice 区域在 `actionBusy` 时整体禁用，覆盖 metadata 输入、Mutation Builder、mutations textarea 和提交 / 取消按钮，避免飞行中修改被刷新覆盖。`app/utils/world-engine-ide-entry.test.ts` 通过。
- 第一百五十轮继续后端/API Agent 工具契约收口：`edit_world_slice` 工具已补删除旧绝对 mutation 时返回下游 `base-shifted` 的回归测试，确认 Agent 工具层也暴露 round-148 的 `{sliceId, issues}` 语义；`agent-tools.md` 同步说明 `get_world_state(attrs)` 的 issues 会跟随属性投影范围收窄。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十一轮继续后端/API `editSlice` A issue 精度收口：同 instant 编辑时只对真正被删除、修改或新增的 mutation 收集 A issue，避免同一 slice 中只改 `mind` 却为未变化的 `hp set` 重复返回下游 `base-shifted`；移动 instant 时仍把整组 mutation 视为被移动。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十二轮继续后端/API `editSlice` 顺序语义收口：同 instant 纯重排时，如果相关 mutation（同 subject 且同一路径或父子路径）相对顺序改变，会把这些 mutation 纳入 A issue 候选，避免 `hp set 80` / `hp set 90` 调换后静默改变下游 `hp add` 的累加基；无关属性重排不产生噪音。Facade、HTTP API、Agent 工具测试与 `bun run typecheck` 均通过。
- 第一百五十三轮继续后端/API `editSlice` 顺序语义补洞：上一轮的重排检测从“纯重排且长度相同”放宽到“共同保留的相关 mutation 是否发生相对顺序反转”，避免同一次编辑新增 / 删除无关 mutation 时遮住保留 `hp set` 的顺序变化；Facade、HTTP API、Agent 工具测试与 `bun run typecheck` 均通过。
- 第一百五十四轮继续后端/API 查询契约收口：`queryState(subjectIds)` / HTTP `state/query` / Agent `get_world_state` 现在拒绝重复 `subjectIds`，避免 API 静默去重后返回数量与调用方请求不一致；本轮重新编译 `world.engine` system profile artifact，目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十五轮继续后端/API Agent 工具资源边界收口：`list_world_slices` 未传 `limit` 时现在默认只返回最近 5 个切面，避免把完整 timeline 倾倒给模型；显式 `limit` 仍按工具 schema 限制为 1..50，HTTP `GET /slices` 保持原显式查询语义。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十六轮继续后端/API 输入边界收口：单个 slice 的 mutations 上限 100 从 Agent 工具层下沉到 service 层，并同步 HTTP body schema，`writeSlice` / `editSlice` / `POST /slices` / `POST /slices/:id/edit` 都会拒绝超大切面；目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十七轮继续后端/API 查询投影契约收口：`queryState(attrs)` / HTTP `state/query` / Agent `get_world_state` 现在拒绝重复 `attrs`，避免投影对象静默覆盖导致调用方误判返回项数量；目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十八轮继续后端/API Agent 工具范围查询修正：`list_world_slices` 的默认最近 5 个切面现在只在未传 `limit/from/to` 时生效；传 `from` 或 `to` 做区间查询时不再默认截断，避免“某段历史有哪些切面”只返回前 5 个。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百五十九轮继续后端/API 输入边界补洞：`createSubject` 根据 schema default 生成 init mutations 时同样遵守单 slice 100 条上限；如果同 instant 已有 init slice，追加前会检查追加后的总 mutation 数，避免通过 subject 创建绕过 `writeSlice` / `editSlice` 的容量限制。Facade 与 HTTP API 已补回归测试，目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百六十轮继续后端/API 初始化追加语义收口：`createSubject` 只有在同 instant 已有 `kind=init` 切面时才会自动追加 schema default mutations；如果该时刻已有 `event/backstory` 等非 init 切面，会返回 409，要求调用方改用 `editSlice` 显式合并或选择其他初始化时间，避免 subject 创建悄悄改写普通事件切面。Facade 与 HTTP API 已补回归测试，目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百六十一轮继续后端/API Agent 工具契约同步：`create_world_subject` 工具描述已明确 schema default 只会写入 `kind=init` slice，目标时间已有非 init slice 时需显式编辑或换时间；Agent 工具测试补齐该 409 冲突回归，并重新编译 `world.engine` system profile artifact。目标后端/API/Agent 测试与 `bun run typecheck` 均通过。
- 第一百六十二轮继续后端/API subject id 形状收口：`createSubject`、slice mutation 的 `subjectId` 与 `queryState(subjectIds)` 现在在 service 层拒绝空白或带首尾空白的 id，HTTP API 与 Agent 工具入口同步暴露稳定业务错误，避免 subject 引用 URI 与存储 id 因隐式空格漂移。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十三轮继续后端/API ref 输入边界收口：`subject://<id>` 内部的 `<id>` 现在复用 subject id 形状校验，空 id 或带首尾空白的 ref id 会返回稳定 400，而不是误报为普通“引用目标不存在”。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十四轮继续后端/API 查询边界收口：`queryState` 的防全量倾倒规则已下沉到 service 层，Facade 直调也必须提供 `subjectIds` 或 `type`；全量世界状态统一走 `getWorldState`。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十五轮继续后端/API schema 输入边界收口：schema loader 现在拒绝空白或包含空白的 subject type 名，避免 `createSubject` / `queryState(type)` / `ref(type)` 依赖不可稳定引用的类型 key。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十六轮继续后端/API attr path 边界收口：schema attr 名现在拒绝空名、首尾空白和点号，运行时写入 / 查询 attr path 也拒绝带首尾空白的路径段，避免 `memory.师门` 这类合法 dotted path 与 schema 单 key 中的点号产生不可寻址歧义；本轮重新编译 `world.engine` system profile artifact。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十七轮继续后端/API slice metadata 边界收口：`WorldSlice.kind` 仍允许项目自定义，但一旦传入就不能为空或带首尾空白，避免空字符串绕过默认 `event` 或产生不可稳定过滤的 timeline 标签。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十八轮继续后端/API subject type 入参边界收口：`createSubject(type)`、`queryState(type)`、`listWorldSubjects(type)` 现在会在 service 层拒绝空 type 或包含任意空白的 type，确保运行时入参与 schema type key 使用同一套稳定 key 规则。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百六十九轮继续后端/API `sliceId` 入参边界收口：`editSlice(sliceId)`、`deleteSlice(sliceId)` 现在会在 service 层拒绝空 id 或带首尾空白的 id，HTTP path 入口也不再静默 trim `%20...%20`，避免调用方误把错误 id 当成“切面不存在”。Facade/API/Agent/Profile 目标测试与 `bun run typecheck` 均通过。
- 第一百七十轮做后端/API 文档语义收口：`agent-tools.md` 已把 `get_world_schema` 从待定改成已接入工具，`worked-example.md` 已把 `calendar.yaml` 和 `createSubject` 同 instant 初始化追加规则改成当前第一版契约。本轮只改文档，未改代码行为。
- 第一百七十一轮继续后端/API HTTP query 边界收口：`GET /subjects?type=`、`GET /slices?limit=&withMutations=&from=&to=`、`GET /state?at=` 不再静默 trim query 参数；空字符串仍按未传处理，但带首尾空白的 type / limit / boolean / time query 会返回稳定 400，避免 URL 入口绕过 service 层稳定 key 与严格 query 规则。目标后端/API/Agent/Profile 测试 116 条与 `bun run typecheck` 均通过。
- 第一百七十二轮继续后端/API HTTP query 边界收口：World Engine HTTP query 参数现在拒绝重复值数组，`type` / `limit` / `withMutations` / `at` 等单值参数如果通过重复 query 形成数组，会返回 `${key} 只能传一个值`，避免被静默当作未传并改变查询范围。目标后端/API/Agent/Profile 测试 117 条与 `bun run typecheck` 均通过。
- 第一百七十三轮继续后端/API 时间边界收口：HTTP 与 Agent 工具公开入参现在拒绝 `instant:<number>` 调试格式，要求 `time` / `at` / `from` / `to` 都使用项目日历字符串；`WorldCalendar.parse()` / facade `parseTime()` 仍保留底层调试兼容。目标后端/API/Agent/Profile 测试 119 条与 `bun run typecheck` 均通过。
- 第一百七十四轮继续后端/API 时间边界收口：HTTP body 与 Agent 工具的公开时间字符串现在也不再静默 trim，`time` / `at` / `from` / `to` 带首尾空白会返回稳定 400；底层 `WorldCalendar.parse()` 仍保留 trim 给 facade 直调测试/调试使用。目标后端/API/Agent/Profile 测试 121 条与 `bun run typecheck` 均通过。
- 第一百七十五轮继续后端/API service 契约补洞：`queryState({type:""})` 与 `listWorldSubjects({type:""})` 现在在 service 层都会返回 `subject type 不能为空`，不再因空字符串 falsy 绕过 type 校验或退化成全量 subject 列表。目标后端/API/Agent/Profile 测试 121 条与 `bun run typecheck` 均通过。
- 第一百七十六轮继续后端/API `queryState` 契约补洞：facade/service 直调传 `subjectIds: []` 或 `attrs: []` 现在会返回稳定 400，不再把空数组静默当作未传，避免调用方误把空投影放大成完整状态查询。目标后端/API/Agent/Profile 测试 121 条与 `bun run typecheck` 均通过。
- 第一百七十七轮做后端/API 文档契约同步：`agent-tools.md` 与 `sqlite-and-api.md` 已明确 `queryState` / `get_world_state` 的 `subjectIds`、`attrs` 如果传入必须是非空数组，并保持唯一性要求。本轮只改文档，未改代码行为。
- 第一百七十八轮继续后端/API `Instant` 存储边界收口：service 层现在会拒绝超出 SQLite 64 位整数范围的 `at` / `instant` / `from` / `to`，避免 Calendar 解析或 facade 直调把超大 `bigint` 交给 Prisma/SQLite；HTTP API 已补超大项目日历时间返回稳定 400 的回归测试。
- 第一百七十九轮继续后端/API Calendar 零点前时间收口：默认 Calendar 的 `format()` / `parse()` 现在对负 `Instant` 可往返，采用连续纪年，允许 `0年` 和负 year 表示零点前时间；HTTP API 已补 `复兴纪元0年 12月30日 23:59:59` 创建 init slice 的回归测试。
- 第一百八十轮继续后端/API Calendar 配置校验收口：自定义 `format` 中 `year/month/day/hour/minute/second` 这些可解析时间字段不能重复，`hour` 与 `hour:02` 视为同一字段；重复时在加载 calendar.yaml 阶段返回稳定 400，避免 parse 阶段暴露 JS 正则重复命名捕获组异常。
- 第一百八十一轮继续后端/API Calendar 单位精度收口：`secondsPerMinute` / `hoursPerDay` 等 YAML number 形式必须是 JS safe integer 正整数，避免不安全 number 已经丢精度后再转 BigInt；如需超过 safe integer 的单位值，必须写成正整数字符串。
- 第一百八十二轮继续后端/API schema ref type 收口：`ref(<type>)` 中的 `<type>` 现在复用 subject type 稳定 key 规则，不能为空、不能含空白，也不能包含括号，避免 `ref(foo(bar)` 这类 schema 先被接受、后续写入时才表现成不可匹配类型。
- 第一百八十三轮继续后端/API schema ref 目标收口：schema subject type key 与运行时 type 入参现在都拒绝括号；`ref(type)` 必须指向同一 schema 已声明的 subject type，悬空 ref 会在 schema 加载阶段返回稳定 400。
- 第一百八十四轮继续后端/API schema default 收口：schema default 的纯形状 / 类型错误现在会在 schema 加载期暴露，`getWorldSchema` 不再投影非法 default；ref default 的目标存在性仍在创建 subject 写 init mutation 时校验并保持事务回滚。
- 第一百八十五轮继续后端/API schema enum 收口：schema loader 现在拒绝重复 enum 候选值，重复判断使用 stable JSON，因此对象 key 顺序不同但语义相同的 enum 候选也会被视为重复。
- 第一百八十六轮继续后端/API Calendar 单位收口：Calendar 单位的字符串形式也必须大于 0，`"0"` 不再被接受，避免后续 format/parse 走到除零。
- 第一百八十七轮继续后端/API Calendar 配置根结构收口：`calendar.yaml` 显式存在时必须是 object，数组 / 标量不再静默回退默认 Calendar。
- 第一百八十八轮继续后端/API Calendar era 收口：显式配置 `era` 时必须是字符串，`era: 123` 不再静默回退默认纪元；空字符串仍允许用于无 era 前缀的格式。
- 第一百八十九轮继续后端/API schema 配置根结构收口：`schema.yaml` 显式存在时必须是 object，数组 / 标量不再静默回退空 schema；空文件 / 缺文件仍使用空 schema。
- 第一百九十轮继续后端/API schema 描述字段收口：subject type / attr 的显式 `desc` 必须是字符串，非字符串不再被静默丢弃或投影给 API / Agent。
- 第一百九十一轮继续后端/API timeline 查询数值边界收口：`listSlices.limit` 与 HTTP `GET /slices?limit=` 必须是 JS safe integer 正整数，超大纯数字不再丢精度后进入查询；本轮不改变 HTTP timeline 的业务最大上限策略。
- 第一百九十二轮继续后端/API int 数值精度收口：schema `type: int` 的 default 与 mutation value 必须是 JS safe integer；超出安全整数范围的 JSON number 会稳定返回 400，避免世界状态静默存入已丢精度的整数。
- 第一百九十三轮继续后端/API int add reduce 结果收口：`int add` 的累加结果如果超出 JS safe integer，会作为 `broken-relative` E issue 显形，写入 / 查询 / listSlices 都不会把不安全整数放进 reduce 状态。
- 第一百九十四轮继续后端/API add reduce 结果有限数收口：所有 `add` 的累加结果必须仍是 finite number；`float` 或未声明数值属性相加得到 `Infinity` 时会作为 `broken-relative` E issue 显形，并保留原安全基准值。
- 第一百九十五轮继续后端/API Agent 工具边界收口：`write_world_slice` / `edit_world_slice` 的 mutation `value` 现在必须是严格 JSON 值，`NaN` / `Infinity` / `Date` / 嵌套 `undefined` 等不会再被工具层 JSON 序列化静默改成 `null`、字符串或丢字段。
- 第一百九十六轮继续后端/API service 最终边界收口：`writeSlice` / `editSlice` 的 mutation `value` 在 service 层也只接受严格 JSON 值，`Date` 等非普通对象不会被当成空 object 后再序列化成字符串。
- 第一百九十七轮继续后端/API HTTP path 边界收口：World Engine catch-all API 遇到非法 percent encoding 时会返回稳定 400，不再让 `decodeURIComponent` 的原生 `URIError` 冒出。
- 第二百零五轮修复 `createSubject` 初始化切面与 `editSlice` 整块保存的 op 契约缝隙：`list` / `collection` 现在允许 `set` 作为整组替换，value 必须是 array，数组项继续按 `itemType` / `type` 校验；HTTP 回归覆盖主 Workbench 原样保存 init slice 的作者路径。
- 第二百零六轮让独立 Preview 手动创建 subject 后自动刷新 State Query 和下一写入时间。
- 第二百零七轮让独立 Preview 点击 subject 后直接刷新 State Query，并清掉旧 type 查询条件。
- 第二百零八轮让独立 Preview 默认 slice mutation 复用 `defaultMutationForPreviewSubject()`，不再硬编码 `events/listAppend`；创建 subject 后会先刷新 subjects，再按新 subject 的 schema 生成默认草稿。
- 第二百零九轮让独立 Preview 打开已有 Project 后检查默认 `world` subject 是否真实存在；不存在时回落到第一个真实 subject，并只在当前 mutations 仍是自动草稿时刷新默认 mutation，避免覆盖用户手写草稿。
- 第二百一十轮让默认手写 slice mutation 在当前 subject 没有 `events`、但项目存在 `world.events` 时回退到 `world.events listAppend`，避免 `ming-ding-zhi-shi-2` 选中真实角色后第一屏默认写 `hp set 100`。
- 第二百一十一轮让 Mutation Builder 表单的 subject / attr / op / value 跟随默认 mutation 的实际 subject，避免 textarea 已是 `world.events`、Builder 仍显示 `player` 后误点“替换所选”。
- 第二百一十二轮让主 Workbench 保存新 slice 后，如果本次提交 mutations 不命中当前 subject 过滤，则自动切回整体世界视角，避免刚写成功的 slice 被 `player` 等旧过滤隐藏并触发时间线跳走。
- 第二百一十三轮让下一条 slice 默认时间优先从已加载 timeline 的最新时间推导，修复 `ming-ding-zhi-shi-2` 已在 488 年但新建事件跳回 `复兴纪元1年` 的问题。
- 第二百一十四轮让下一条 slice 默认时间支持同一天内小时进位，避免最新切片在 `14:59:59` 时无法推到 `15:00:00` 而回退到 calendar examples。
- 第二百一十五轮补齐主 Workbench State Snapshot 的 query issues 接线：选中 slice 后的 `state/query` 与展开完整世界的 `GET /state` 返回 issues 都会传入 Inspector，并在 State Snapshot 顶部和 raw JSON 中展示。
- 第二百一十六轮清理主 Workbench 中未实际进入 UI 的 `previousSnapshotIssues` 死状态，避免代码表达出“前态 issues 已接入审查工作台”的假心智。
- 第二百一十七轮修复主 Workbench Review Queue issue 定位：点击 issue 会清掉遮挡目标的过滤条件、聚焦对应 subject；如果 issue 所属 slice 当前未加载，不再把选中态指向不存在的 slice，而是提示无法定位到时间线。
- 第二百一十八轮让 Review Focus 记住具体 issue key，避免同一 slice / subject / attr 下多条 issue 时底部审查工作台显示成第一条同属性 issue。
- 第二百一十九轮修复 Review Queue 自动切换 subject 过滤后 issue focus 被 watcher 清空的问题；普通手动 subject 过滤仍会清掉旧 issue focus。
- 第二百二十轮修复未加载 issue 的审查面板语义：目标 slice 不在当前 timeline 时只提示无法定位并清空 issue focus，不再在当前 slice 上显示 `manual-focus`。
- 第二百二十一轮修复清空 subject 过滤后旧 issue focus 残留的问题，确保作者回到整体世界视角时不会继续看到过期 issue 高亮。
- 第二百二十二轮把主 Workbench 的 subject timeline 过滤下推到服务端 `GET /slices?subjectIds=...&subjectMode=...`，避免长 timeline 下只筛最近 200 条。
- 第二百二十三轮增加 `GET /slices/:sliceId`，Review Queue 可按 id 懒加载当前 timeline 未包含的 issue slice 并继续定位。
- 第二百二十四轮让 slice detail 返回 `previousTime`，用于懒加载 issue slice 后查询准确的切片前状态。
- 第二百二十五轮让懒加载 issue slice 按 `previousTime` 合并回当前 timeline，减少定位后的视觉顺序错位。
- 第二百二十六轮让 Review Queue 点击 issue 后真正刷新该 subject 的服务端 timeline，并在目标 slice 超出窗口时把已懒加载切面合并回来，避免“左栏已切 subject、列表仍是旧数据”的假视角。
- 第二百二十七轮补齐待接入 subject 的 timeline 提示：作者在左栏选中尚未注册到 World Engine 的 `simulation/subjects` 主体时，顶部会说明暂无 World Engine 时间线，并提示先同步主体系统或选择已注册 subject。
- 第二百二十八轮让待接入-only subject 过滤清空当前选中 slice，避免 Slice List 已经为空但右侧 Inspector 仍显示旧切片。
- 第二百二十九轮让待接入-only subject 过滤后保持焦点在作者刚选的待接入 subject 上，避免 `applyDefaults()` 把焦点改回旧 slice 主体，导致新建 Slice 默认目标串线。
- 第二百三十轮在主体系统待接入面板显示同步初始化时间，明确同步会使用 schema calendar 的初始化示例时间注册 subject，避免作者点击前不知道会写入哪个 instant。
- 第二百三十一轮把 subject 初始化遇到“目标时间已有非 init 切面”的 409 提示转译成 Workbench 可执行动作，不再把 `editSlice` 这种 API 词直接露给作者。
- 第二百三十二轮修复批量同步主体系统的部分成功恢复：如果前几个 subject 已接入、后续同步失败，Workbench 会刷新已接入 subject 并提示“已接入 N 个，但后续失败”，避免列表仍把成功项显示为待接入。
- 第二百三十三轮把主体系统同步的初始化时间改为可编辑输入：默认仍使用 schema calendar 示例时间，但作者可在冲突后改到相邻时间再重试。
- 第二百三十四轮修复 preferred subject 没有命中 slice 时的默认选择：创建或同步无 default subject 后不再回落到旧 slice，而是保持该 subject 焦点并清空选中切片。
- 第二百三十五轮把无选中 slice 的空状态改成按当前视角区分：Project 真空、subject 时间线空、待接入 subject 和已有 slice 但未选择会显示不同文案与动作。
- 第二百三十六轮修复 mixed subject 过滤下的新建 Slice 默认目标：focused subject 未接入但当前过滤包含已注册 subject 时，Composer 会优先落到已注册 subject。
- 第二百三十七轮阻止包含待接入 subject 的过滤进入“全部 subject”模式，避免不可满足过滤把时间线显示成假空列表。
- 第二百三十八轮把顶部当前视角里的 subject 模式从内部 `any/all` 改成人读的“任一 subject / 全部 subject”，并同步 mock preview。
- 第二百三十九轮修复手动切换“任一 subject / 全部 subject”后旧 Review Queue issue focus 残留的问题，避免审查面板继续指向旧问题。
- 第二百四十轮修复清空 subject 过滤和进入草稿视角后的隐藏 `subjectFilterMode` 残留，回到整体世界时复位为“任一 subject”。
- 第二百四十一轮继续补齐空 subject 过滤路径：刷新后 selected subjects 被过滤为空、mock 移除最后 subject chip、恢复旧草稿 subject 已失效时，都复位 subject mode。
- 第二百四十二轮让主 Workbench Slice Composer 在 subject 过滤视角下仍参考已知整体 timeline 时间，避免默认下一时间只避开局部 subject timeline。
- 第二百四十三轮收口 `knownSliceTimes` 合并顺序：局部 / 懒加载旧切片时间只补到已知窗口前方，不抢走完整 timeline 末尾的默认下一时间基准；第三百二十九轮已进一步改为由 `suggestNextPreviewTime()` 按可解析 instant 排序，不再依赖数组尾项顺序。
- 第二百四十四轮让主 Workbench 在 subject 过滤视角下刷新、保存、删除和同步后继续使用服务端 subject timeline，避免退回最近 200 条的本地过滤。
- 第二百四十五轮给主 Workbench Slice Composer / Workbench 关闭动作补 dirty guard，避免误关浮层或整个工作台时无声丢失未保存切片草稿。
- 第二百四十六轮修复 Composer 已打开时再次点击顶部新建 / 编辑入口误清父层 dirty 状态的问题，避免后续关闭跳过未保存草稿确认。
- 第二百四十七轮给 Slice Composer 内部“新建模式”切换补 dirty guard，避免编辑已有 slice 后误点新建模式直接清空未保存草稿。
- 第二百四十八轮给主 Workbench Slice Composer 新建模式增加“写入并继续下一步”，连续推演多条 slice 时不再每次保存后重新打开 Composer。
- 第二百四十九轮收口“写入并继续下一步”的重挂风险：继续模式由子编辑器立即准备下一条草稿，父层刷新后不再重挂 Composer，避免抹掉作者已经开始输入的下一步内容。
- 第二百五十轮收口“写入并继续下一步”的多 subject 焦点漂移：父层会把焦点对齐到本次保存的后续推演上下文；普通多 subject slice 使用最后一个 mutation subject，第二百八十八轮已补角色事件回退到 `world.events` 时保留原 selected subject。
- 第二百五十一轮给 Workbench 关闭动作补会话草稿保护：关闭整个 Workbench 时会汇总 Slice Composer、Inspector metadata 和 mutation value 草稿并确认，避免静默丢失。
- 第二百五十二轮补齐 Workbench Dialog `update:modelValue` 关闭入口：直接 v-model 关闭也会走统一草稿确认，不再绕过 Round 251 的保护。
- 第二百五十三轮补齐 Project 切换前的 World Engine 草稿保护：Workbench 会向父页面上报会话草稿状态，主 IDE 切换 Project 前会确认是否放弃这些草稿。
- 第二百五十四轮把 Bookshelf 内部 Project 创建 / 切换 / 删除当前 Project 入口也接入同一 World Engine 草稿确认，避免绕过父页面顶部切换保护。
- 第二百五十五轮修复 Workbench 顶栏 `Drafts` 入口跨过滤 / 跨 timeline 窗口找回草稿的问题：草稿 slice id 不再只依赖当前 `slices`，缺失 slice 会通过 `GET /slices/:sliceId` 懒加载回来。
- 第二百五十六轮修复主 Workbench 保存 metadata / mutation value 后当前 slice 被过滤挡走的问题：保存 editSlice 成功后会清理会隐藏该 slice 的 subject / kind / search / status 过滤，避免主画布跳到别的 slice。
- 第二百五十七轮稳定真实 Workbench Review Queue 的持久 issue key：确认 / 忽略状态不再依赖 issue 数组下标，刷新或编辑导致 issue 顺序变化时不会把同一 issue 掉回 open。
- 第二百五十八轮继续稳定真实 Workbench Review Queue 的 triage 继承：transient issue 后续变成 persisted slice issue 时，会按业务 identity 继承确认 / 忽略状态。
- 第二百五十九轮修复真实 Workbench Inspector metadata 保存失败时草稿丢失的问题：`applyPatch` 不再在 API 保存前删除 draft，外部 slice 成功同步后才自动清理。
- 旧 simulation workflow 暂不接入。

## Decisions / Discussion

### 已明确：时间真相源（本轮定论，后续讨论以此为依据）

- **唯一时间真相源 = 一个 BigInt 时间戳 `Instant`**：表示「自世界零点起经过的基准刻数」，可正可负。
  - 序列化为字符串存储（避免 JSON number 精度丢失）。
  - 比较运算用 BigInt 原生 `<` / `>` / `===`，全局可比较，timeline 排序与 reduce 截断都只依赖它。
- **零点 `Instant = 0n`** = 作者命名的世界元年起点（类比公元元年 / Unix epoch）。`Instant < 0` 天然表示「零点前」，不需要额外字段。
  - 注意：连续数轴**不继承公历「无第 0 年」的历史 bug**，底层永远连续；默认 Calendar 允许 `0年` 和负 year 表示零点前时间。若显示层需要无第 0 年的纪年法，由后续日历换算扩展处理。
- **基准刻粒度 = 1 秒**（1 刻 = 1 秒）。理由：直觉、好调试；以秒为刻，BigInt 可覆盖到量劫级（~2920 亿年），即便普通 JS number 也能到 ~2.85 亿年。
- **数值范围结论**：量劫级跨度普通 int/number 不够 → 底层用 BigInt；这是「int 不够」直觉成立的根因。

```typescript
// 唯一真值源：自零点起的基准刻（秒）数，可负。持久化为 string。
type Instant = bigint;
```

### 已明确：格式化 / 日历是独立显示模块

- **时间的格式化（「复兴纪元 488 年 风信之月 15 日 14:00」这类人读字符串）属于一个单独的显示模块**，不是时间真相源的一部分，后续可以持续调整、替换，不影响已存的 `Instant` 数据。
- 切面底层**只存 `instant`**（+ 后续可能的模糊时间字段），人读字符串由显示模块实时 format，不落盘。这样改历法 / 改月份名 / 改一天小时数都不需要迁移已有数据。
- **Calendar 可配置 parse/format 进入第一版工具层**：Agent 工具收发人读时间字符串，不直接传 BigInt / 十进制 instant。第一版允许项目像常见日期格式化库一样，自定义序列化 / 反序列化格式；完整不规则历法、模糊时间和复杂自然语言时间可后续再做。
  - 自定义 `format` 里的可解析时间字段不能重复；`{hour}` 与 `{hour:02}`、`{minute}` 与 `{minute:02}`、`{second}` 与 `{second:02}` 分别视为同一字段。
  - `calendar.yaml` 显式存在时必须是 object；空文件 / 缺文件使用默认 Calendar。显式配置 `era` 时必须是字符串。Calendar 单位配置如果用 YAML number，必须是 JS safe integer 正整数；超过 safe integer 的大整数必须写成字符串，字符串形式也必须大于 0，避免 YAML number 解析阶段丢精度。
- 显示模块（Calendar）的后续完整构想：
  - 自定义单位层级（每层定义含多少下层单位），如 36 小时制 = 一天 36 时。
  - format 用模板 + 占位符配置（如 `"{epoch}{year}年 {month}{day}日 {hour:02}:{minute:02}"`），不写死。
  - 需要内置一套**现实公元纪年法（gregorian）**供用户开箱即用（含大小月 / 闰年规则）→ 因此层级进位需支持**不规则进位**（perChild 可为函数），不规则换算用预计算累加表 + 缓存。
  - 还需一套全固定进位的**幻想简明历**预设供复制改造。
  - 量劫：恒定长度 → 日历最高层 unit；长度不固定 → 走模糊时间。

### 待讨论：模糊时间（已有初步构想，未定论）

- 需求确定要支持「三百年前」「很久以前」这类模糊时间。
- 初步构想（未定论）：时间点是 `exact / fuzzy(anchor ± span, relativeTo) / unknown(before/after)` 三态；模糊比较返回「确定早 / 确定晚 / 区间重叠无法确定」三态，重叠时引擎可提示作者确认先后。
- 该方案是否纳入第一版、如何与切面结合，留待后续。

### 已明确：切面 + reduce = 事件溯源（Event Sourcing），增量模型

- **核心范式**：世界不存「当前状态」，只存「切面序列」；任意时刻世界状态 = 该时刻前所有切面按 `instant` 排序后 reduce 出来的结果。这是经典 event sourcing。
- **切面是增量（delta / mutation），不是全量快照**。理由：核心诉求是「往前插切面补历史 / 补设定」，全量快照在往前插时会让后续快照全部失效，增量模型则让后续变更自然叠加。这是被需求锁定的结论。
- **增量模型的代价 + 留口**：reduce 成本随切面数线性增长。第一版可不做优化，但模型要给 **snapshot checkpoint（每隔 N 个切面缓存一份全量状态，reduce 从最近缓存往后叠）** 留位置。
- **同一 `instant` 只能有一个切面**：禁止同一时间点出现多个 `WorldSlice`。同一刻发生的多 subject / 多属性变化必须属于同一个 slice 的 `mutations`。第一版没有「写入时自动合并同 instant」的流程：`writeSlice` 遇到目标 instant 已存在会报错；修改已有时间点走 `editSlice`。`createSubject` 的 init mutation 是初始化特例：如果 init instant 已有 `kind=init` slice，会追加到该 init slice；如果已有非 init slice，则拒绝自动追加。reduce 排序只需要 `instant ASC` + slice 内 `mutation.seq ASC`。
- **切面结构（草图，字段后续可调）**：

```typescript
// 一个切面 = 一个时间点 + 一组对若干 subject 的变更
interface Slice {
    id: string;
    instant: string;          // BigInt 时间戳（唯一时间真相源）
    title: string;            // 人读标题
    summary?: string;
    mutations: Mutation[];    // 这一刻发生的所有变更
}

// 一条变更：对某 subject 的某属性做某操作
interface Mutation {
    subjectId: string;        // 改谁（人物 / 王国 / 任务 / 背包…）
    attr: string;             // 改它的哪个属性（由 subject 类型 schema 声明）
    change: unknown;          // 变更数据；如何叠加由该 attr 绑定的 reducer 决定
}
```

### 已明确：reducer 按属性绑定，schema 是项目级资产

- **引擎不预设世界观**。引擎层只认识抽象概念（`Subject` / `Slice` / `Instant` / `Mutation` / `op` / `reduce()`），不知道「HP」「魔力」是什么。世界观差异全部由**项目自己的 schema** 表达。引擎对项目 schema 的关系 ≈ SQLite 引擎对你的表结构。
- **schema 定义方式（定论）**：项目内 **YAML/JSON 配置文件**，放 Project Workspace（目录待定），**按「类型」声明**（character / quest / location / item…，subject 是某类型实例，100 个 NPC 共享一份 character schema），运行时 TypeBox 校验。

### 已明确：op 全集 + reduce 语义（第一版不做通用 rollback）

- **取消 track**。之前的 track（记新老）是误设计。hp 就是普通 `set` / `add`；历史曲线来自切面序列，不需要特殊 op。
- **第一版不做通用 rollback / revert slice**。当前“回退”入口是 `deleteSlice` 物理删除某个切面，然后重新 reduce；删除不可恢复，后端不会用旧值字段做 O(1) 逆操作。
- **「HP 曲线 / 成长史」不需要专门存储**：遍历所有打在 `hp` 上的 mutation（每条带 instant + 值）天然是时间序列。reduce 出「当前值」与 reduce 出「历史轨迹」用同一批切面数据，只是聚合方式不同。
- **op 全集**：

| op | 作用 | reduce 语义 |
| --- | --- | --- |
| `set` | 设单值（含覆盖、含嵌套路径） | 后写覆盖前值 |
| `add` | 数值相对增量（scalar 数值专用） | 基于当前数值累加；缺基返回 `broken-relative` |
| `unset` | 删除一个属性 / 键 | 删除当前路径 |
| `listAppend` | **只增的有序流**追加（events 经历） | 基于当前 list 追加；缺基返回 `broken-relative` |
| `collectionAdd` | **可增删无序集合**加元素（背包、附魔、宗门弟子） | 基于当前 collection 按稳定 JSON 去重追加 |
| `collectionRemove` | 可增删无序集合删元素 | 基于当前 collection 按稳定 JSON 删除；缺基 / 不存在返回 `broken-relative` |

  - **`add` 的价值是架构性的**：可交换、对「往前插切面」更稳定（前面插变更不改变后续 add 增量）。set 是绝对值、对插入敏感；第一版用 `base-shifted` / `masked` issues 提醒作者确认语义，不自动改写后续切面。
  - **`listAppend` 与 `collection*` 必须分开**：append 是只增有序流（逆 = 砍末尾）；collection 是可增删无序集合（逆 = 反向增删）。
  - schema 每个属性绑定 **kind**（`scalar` / `list` / `collection` / `object`）决定它接受哪些 op、如何叠加、如何逆。`object` 统一了固定结构（声明 fields）与开放字典（只声明 itemType），不再分 map/object。详见 [schema-design.md](schema-design.md)。

### 已明确：mutation 不存旧值字段；issues 是一致性反馈通道

- **存储形态（当前定论）**：切面 mutation 持久化为 `op + value`，不存旧值字段，不维护后端派生改写缓存。声明式 mutation 序列是唯一真相源，任意时刻状态都由 reduce 得到。
- **E/A issues**：issue 字段、完整 code catalog、E/A taxonomy 和作者可见解释以 [reference/world-engine/issues.md](../../../reference/world-engine/issues.md) 为准。当前处理口诀是：`severity: "error"` 表示持久数据错误，必须修；`severity: "advisory"` 表示补过去或编辑旧时间点的一次性提醒，确认语义即可。UI / Agent 应使用后端返回的 `title`、`message`、`explanation`，不要自行按 code 生成文案。
- **第一版回退能力**：提供 `deleteSlice` 物理删除切面，返回删除后受影响 subject 的 E issues；不做可恢复撤销、不做自动补写、不自动改写后续切面。
- **subject 身份采用稳定登记语义**：删除唯一 slice 后仍保留 `WorldSubject`，不因 patch 数量归零而自动回收；后续同 id 写入复用原 type/name，且不重新应用 schema default。第一版不增加通用 `subject.delete()`，因为当前 `WorldPatch.subjectId` 为级联外键，生产删除会跨历史切面抹除 patch，并可能破坏 Plot anchor 与 `subject://id` 引用。
- **验收与孤儿清理边界**：会写 World Engine 的 leader/browser smoke 必须使用隔离临时 Project，并在结束时整体删除，不得把测试 subject 写入长期 Project。既有空身份只允许使用 `scripts/maintenance/cleanup-empty-world-subject.ts` 做一次性维护：默认 dry-run，要求精确 id/type/name，检查自身 patch、所有 WorldPatch JSON ref 与 StoryScene anchor 均为零；只有显式 `--apply` 才在事务中删除。该脚本不是生产 API，也不得用于非空 subject。本轮只提供工具与合同，不自动执行真实清理。

### 已明确：嵌套属性 + 引用规则

- **嵌套属性：支持，用「路径」表达更新**。`attr` 是路径字符串，天然支持点号深入：

```yaml
# schema：嵌套结构
character:
  attrs:
    equipment:
      type: object
      fields:
        head:  { type: ref(item) }   # 装备槽位
        chest: { type: ref(item) }
```

  - 更新单槽位 = `{ subjectId, attr: "equipment.head", op: set, value: ref("钢盔") }`，只影响 weapon 槽位。
  - **允许整体替换**：`set equipment = {...}`（覆盖整个 equipment）vs `set equipment.head`（只覆盖 head），都用 `set`，区别在路径深浅。日常优先打**细路径**保留逐槽位历史；整体替换留给「换一整套装备」这类真整体操作。

- **引用规则（定论）**：
  1. **不双向冗余存**：关系只在一边存（人物的 `equipment.head = ref(钢盔)`）。「这把剑被谁装备」靠**反查**（遍历找 `equipment.* == 钢盔`），不让装备自己再存 `equippedBy`。否则两边要同步，切面回退极易不一致 —— 即「引用不要滥用」。
  2. **reduce 不自动解引用（惰性显式解）**：`reduce(艾莉娜, t).equipment.head` 返回 `ref("钢盔")` 引用值本身，**不**把钢盔状态嵌进来。要钢盔状态调用方自己再 `reduce(钢盔, t)`。原因：自动解引用引发递归、循环引用、「解到哪层停」难题。**reduce 永远只算单个 subject，指针不自动跟进去；谁要关联视图谁自己组合多个 reduce 结果。**

### 已明确：用真实例子验证模型（结论：模型站得住）

- **魔幻人物**：character schema 用 hp/level/mp(track)、location(set→ref)、memory(merge by topic)、events(append)、mind(set) 表达，全部成立。换现代都市世界只改 schema（去 mp/level，加 phone_battery/bank_balance），引擎代码不改。
- **任务状态**：quest **本身是一个 subject**（status:set / progress:track / log:append / giver:set→ref）。**原则：能独立演变状态的东西就是 subject，不论是不是「人」** —— 印证最初「王国、大陆也是 subject」。
- **subject 关联**：关系不是独立第三种东西，就是一个 reducer 为 `set` / 值为「指向另一 subject 的引用 ref」的属性（location→ref(location)、giver→ref(subject)）。关系随时间演变自动纳入切面 + reduce。
- **背包是不是 subject**：判断标准 = 它有没有「独立的、需随时间追踪的状态/信息」。普通背包 = 人物的一个 `collection` 属性；特殊背包（诅咒口袋、会损坏的须弥戒）有独立状态 → 独立 subject/entity，内含物用 `contains: ref[]` 关联。这与现有 simulation entity 规则一致。

### 待讨论（尚未定论）

1. timeline 容器本身的数据结构（snapshot checkpoint 优化的接入点）。**存储已定：schema = 项目配置文件不进 SQLite，Project SQLite 只存切片，与 plot 表共库；同一 instant 只允许一个切面。**
2. subject 实例的注册 / 创建（subject 身份存哪、与 schema 类型绑定；是否用「初始化切面」承载身份）。
3. 模糊时间（fuzzy / unknown）如何落到 instant INTEGER。

**已定方向（不再讨论）**：
- 校验**宽松**：mutation 可打未声明属性（动态属性），未知属性默认 scalar。
- `map`/`object` 合并为 `object`（有 fields = 固定结构，无 fields 只有 itemType = 开放字典）。
- scalar 数值支持 **set + add**。
- **default 进切面**：subject 创建时如果 schema 声明了非空 `default`，生成或追加「初始化切面」写入初值；没有 default 时只注册 subject 身份，不创建空切面。schema default 的纯形状 / 类型错误在 schema 加载期暴露；ref default 的目标存在性仍在创建 subject 写 init mutation 时校验。切面序列保存已声明的初值。
- **文件组织**：世界引擎配置放 Project Workspace 顶层 **`world-engine/`**（`schema.yaml` 等）；切面 / mutation / subject 实例全在 Project SQLite（与 plot 共库，`World*` 前缀）。
- **ref 格式**：`subject://<id>`（纯 id，不编码 type），对齐 `{kind}://{targetId}` 惯例，单一 scheme 覆盖所有 subject 类型。subject id 不能为空，也不能包含首尾空白；写入 `subject://<id>` 时内部 `<id>` 同样遵守该规则。调用方应在创建 subject、写入 mutation、写入 ref 和查询 subjectIds 前显式修正输入。
- **subject type 稳定 key**：schema subject type 名不能为空，也不能包含空白或括号；运行时 `createSubject(type)`、`queryState(type)`、`listWorldSubjects(type)` 也复用同一规则。类型名是创建 subject、按 type 查询与 `ref(type)` 校验的稳定 key；schema 中 `ref(type)` 必须指向已声明的 subject type。
- **schema attr 名 / attr path**：schema attr 名不能为空，不能包含首尾空白或点号；点号只作为运行时 attr path 的段分隔符。运行时写入 / 查询 attr path 每段必须非空且不能包含首尾空白，开放 object key 仍可使用中文等稳定段名（如 `memory.师门`）。
- **slice kind 标签**：`WorldSlice.kind` 是 timeline / UI / 日志过滤标签，不参与 reduce；允许项目自定义，省略时默认 `event`，但显式传入时不能为空，也不能包含首尾空白。
- **sliceId 入参**：`sliceId` 由后端生成，调用 `editSlice` / `deleteSlice` / HTTP path / Agent 工具时必须原样传回；不能为空，也不能包含首尾空白，HTTP path 不做静默裁剪。
- **HTTP query 参数**：World Engine HTTP API 的 query 参数不做静默裁剪；空字符串视为未传，带首尾空白的 `type` / `limit` / `withMutations` / `at` / `from` / `to` 会按对应规则返回 400；重复 query 形成数组时返回 `${key} 只能传一个值`。
- **存储 / API（第一版最小）**：3 表（WorldSubject / WorldSlice / WorldMutation）；mutation 一行一条且不存旧值字段；`WorldSlice.instant` 唯一；instant 用 INTEGER 64 位；API 包含 `createSubject` / `writeSlice` / `editSlice` / `deleteSlice` / `getWorldState` / `queryState` / `listSlices`。`queryState` 是 Agent 与常规业务入口，`getWorldState` 只给 UI / 调试 / 导出使用；写 / 编辑 / 删除 / 查询均通过 `issues` 暴露 E/A 问题。snapshot、属性历史、反查引用推后；不自动改写后续切面。详见 [sqlite-and-api.md](sqlite-and-api.md)。
- **与 simulation 关系**：世界引擎是全新独立系统，当前与 `simulation/` 无关；simulation 目录**暂不删除、暂不迁移**，后续慢慢迁移。世界状态完全由切面 reduce 得来，不再有 subject 文件作为状态源。
- **与 plot 关系**：plot 同样暂不删除；未来定位为 Novel 模式「故事 → 小说结构」编排层，切面管「发生了什么」，plot 管「怎么讲成小说」。
- **RAG**：单独成系统、世界引擎的下游消费者，不跟随 schema；第一版不实现，kind 设计已支持后续订阅。详见 [schema-design.md](schema-design.md)。
- **Agent 时间边界**：Agent 工具收发格式化时间字符串，不直接传 BigInt / 十进制 instant。工具层通过 Calendar parse/format 转换到 facade 的 `Instant`。
- **回滚边界**：现有 simulation rollback 方案不作为当前依赖，世界引擎第一版不承诺 tick rollback / revert slice。
- **schema 演化边界**：第一版不做 schema 版本化或历史 mutation 自动迁移。schema 是当前项目合同；修改 schema 后如影响旧 mutation，先由作者 / Agent 显式修正。

## 待讨论：模糊时间（已有初步构想，未定论）

- 需求确定要支持「三百年前」「很久以前」这类模糊时间。
- 初步构想（未定论）：时间点是 `exact / fuzzy(anchor ± span, relativeTo) / unknown(before/after)` 三态；模糊比较返回「确定早 / 确定晚 / 区间重叠无法确定」三态，重叠时引擎可提示作者确认先后。
- 该方案是否纳入第一版、如何与切面结合，留待后续。

## Verification / Test

- 第一版重点验证：时间比较、reduce 截断、同 instant 写入冲突、`editSlice`、`deleteSlice`、E/A issues、`dangling-ref`、`queryState` 投影与 `listLimit`。

## Implementation Walkthrough

- [walkthroughs/2026-06-19-round-01-core.md](walkthroughs/2026-06-19-round-01-core.md)：第一轮后端核心实现。
- [walkthroughs/2026-06-19-round-02-agent-tools.md](walkthroughs/2026-06-19-round-02-agent-tools.md)：第二轮 Agent 工具接入。
- [walkthroughs/2026-06-19-round-03-profile-and-demo.md](walkthroughs/2026-06-19-round-03-profile-and-demo.md)：第三轮 profile 接入与真实 Project 试用。
- [walkthroughs/2026-06-19-round-04-http-api.md](walkthroughs/2026-06-19-round-04-http-api.md)：第四轮 HTTP API 接入。
- [walkthroughs/2026-06-19-round-05-project-template.md](walkthroughs/2026-06-19-round-05-project-template.md)：第五轮默认 Project 模板接入。
- [walkthroughs/2026-06-19-round-06-frontend-preview.md](walkthroughs/2026-06-19-round-06-frontend-preview.md)：第六轮前端 preview 调试入口。
- [walkthroughs/2026-06-19-round-07-preview-review-fixes.md](walkthroughs/2026-06-19-round-07-preview-review-fixes.md)：第七轮 preview 审查修复。
- [walkthroughs/2026-06-19-round-08-mutation-builder.md](walkthroughs/2026-06-19-round-08-mutation-builder.md)：第八轮 preview Mutation Builder。
- [walkthroughs/2026-06-19-round-09-resettle-feedback.md](walkthroughs/2026-06-19-round-09-resettle-feedback.md)：第九轮 preview re-settle 反馈。
- [walkthroughs/2026-06-19-round-10-preview-demo-seed.md](walkthroughs/2026-06-19-round-10-preview-demo-seed.md)：第十轮 preview 一键示例世界。
- [walkthroughs/2026-06-19-round-11-preview-demo-review-fixes.md](walkthroughs/2026-06-19-round-11-preview-demo-review-fixes.md)：第十一轮 preview 示例世界审查修复。
- [walkthroughs/2026-06-19-round-12-preview-demo-api-example-test.md](walkthroughs/2026-06-19-round-12-preview-demo-api-example-test.md)：第十二轮 preview 示例 API 级真实例子测试。
- [walkthroughs/2026-06-19-round-13-preview-demo-helper-tests.md](walkthroughs/2026-06-19-round-13-preview-demo-helper-tests.md)：第十三轮 preview 示例 helper 抽取与测试。
- [walkthroughs/2026-06-19-round-14-preview-builder-review-fixes.md](walkthroughs/2026-06-19-round-14-preview-builder-review-fixes.md)：第十四轮 preview Mutation Builder 审查修复。
- [walkthroughs/2026-06-19-round-15-preview-ref-defaults.md](walkthroughs/2026-06-19-round-15-preview-ref-defaults.md)：第十五轮 preview ref 默认值优化。
- [walkthroughs/2026-06-19-round-16-preview-scalar-op-fix.md](walkthroughs/2026-06-19-round-16-preview-scalar-op-fix.md)：第十六轮 preview scalar op 审查修复。
- [walkthroughs/2026-06-19-round-17-core-add-validation-fix.md](walkthroughs/2026-06-19-round-17-core-add-validation-fix.md)：第十七轮后端核心 add 校验修复。
- [walkthroughs/2026-06-19-round-18-query-state-missing-subjects.md](walkthroughs/2026-06-19-round-18-query-state-missing-subjects.md)：第十八轮 queryState 缺失 subjectIds 修复。
- [walkthroughs/2026-06-19-round-19-default-validation-rollback.md](walkthroughs/2026-06-19-round-19-default-validation-rollback.md)：第十九轮 schema default 校验与事务回滚测试。
- [walkthroughs/2026-06-19-round-20-empty-mutations-guard.md](walkthroughs/2026-06-19-round-20-empty-mutations-guard.md)：第二十轮空 mutations 核心防线。
- [walkthroughs/2026-06-19-round-21-schema-kind-validation.md](walkthroughs/2026-06-19-round-21-schema-kind-validation.md)：第二十一轮 schema attr kind 校验。
- [walkthroughs/2026-06-19-round-22-schema-structure-validation.md](walkthroughs/2026-06-19-round-22-schema-structure-validation.md)：第二十二轮 schema 结构校验。
- [walkthroughs/2026-06-19-round-23-calendar-config-validation.md](walkthroughs/2026-06-19-round-23-calendar-config-validation.md)：第二十三轮 calendar 配置校验。
- [walkthroughs/2026-06-19-round-24-list-limit-schema-aware.md](walkthroughs/2026-06-19-round-24-list-limit-schema-aware.md)：第二十四轮 queryState.listLimit schema-aware 裁剪。
- [walkthroughs/2026-06-19-round-25-schema-projection-default-enum.md](walkthroughs/2026-06-19-round-25-schema-projection-default-enum.md)：第二十五轮 schema 投影 default / enum 补齐。
- [walkthroughs/2026-06-19-round-26-schema-enum-default-validation.md](walkthroughs/2026-06-19-round-26-schema-enum-default-validation.md)：第二十六轮 schema enum/default 配置校验。
- [walkthroughs/2026-06-19-round-27-schema-type-validation.md](walkthroughs/2026-06-19-round-27-schema-type-validation.md)：第二十七轮 schema type/itemType 配置校验。
- [walkthroughs/2026-06-19-round-28-object-value-validation.md](walkthroughs/2026-06-19-round-28-object-value-validation.md)：第二十八轮 object set/default 子值校验。
- [walkthroughs/2026-06-19-round-29-schema-attr-shape-validation.md](walkthroughs/2026-06-19-round-29-schema-attr-shape-validation.md)：第二十九轮 schema attr kind/type/itemType/fields 组合约束。
- [walkthroughs/2026-06-19-round-30-unset-value-validation.md](walkthroughs/2026-06-19-round-30-unset-value-validation.md)：第三十轮 unset value 输入语义校验。
- [walkthroughs/2026-06-19-round-31-required-mutation-value.md](walkthroughs/2026-06-19-round-31-required-mutation-value.md)：第三十一轮非 unset mutation 必须显式提供 value。
- [walkthroughs/2026-06-19-round-32-edit-slice-metadata-resettle.md](walkthroughs/2026-06-19-round-32-edit-slice-metadata-resettle.md)：第三十二轮 editSlice 元数据编辑 re-settle 误报修复。
- [walkthroughs/2026-06-19-round-33-stable-json-compare.md](walkthroughs/2026-06-19-round-33-stable-json-compare.md)：第三十三轮 stable JSON 语义比较。
- [walkthroughs/2026-06-19-round-34-enum-canonical-compare.md](walkthroughs/2026-06-19-round-34-enum-canonical-compare.md)：第三十四轮 enum canonical JSON 校验。
- [walkthroughs/2026-06-19-round-35-strict-query-integer.md](walkthroughs/2026-06-19-round-35-strict-query-integer.md)：第三十五轮 HTTP query 正整数严格解析。
- [walkthroughs/2026-06-19-round-36-finite-number-validation.md](walkthroughs/2026-06-19-round-36-finite-number-validation.md)：第三十六轮 finite number 校验。
- [walkthroughs/2026-06-19-round-37-json-value-guard.md](walkthroughs/2026-06-19-round-37-json-value-guard.md)：第三十七轮通用 JSON value 防线。
- [walkthroughs/2026-06-19-round-38-attr-path-validation.md](walkthroughs/2026-06-19-round-38-attr-path-validation.md)：第三十八轮 attr path 空段校验。
- [walkthroughs/2026-06-19-round-39-query-attr-path-validation.md](walkthroughs/2026-06-19-round-39-query-attr-path-validation.md)：第三十九轮 query attrs 路径校验。
- [walkthroughs/2026-06-19-round-40-list-limit-validation.md](walkthroughs/2026-06-19-round-40-list-limit-validation.md)：第四十轮 listLimit service 层校验。
- [walkthroughs/2026-06-19-round-41-list-slices-limit-validation.md](walkthroughs/2026-06-19-round-41-list-slices-limit-validation.md)：第四十一轮 listSlices.limit service 层校验。
- [walkthroughs/2026-06-19-round-42-list-slices-range-validation.md](walkthroughs/2026-06-19-round-42-list-slices-range-validation.md)：第四十二轮 listSlices range 校验。
- [walkthroughs/2026-06-19-round-43-resettle-subjects-validation.md](walkthroughs/2026-06-19-round-43-resettle-subjects-validation.md)：第四十三轮 resettle subjectIds 校验。
- [walkthroughs/2026-06-19-round-44-preview-resettle-ready.md](walkthroughs/2026-06-19-round-44-preview-resettle-ready.md)：第四十四轮 Preview resettle 提交条件。
- [walkthroughs/2026-06-19-round-45-browser-e2e-bigint-warning.md](walkthroughs/2026-06-19-round-45-browser-e2e-bigint-warning.md)：第四十五轮浏览器实跑与 BigInt warning 修复。
- [walkthroughs/2026-06-19-round-46-preview-project-filter.md](walkthroughs/2026-06-19-round-46-preview-project-filter.md)：第四十六轮 Preview Project 搜索过滤。
- [walkthroughs/2026-06-19-round-47-preview-resettle-result.md](walkthroughs/2026-06-19-round-47-preview-resettle-result.md)：第四十七轮 Preview resettle 结果反馈。
- [walkthroughs/2026-06-19-round-48-resettle-hint-scope.md](walkthroughs/2026-06-19-round-48-resettle-hint-scope.md)：第四十八轮 Preview resettle 提示范围修正。
- [walkthroughs/2026-06-19-round-49-main-ide-entry.md](walkthroughs/2026-06-19-round-49-main-ide-entry.md)：第四十九轮主 IDE Header 入口。
- [walkthroughs/2026-06-19-round-50-main-ide-workbench.md](walkthroughs/2026-06-19-round-50-main-ide-workbench.md)：第五十轮主 IDE 内嵌 World Engine Workbench。
- [walkthroughs/2026-06-19-round-51-workbench-mutation-editor.md](walkthroughs/2026-06-19-round-51-workbench-mutation-editor.md)：第五十一轮 Workbench mutation 写入 / 编辑器。
- [walkthroughs/2026-06-19-round-52-workbench-subject-dirty-guard.md](walkthroughs/2026-06-19-round-52-workbench-subject-dirty-guard.md)：第五十二轮 Workbench 创建 subject 与 dirty guard。
- [walkthroughs/2026-06-19-round-53-schema-aware-builder.md](walkthroughs/2026-06-19-round-53-schema-aware-builder.md)：第五十三轮 schema-aware Mutation Builder value 控件。
- [walkthroughs/2026-06-19-round-54-workbench-attr-path.md](walkthroughs/2026-06-19-round-54-workbench-attr-path.md)：第五十四轮 Workbench Mutation Builder attr path 输入。
- [walkthroughs/2026-06-19-round-55-workbench-pending-resettle.md](walkthroughs/2026-06-19-round-55-workbench-pending-resettle.md)：第五十五轮 Workbench pending re-settle 顶部动作。
- [walkthroughs/2026-06-19-round-56-workbench-slice-state-query.md](walkthroughs/2026-06-19-round-56-workbench-slice-state-query.md)：第五十六轮 Workbench selected slice 时刻状态查询。
- [walkthroughs/2026-06-19-round-57-workbench-slice-subjects-query.md](walkthroughs/2026-06-19-round-57-workbench-slice-subjects-query.md)：第五十七轮 Workbench selected slice 触及主体批量状态查询。
- [walkthroughs/2026-06-19-round-58-workbench-timeline-subject-filter.md](walkthroughs/2026-06-19-round-58-workbench-timeline-subject-filter.md)：第五十八轮 Workbench timeline 当前 subject 过滤。
- [walkthroughs/2026-06-19-round-59-workbench-slice-subject-chips.md](walkthroughs/2026-06-19-round-59-workbench-slice-subject-chips.md)：第五十九轮 Workbench selected slice 触及主体快捷选择。
- [walkthroughs/2026-06-19-round-60-workbench-state-summary.md](walkthroughs/2026-06-19-round-60-workbench-state-summary.md)：第六十轮 Workbench State Query 摘要视图。
- [walkthroughs/2026-06-19-round-61-workbench-state-summary-component.md](walkthroughs/2026-06-19-round-61-workbench-state-summary-component.md)：第六十一轮 Workbench State Summary 组件拆分。
- [walkthroughs/2026-06-19-round-62-workbench-slice-inspector-component.md](walkthroughs/2026-06-19-round-62-workbench-slice-inspector-component.md)：第六十二轮 Workbench Selected Slice 检查器组件拆分。
- [walkthroughs/2026-06-19-round-63-workbench-timeline-search.md](walkthroughs/2026-06-19-round-63-workbench-timeline-search.md)：第六十三轮 Workbench Timeline 搜索过滤。
- [walkthroughs/2026-06-19-round-64-workbench-timeline-component.md](walkthroughs/2026-06-19-round-64-workbench-timeline-component.md)：第六十四轮 Workbench Timeline 组件拆分。
- [walkthroughs/2026-06-19-round-65-workbench-object-value-builder.md](walkthroughs/2026-06-19-round-65-workbench-object-value-builder.md)：第六十五轮 Workbench object value 行编辑器。
- [walkthroughs/2026-06-19-round-66-schema-fields-projection.md](walkthroughs/2026-06-19-round-66-schema-fields-projection.md)：第六十六轮 schema fields / itemType 投影。
- [walkthroughs/2026-06-19-round-67-workbench-object-fields-form.md](walkthroughs/2026-06-19-round-67-workbench-object-fields-form.md)：第六十七轮 Workbench 固定 object fields 子表单。
- [walkthroughs/2026-06-19-round-68-object-fields-enable-guard.md](walkthroughs/2026-06-19-round-68-object-fields-enable-guard.md)：第六十八轮固定 object fields 启用字段保护。
- [walkthroughs/2026-06-19-round-69-mutation-builder-component.md](walkthroughs/2026-06-19-round-69-mutation-builder-component.md)：第六十九轮 Workbench Mutation Builder 组件拆分。
- [walkthroughs/2026-06-19-round-70-builder-load-first-mutation.md](walkthroughs/2026-06-19-round-70-builder-load-first-mutation.md)：第七十轮 Builder 载入首条 mutation。
- [walkthroughs/2026-06-19-round-71-builder-load-selected-mutation.md](walkthroughs/2026-06-19-round-71-builder-load-selected-mutation.md)：第七十一轮 Builder 选择载入 mutation。
- [walkthroughs/2026-06-19-round-72-builder-replace-selected-mutation.md](walkthroughs/2026-06-19-round-72-builder-replace-selected-mutation.md)：第七十二轮 Builder 替换所选 mutation。
- [walkthroughs/2026-06-19-round-73-builder-delete-selected-mutation.md](walkthroughs/2026-06-19-round-73-builder-delete-selected-mutation.md)：第七十三轮 Builder 删除所选 mutation。
- [walkthroughs/2026-06-19-round-74-builder-move-selected-mutation.md](walkthroughs/2026-06-19-round-74-builder-move-selected-mutation.md)：第七十四轮 Builder 上移 / 下移所选 mutation。
- [walkthroughs/2026-06-19-round-75-builder-selection-sync.md](walkthroughs/2026-06-19-round-75-builder-selection-sync.md)：第七十五轮 Builder mutation 选择索引同步。
- [walkthroughs/2026-06-19-round-76-editor-mutation-validation-guard.md](walkthroughs/2026-06-19-round-76-editor-mutation-validation-guard.md)：第七十六轮 Editor mutations 提交护栏。
- [walkthroughs/2026-06-19-round-77-mutation-list-utils.md](walkthroughs/2026-06-19-round-77-mutation-list-utils.md)：第七十七轮 mutation list 操作纯函数与行为测试。
- [walkthroughs/2026-06-19-round-78-mutation-list-controls-component.md](walkthroughs/2026-06-19-round-78-mutation-list-controls-component.md)：第七十八轮 Mutation List Controls 组件拆分。
- [walkthroughs/2026-06-19-round-79-mutation-action-buttons-component.md](walkthroughs/2026-06-19-round-79-mutation-action-buttons-component.md)：第七十九轮 Mutation Action Buttons 组件拆分。
- [walkthroughs/2026-06-19-round-80-object-value-editor-component.md](walkthroughs/2026-06-19-round-80-object-value-editor-component.md)：第八十轮 Object Value Editor 组件拆分。
- [walkthroughs/2026-06-19-round-81-nested-object-json-field.md](walkthroughs/2026-06-19-round-81-nested-object-json-field.md)：第八十一轮固定 object fields 嵌套 object JSON 输入。
- [walkthroughs/2026-06-19-round-82-nested-object-json-validation.md](walkthroughs/2026-06-19-round-82-nested-object-json-validation.md)：第八十二轮嵌套 object JSON 提交前校验。
- [walkthroughs/2026-06-19-round-83-item-type-value-mode.md](walkthroughs/2026-06-19-round-83-item-type-value-mode.md)：第八十三轮 list / collection itemType value 推导。
- [walkthroughs/2026-06-19-round-84-preview-value-type-hint.md](walkthroughs/2026-06-19-round-84-preview-value-type-hint.md)：第八十四轮 Preview Mutation Builder value 类型提示。
- [walkthroughs/2026-06-19-round-85-preview-component-split.md](walkthroughs/2026-06-19-round-85-preview-component-split.md)：第八十五轮 Preview Project/Actions/Mutation Builder 组件拆分。
- [walkthroughs/2026-06-19-round-86-workbench-value-type-hint.md](walkthroughs/2026-06-19-round-86-workbench-value-type-hint.md)：第八十六轮 Workbench Mutation Builder value 类型提示。
- [walkthroughs/2026-06-19-round-87-builder-insert-after-selected.md](walkthroughs/2026-06-19-round-87-builder-insert-after-selected.md)：第八十七轮 Builder 插入所选 mutation 后方。
- [walkthroughs/2026-06-19-round-88-builder-duplicate-selected.md](walkthroughs/2026-06-19-round-88-builder-duplicate-selected.md)：第八十八轮 Builder 复制所选 mutation。
- [walkthroughs/2026-06-19-round-89-builder-json-value-mode.md](walkthroughs/2026-06-19-round-89-builder-json-value-mode.md)：第八十九轮 Builder 顶层 JSON object value mode。
- [walkthroughs/2026-06-19-round-90-open-object-item-type.md](walkthroughs/2026-06-19-round-90-open-object-item-type.md)：第九十轮开放 object 行 value 继承 itemType。
- [walkthroughs/2026-06-19-round-91-open-object-empty-key.md](walkthroughs/2026-06-19-round-91-open-object-empty-key.md)：第九十一轮开放 object 空 key 行保持普通输入。
- [walkthroughs/2026-06-19-round-92-open-object-key-trim.md](walkthroughs/2026-06-19-round-92-open-object-key-trim.md)：第九十二轮开放 object key trim 语义一致化。
- [walkthroughs/2026-06-19-round-93-mutation-editor-header-component.md](walkthroughs/2026-06-19-round-93-mutation-editor-header-component.md)：第九十三轮 Mutation Editor Header 组件拆分。
- [walkthroughs/2026-06-19-round-94-builder-op-preserve.md](walkthroughs/2026-06-19-round-94-builder-op-preserve.md)：第九十四轮 Builder 默认 value 刷新保留用户选择的 op。
- [walkthroughs/2026-06-19-round-95-collection-remove-state-options.md](walkthroughs/2026-06-19-round-95-collection-remove-state-options.md)：第九十五轮 collectionRemove 当前状态值下拉辅助。
- [walkthroughs/2026-06-19-round-96-collection-remove-value-sync.md](walkthroughs/2026-06-19-round-96-collection-remove-value-sync.md)：第九十六轮 collectionRemove 下拉 value 自动同步。
- [walkthroughs/2026-06-19-round-97-collection-remove-options-util.md](walkthroughs/2026-06-19-round-97-collection-remove-options-util.md)：第九十七轮 collectionRemove 候选项 util 与行为测试。
- [walkthroughs/2026-06-19-round-98-slice-draft-form-component.md](walkthroughs/2026-06-19-round-98-slice-draft-form-component.md)：第九十八轮 Slice Draft Form 组件拆分。
- [walkthroughs/2026-06-19-round-99-preview-state-panel-component.md](walkthroughs/2026-06-19-round-99-preview-state-panel-component.md)：第九十九轮 Preview State Panel 组件拆分。
- [walkthroughs/2026-06-19-round-100-preview-op-preserve.md](walkthroughs/2026-06-19-round-100-preview-op-preserve.md)：第一百轮 Preview Builder 默认 value 刷新保留用户选择的 op。
- [walkthroughs/2026-06-19-round-101-preview-collection-remove-options.md](walkthroughs/2026-06-19-round-101-preview-collection-remove-options.md)：第一百零一轮 Preview collectionRemove 当前状态候选下拉。
- [walkthroughs/2026-06-19-round-102-collection-remove-core-test.md](walkthroughs/2026-06-19-round-102-collection-remove-core-test.md)：第一百零二轮 collectionRemove 后端核心测试。
- [walkthroughs/2026-06-19-round-103-object-item-type-backend.md](walkthroughs/2026-06-19-round-103-object-item-type-backend.md)：第一百零三轮 object itemType 后端契约补齐。
- [walkthroughs/2026-06-19-round-104-open-object-item-type-object-fix.md](walkthroughs/2026-06-19-round-104-open-object-item-type-object-fix.md)：第一百零四轮开放 object itemType object 路径解析修复。
- [walkthroughs/2026-06-19-round-105-object-item-type-api-contract.md](walkthroughs/2026-06-19-round-105-object-item-type-api-contract.md)：第一百零五轮 object itemType API 契约测试。
- [walkthroughs/2026-06-19-round-106-open-object-item-type-frontend.md](walkthroughs/2026-06-19-round-106-open-object-item-type-frontend.md)：第一百零六轮开放 object itemType 前端投影对齐。
- [walkthroughs/2026-06-19-round-107-preview-object-value-guard.md](walkthroughs/2026-06-19-round-107-preview-object-value-guard.md)：第一百零七轮 Preview object value 提交护栏。
- [walkthroughs/2026-06-19-round-108-preview-attr-path-input.md](walkthroughs/2026-06-19-round-108-preview-attr-path-input.md)：第一百零八轮 Preview Builder 手写 attr path。
- [walkthroughs/2026-06-19-round-109-shared-object-value-guard.md](walkthroughs/2026-06-19-round-109-shared-object-value-guard.md)：第一百零九轮共享 object value 校验 util。
- [walkthroughs/2026-06-19-round-110-collection-remove-string-values.md](walkthroughs/2026-06-19-round-110-collection-remove-string-values.md)：第一百一十轮 collectionRemove 字符串候选值保真。
- [walkthroughs/2026-06-19-round-111-preview-demo-item-type-validation.md](walkthroughs/2026-06-19-round-111-preview-demo-item-type-validation.md)：第一百一十一轮示例世界预检按 itemType 判断值类型。
- [walkthroughs/2026-06-19-round-112-enum-string-values.md](walkthroughs/2026-06-19-round-112-enum-string-values.md)：第一百一十二轮 enum 下拉保留 JSON-like 字符串。
- [walkthroughs/2026-06-20-round-113-drop-resettle-ui-doc-sync.md](walkthroughs/2026-06-20-round-113-drop-resettle-ui-doc-sync.md)：第一百一十三轮移除前端旧后续处理交互、接入 issues/delete slice、同步 profile 与文档。
- [walkthroughs/2026-06-20-round-114-review-fixes.md](walkthroughs/2026-06-20-round-114-review-fixes.md)：第一百一十四轮代码审查修复一键示例世界 issue 反馈并清理当前文档旧交互表述。
- [walkthroughs/2026-06-20-round-115-keyword-cleanup.md](walkthroughs/2026-06-20-round-115-keyword-cleanup.md)：第一百一十五轮清理静态测试旧 token 字面量和 `delete_world_slice` 工具描述。
- [walkthroughs/2026-06-20-round-116-preview-action-issues.md](walkthroughs/2026-06-20-round-116-preview-action-issues.md)：第一百一十六轮代码审查修复独立 Preview action issues 展示语义。
- [walkthroughs/2026-06-20-round-117-create-subject-empty-slice.md](walkthroughs/2026-06-20-round-117-create-subject-empty-slice.md)：第一百一十七轮代码审查修复 `createSubject` 无 default 时创建空切面的问题。
- [walkthroughs/2026-06-20-round-118-contract-doc-sync.md](walkthroughs/2026-06-20-round-118-contract-doc-sync.md)：第一百一十八轮同步稳定设计文档与 Agent 工具描述。
- [walkthroughs/2026-06-20-round-119-template-demo-contract.md](walkthroughs/2026-06-20-round-119-template-demo-contract.md)：第一百一十九轮补强默认 Project 模板到一键示例世界的无浏览器链路测试。
- [walkthroughs/2026-06-20-round-120-workbench-demo-state-review.md](walkthroughs/2026-06-20-round-120-workbench-demo-state-review.md)：第一百二十轮代码审查修复主 IDE Workbench 一键示例世界首屏状态只显示单 subject 的问题。
- [walkthroughs/2026-06-20-round-121-state-lifecycle-review.md](walkthroughs/2026-06-20-round-121-state-lifecycle-review.md)：第一百二十一轮代码审查修复 Project 切换 / 空世界时的状态残留，并收口 Workbench mock preview typecheck 绕道。
- [walkthroughs/2026-06-20-round-122-create-subject-issues.md](walkthroughs/2026-06-20-round-122-create-subject-issues.md)：第一百二十二轮代码审查补齐 create subject 返回 issues 的前端展示。
- [walkthroughs/2026-06-20-round-123-create-subject-api-contract.md](walkthroughs/2026-06-20-round-123-create-subject-api-contract.md)：第一百二十三轮补强一键示例世界多 subject 创建 API DTO 断言，并显式化 Workbench mock reducer 的 collectionRemove 分支。
- [walkthroughs/2026-06-20-round-124-preview-create-subject-id-sync.md](walkthroughs/2026-06-20-round-124-preview-create-subject-id-sync.md)：第一百二十四轮修复独立 Preview 手动创建 subject 后续状态未使用后端返回 subjectId 的问题。
- [walkthroughs/2026-06-20-round-125-demo-conflict-message.md](walkthroughs/2026-06-20-round-125-demo-conflict-message.md)：第一百二十五轮改进一键示例世界已有 subject 类型冲突提示。
- [walkthroughs/2026-06-20-round-126-profile-default-contract.md](walkthroughs/2026-06-20-round-126-profile-default-contract.md)：第一百二十六轮修正 world.engine profile 的 create subject default 提示词，并同步 compiled artifact。
- [walkthroughs/2026-06-20-round-127-create-subject-tool-doc-contract.md](walkthroughs/2026-06-20-round-127-create-subject-tool-doc-contract.md)：第一百二十七轮收紧 `create_world_subject` 工具描述与稳定文档中的 default/init slice 契约。
- [walkthroughs/2026-06-20-round-128-workbench-delete-selection.md](walkthroughs/2026-06-20-round-128-workbench-delete-selection.md)：第一百二十八轮修复 Workbench 删除 slice 后自动跳选其他 slice 的交互问题。
- [walkthroughs/2026-06-20-round-129-preview-project-notice-reset.md](walkthroughs/2026-06-20-round-129-preview-project-notice-reset.md)：第一百二十九轮修复独立 Preview 切换 Project 后 notice / error 提示残留。
- [walkthroughs/2026-06-20-round-130-create-subject-source-comments.md](walkthroughs/2026-06-20-round-130-create-subject-source-comments.md)：第一百三十轮收口 `createSubject` 服务层注释与结果类型说明。
- [walkthroughs/2026-06-20-round-131-preview-create-project-notice.md](walkthroughs/2026-06-20-round-131-preview-create-project-notice.md)：第一百三十一轮修复独立 Preview 新建 Project 成功提示被切换清理的问题。
- [walkthroughs/2026-06-20-round-132-preview-project-fallback.md](walkthroughs/2026-06-20-round-132-preview-project-fallback.md)：第一百三十二轮修复独立 Preview 无 projectPath query 时不会回退选择 Project 的问题。
- [walkthroughs/2026-06-20-round-133-preview-project-load-dedupe.md](walkthroughs/2026-06-20-round-133-preview-project-load-dedupe.md)：第一百三十三轮去重独立 Preview 程序化 Project 选择导致的重复 `loadWorld()`。
- [walkthroughs/2026-06-20-round-134-preview-valid-project-fallback.md](walkthroughs/2026-06-20-round-134-preview-valid-project-fallback.md)：第一百三十四轮修复独立 Preview 无效 `projectPath` 停在错误 Project 的问题。
- [walkthroughs/2026-06-20-round-135-preview-project-helper-cleanup.md](walkthroughs/2026-06-20-round-135-preview-project-helper-cleanup.md)：第一百三十五轮清理独立 Preview 旧 Project path helper。
- [walkthroughs/2026-06-20-round-136-workbench-editor-initial-draft.md](walkthroughs/2026-06-20-round-136-workbench-editor-initial-draft.md)：第一百三十六轮修复主 Workbench Edit tab 初始草稿 time / subject 派生。
- [walkthroughs/2026-06-20-round-137-workbench-editor-schema-clean.md](walkthroughs/2026-06-20-round-137-workbench-editor-schema-clean.md)：第一百三十七轮修复主 Workbench Edit tab 自动默认 time 误触 dirty guard 的问题。
- [walkthroughs/2026-06-20-round-138-workbench-editor-schema-initial-mutation.md](walkthroughs/2026-06-20-round-138-workbench-editor-schema-initial-mutation.md)：第一百三十八轮让主 Workbench Edit tab 初始 mutation 按当前 subject schema 派生。
- [walkthroughs/2026-06-20-round-139-initial-mutation-util-test.md](walkthroughs/2026-06-20-round-139-initial-mutation-util-test.md)：第一百三十九轮把初始 mutation 派生规则抽到 util 并补行为测试。
- [walkthroughs/2026-06-20-round-140-backend-api-design-focus.md](walkthroughs/2026-06-20-round-140-backend-api-design-focus.md)：第一百四十轮按用户调整专注后端/API，补齐 `itemType: object` schema default 校验。
- [walkthroughs/2026-06-20-round-141-create-subject-duplicate-conflict.md](walkthroughs/2026-06-20-round-141-create-subject-duplicate-conflict.md)：第一百四十一轮收敛重复 subject id 为稳定 409 业务错误。
- [walkthroughs/2026-06-20-round-142-query-type-validation.md](walkthroughs/2026-06-20-round-142-query-type-validation.md)：第一百四十二轮收敛按 type 查询的未知 schema type 错误语义。
- [walkthroughs/2026-06-20-round-143-dangling-ref-element-origin.md](walkthroughs/2026-06-20-round-143-dangling-ref-element-origin.md)：第一百四十三轮修复 `dangling-ref` 对 list / collection ref 元素的 slice 归属。
- [walkthroughs/2026-06-20-round-144-nested-attr-advisory.md](walkthroughs/2026-06-20-round-144-nested-attr-advisory.md)：第一百四十四轮修复 A issue 对嵌套 attr 父子路径的漏报。
- [walkthroughs/2026-06-20-round-145-multi-child-advisory.md](walkthroughs/2026-06-20-round-145-multi-child-advisory.md)：第一百四十五轮修复父路径 A issue 只返回首个下游子路径的问题。
- [walkthroughs/2026-06-20-round-146-query-issues-attr-scope.md](walkthroughs/2026-06-20-round-146-query-issues-attr-scope.md)：第一百四十六轮让 `queryState({attrs})` 的 issues 跟随 attr 投影范围。
- [walkthroughs/2026-06-20-round-147-edit-slice-move-advisory.md](walkthroughs/2026-06-20-round-147-edit-slice-move-advisory.md)：第一百四十七轮修复 `editSlice` 原样保存误报和移动 instant 漏报。
- [walkthroughs/2026-06-20-round-148-edit-slice-removed-mutation-advisory.md](walkthroughs/2026-06-20-round-148-edit-slice-removed-mutation-advisory.md)：第一百四十八轮修复 `editSlice` 删除旧绝对 mutation 的 A issue 漏报。
- [walkthroughs/2026-06-20-round-149-http-edit-slice-removed-mutation-issue.md](walkthroughs/2026-06-20-round-149-http-edit-slice-removed-mutation-issue.md)：第一百四十九轮补 HTTP API 对 `editSlice` 删除旧 mutation issue 的契约测试。
- [walkthroughs/2026-06-20-round-150-agent-edit-slice-removed-mutation-issue.md](walkthroughs/2026-06-20-round-150-agent-edit-slice-removed-mutation-issue.md)：第一百五十轮补 Agent 工具对 `edit_world_slice` 删除旧 mutation issue 的契约测试。
- [walkthroughs/2026-06-20-round-151-edit-slice-changed-mutation-advisory.md](walkthroughs/2026-06-20-round-151-edit-slice-changed-mutation-advisory.md)：第一百五十一轮修复 `editSlice` 部分 mutation 变化时未变 mutation 的 A issue 误报。
- [walkthroughs/2026-06-20-round-152-edit-slice-reorder-advisory.md](walkthroughs/2026-06-20-round-152-edit-slice-reorder-advisory.md)：第一百五十二轮修复 `editSlice` 纯重排相关 mutation 时下游 A issue 漏报。
- [walkthroughs/2026-06-20-round-153-edit-slice-retained-reorder-advisory.md](walkthroughs/2026-06-20-round-153-edit-slice-retained-reorder-advisory.md)：第一百五十三轮修复 `editSlice` 新增 / 删除无关 mutation 时保留相关 mutation 重排的 A issue 漏报。
- [walkthroughs/2026-06-20-round-154-query-subjectids-unique.md](walkthroughs/2026-06-20-round-154-query-subjectids-unique.md)：第一百五十四轮收紧 `queryState` / `get_world_state` 的 `subjectIds` 唯一性契约。
- [walkthroughs/2026-06-20-round-155-agent-list-slices-default-limit.md](walkthroughs/2026-06-20-round-155-agent-list-slices-default-limit.md)：第一百五十五轮让 `list_world_slices` 默认只返回最近 5 个切面。
- [walkthroughs/2026-06-20-round-156-slice-mutations-limit.md](walkthroughs/2026-06-20-round-156-slice-mutations-limit.md)：第一百五十六轮把单 slice mutations 上限 100 下沉到 service / HTTP 契约。
- [walkthroughs/2026-06-20-round-157-query-attrs-unique.md](walkthroughs/2026-06-20-round-157-query-attrs-unique.md)：第一百五十七轮收紧 `queryState` / `get_world_state` 的 `attrs` 唯一性契约。
- [walkthroughs/2026-06-20-round-158-agent-list-slices-range-limit.md](walkthroughs/2026-06-20-round-158-agent-list-slices-range-limit.md)：第一百五十八轮修正 `list_world_slices` 默认 limit 误伤区间查询的问题。
- [walkthroughs/2026-06-20-round-159-create-subject-init-mutation-capacity.md](walkthroughs/2026-06-20-round-159-create-subject-init-mutation-capacity.md)：第一百五十九轮补齐 `createSubject` init mutation 的单 slice 容量约束。
- [walkthroughs/2026-06-20-round-160-create-subject-init-slice-kind-guard.md](walkthroughs/2026-06-20-round-160-create-subject-init-slice-kind-guard.md)：第一百六十轮禁止 `createSubject` 把 init mutation 自动追加进非 init 切面。
- [walkthroughs/2026-06-20-round-161-agent-create-subject-init-kind-contract.md](walkthroughs/2026-06-20-round-161-agent-create-subject-init-kind-contract.md)：第一百六十一轮同步 `create_world_subject` 的 init slice kind 契约与 profile artifact。
- [walkthroughs/2026-06-20-round-162-subject-id-whitespace-guard.md](walkthroughs/2026-06-20-round-162-subject-id-whitespace-guard.md)：第一百六十二轮把 subject id 空白 / 首尾空白校验下沉到 service 层。
- [walkthroughs/2026-06-20-round-163-ref-id-whitespace-guard.md](walkthroughs/2026-06-20-round-163-ref-id-whitespace-guard.md)：第一百六十三轮让 `subject://<id>` 内部 id 复用 subject id 形状校验。
- [walkthroughs/2026-06-20-round-164-query-state-scope-guard.md](walkthroughs/2026-06-20-round-164-query-state-scope-guard.md)：第一百六十四轮把 `queryState` 必须提供 `subjectIds` 或 `type` 的规则下沉到 service 层。
- [walkthroughs/2026-06-20-round-165-schema-subject-type-name-guard.md](walkthroughs/2026-06-20-round-165-schema-subject-type-name-guard.md)：第一百六十五轮让 schema loader 拒绝空白或含空白的 subject type 名。
- [walkthroughs/2026-06-20-round-166-attr-path-segment-guard.md](walkthroughs/2026-06-20-round-166-attr-path-segment-guard.md)：第一百六十六轮收紧 schema attr 名与运行时 attr path 段名。
- [walkthroughs/2026-06-20-round-167-slice-kind-shape-guard.md](walkthroughs/2026-06-20-round-167-slice-kind-shape-guard.md)：第一百六十七轮收紧 slice kind 标签形状。
- [walkthroughs/2026-06-20-round-168-subject-type-input-guard.md](walkthroughs/2026-06-20-round-168-subject-type-input-guard.md)：第一百六十八轮收紧运行时 subject type 入参形状。
- [walkthroughs/2026-06-20-round-169-slice-id-input-guard.md](walkthroughs/2026-06-20-round-169-slice-id-input-guard.md)：第一百六十九轮收紧 edit/delete sliceId 入参形状。
- [walkthroughs/2026-06-20-round-170-backend-api-doc-contract-sync.md](walkthroughs/2026-06-20-round-170-backend-api-doc-contract-sync.md)：第一百七十轮同步后端/API 文档里的已落地工具和 Calendar / init slice 契约。
- [walkthroughs/2026-06-20-round-171-http-query-no-trim.md](walkthroughs/2026-06-20-round-171-http-query-no-trim.md)：第一百七十一轮禁止 HTTP query 参数静默 trim。
- [walkthroughs/2026-06-20-round-172-http-query-single-value.md](walkthroughs/2026-06-20-round-172-http-query-single-value.md)：第一百七十二轮拒绝 HTTP query 重复值数组。
- [walkthroughs/2026-06-20-round-173-public-time-no-raw-instant.md](walkthroughs/2026-06-20-round-173-public-time-no-raw-instant.md)：第一百七十三轮禁止 HTTP / Agent 公开时间入参使用 raw instant 调试格式。
- [walkthroughs/2026-06-20-round-174-public-time-no-trim.md](walkthroughs/2026-06-20-round-174-public-time-no-trim.md)：第一百七十四轮禁止 HTTP body / Agent 公开时间入参静默 trim。
- [walkthroughs/2026-06-20-round-175-subject-type-empty-service-guard.md](walkthroughs/2026-06-20-round-175-subject-type-empty-service-guard.md)：第一百七十五轮补齐 service 层按 type 查询的空字符串校验。
- [walkthroughs/2026-06-20-round-176-query-empty-array-guard.md](walkthroughs/2026-06-20-round-176-query-empty-array-guard.md)：第一百七十六轮补齐 service 层 `queryState` 空数组校验。
- [walkthroughs/2026-06-20-round-177-query-empty-array-doc-sync.md](walkthroughs/2026-06-20-round-177-query-empty-array-doc-sync.md)：第一百七十七轮同步 `queryState` / `get_world_state` 空数组文档契约。
- [walkthroughs/2026-06-20-round-178-instant-sqlite-range-guard.md](walkthroughs/2026-06-20-round-178-instant-sqlite-range-guard.md)：第一百七十八轮补齐 service 层 `Instant` SQLite 64 位范围校验。
- [walkthroughs/2026-06-20-round-179-calendar-negative-instant-roundtrip.md](walkthroughs/2026-06-20-round-179-calendar-negative-instant-roundtrip.md)：第一百七十九轮补齐默认 Calendar 零点前时间 parse/format 往返。
- [walkthroughs/2026-06-20-round-180-calendar-format-duplicate-token-guard.md](walkthroughs/2026-06-20-round-180-calendar-format-duplicate-token-guard.md)：第一百八十轮补齐 Calendar format 重复时间字段校验。
- [walkthroughs/2026-06-20-round-181-calendar-unit-safe-integer-guard.md](walkthroughs/2026-06-20-round-181-calendar-unit-safe-integer-guard.md)：第一百八十一轮补齐 Calendar YAML number 单位安全整数校验。
- [walkthroughs/2026-06-20-round-182-ref-type-stable-key-guard.md](walkthroughs/2026-06-20-round-182-ref-type-stable-key-guard.md)：第一百八十二轮补齐 schema `ref(type)` 目标类型稳定 key 校验。
- [walkthroughs/2026-06-20-round-183-ref-target-declared-guard.md](walkthroughs/2026-06-20-round-183-ref-target-declared-guard.md)：第一百八十三轮要求 schema `ref(type)` 必须指向已声明 subject type。
- [walkthroughs/2026-06-20-round-184-schema-default-load-guard.md](walkthroughs/2026-06-20-round-184-schema-default-load-guard.md)：第一百八十四轮把 schema default 纯形状 / 类型校验前移到 schema 加载期。
- [walkthroughs/2026-06-20-round-185-enum-unique-guard.md](walkthroughs/2026-06-20-round-185-enum-unique-guard.md)：第一百八十五轮要求 schema enum 候选值按 stable JSON 唯一。
- [walkthroughs/2026-06-20-round-186-calendar-string-positive-guard.md](walkthroughs/2026-06-20-round-186-calendar-string-positive-guard.md)：第一百八十六轮拒绝 Calendar 单位字符串 `"0"`。
- [walkthroughs/2026-06-20-round-187-calendar-root-object-guard.md](walkthroughs/2026-06-20-round-187-calendar-root-object-guard.md)：第一百八十七轮要求 `calendar.yaml` 根配置必须是 object。
- [walkthroughs/2026-06-20-round-188-calendar-era-string-guard.md](walkthroughs/2026-06-20-round-188-calendar-era-string-guard.md)：第一百八十八轮要求显式 Calendar `era` 必须是字符串。
- [walkthroughs/2026-06-20-round-189-schema-root-object-guard.md](walkthroughs/2026-06-20-round-189-schema-root-object-guard.md)：第一百八十九轮要求显式 `schema.yaml` 根配置必须是 object。
- [walkthroughs/2026-06-20-round-190-schema-desc-string-guard.md](walkthroughs/2026-06-20-round-190-schema-desc-string-guard.md)：第一百九十轮要求 schema 显式 `desc` 必须是字符串。
- [walkthroughs/2026-06-20-round-191-list-slices-limit-safe-integer.md](walkthroughs/2026-06-20-round-191-list-slices-limit-safe-integer.md)：第一百九十一轮要求 `listSlices.limit` 必须是 safe integer 正整数。
- [walkthroughs/2026-06-20-round-192-int-safe-integer.md](walkthroughs/2026-06-20-round-192-int-safe-integer.md)：第一百九十二轮要求 `type: int` 的 default / mutation 必须是 safe integer。
- [walkthroughs/2026-06-20-round-193-int-add-safe-result.md](walkthroughs/2026-06-20-round-193-int-add-safe-result.md)：第一百九十三轮让 `int add` 结果溢出显形为 `broken-relative`。
- [walkthroughs/2026-06-20-round-194-add-finite-result.md](walkthroughs/2026-06-20-round-194-add-finite-result.md)：第一百九十四轮让 `add` 非有限结果显形为 `broken-relative`。
- [walkthroughs/2026-06-20-round-195-agent-json-value-guard.md](walkthroughs/2026-06-20-round-195-agent-json-value-guard.md)：第一百九十五轮让 Agent 工具拒绝会被 JSON 序列化静默改写的 mutation value。
- [walkthroughs/2026-06-20-round-196-service-json-value-guard.md](walkthroughs/2026-06-20-round-196-service-json-value-guard.md)：第一百九十六轮把非普通对象 JSON value 拒绝下沉到 service 层。
- [walkthroughs/2026-06-20-round-197-http-path-decode-guard.md](walkthroughs/2026-06-20-round-197-http-path-decode-guard.md)：第一百九十七轮让 HTTP path segment 非法编码返回稳定 400。
- [walkthroughs/2026-06-20-round-198-p0-real-driving-test.md](walkthroughs/2026-06-20-round-198-p0-real-driving-test.md)：第一百九十八轮从作者视角跑通真实项目的 P0 使用清单。
- [walkthroughs/2026-06-20-round-199-preview-next-time-and-query-refresh.md](walkthroughs/2026-06-20-round-199-preview-next-time-and-query-refresh.md)：第一百九十九轮优化 Preview 默认下一时间与查询刷新。
- [walkthroughs/2026-06-20-round-200-conflict-message-ui-action.md](walkthroughs/2026-06-20-round-200-conflict-message-ui-action.md)：第二百轮改进同 instant 冲突提示与 UI 动作。
- [walkthroughs/2026-06-20-round-201-visible-slice-actions.md](walkthroughs/2026-06-20-round-201-visible-slice-actions.md)：第二百零一轮补齐可见 slice 操作入口。
- [walkthroughs/2026-06-20-round-202-preview-project-list-filter.md](walkthroughs/2026-06-20-round-202-preview-project-list-filter.md)：第二百零二轮优化 Preview Project 列表过滤。
- [walkthroughs/2026-06-20-round-203-preview-project-title-slug.md](walkthroughs/2026-06-20-round-203-preview-project-title-slug.md)：第二百零三轮优化 Preview Project 标题与 slug。
- [walkthroughs/2026-06-21-round-204-branching-migration-plan.md](walkthroughs/2026-06-21-round-204-branching-migration-plan.md)：第二百零四轮只出分叉迁移计划，不自动改 Prisma schema。
- [walkthroughs/2026-06-21-round-205-list-collection-set-edit-contract.md](walkthroughs/2026-06-21-round-205-list-collection-set-edit-contract.md)：第二百零五轮允许 `list` / `collection` 用 `set` 做整组替换，修复 init slice 原样编辑保存。
- [walkthroughs/2026-06-21-round-206-preview-create-subject-refresh.md](walkthroughs/2026-06-21-round-206-preview-create-subject-refresh.md)：第二百零六轮让 Preview 手动创建 subject 后自动刷新 State Query 和下一写入时间。
- [walkthroughs/2026-06-21-round-207-preview-subject-click-query.md](walkthroughs/2026-06-21-round-207-preview-subject-click-query.md)：第二百零七轮让 Preview 点击 subject 后直接刷新 State Query，并清掉旧 type 查询条件。
- [walkthroughs/2026-06-21-round-208-preview-default-mutation-schema-aware.md](walkthroughs/2026-06-21-round-208-preview-default-mutation-schema-aware.md)：第二百零八轮让 Preview 默认 slice mutation 复用 schema-aware 初始 mutation 规则。
- [walkthroughs/2026-06-21-round-209-preview-existing-project-default-subject.md](walkthroughs/2026-06-21-round-209-preview-existing-project-default-subject.md)：第二百零九轮让 Preview 打开已有 Project 后把默认 subject / 默认 mutation 对齐真实 subjects。
- [walkthroughs/2026-06-21-round-210-default-mutation-world-event-fallback.md](walkthroughs/2026-06-21-round-210-default-mutation-world-event-fallback.md)：第二百一十轮让默认手写 slice 在真实角色无 `events` 时回退到 `world.events`。
- [walkthroughs/2026-06-21-round-211-builder-default-mutation-sync.md](walkthroughs/2026-06-21-round-211-builder-default-mutation-sync.md)：第二百一十一轮让 Builder 表单跟随默认 mutation 的实际 subject。
- [walkthroughs/2026-06-21-round-212-saved-slice-subject-filter-visibility.md](walkthroughs/2026-06-21-round-212-saved-slice-subject-filter-visibility.md)：第二百一十二轮避免保存后的新 slice 被旧 subject 过滤隐藏。
- [walkthroughs/2026-06-21-round-213-next-slice-time-from-latest-timeline.md](walkthroughs/2026-06-21-round-213-next-slice-time-from-latest-timeline.md)：第二百一十三轮让下一条 slice 默认时间跟随最新 timeline。
- [walkthroughs/2026-06-21-round-214-next-slice-time-hour-rollover.md](walkthroughs/2026-06-21-round-214-next-slice-time-hour-rollover.md)：第二百一十四轮让下一条 slice 默认时间支持同一天内小时进位。
- [walkthroughs/2026-06-21-round-215-workbench-snapshot-query-issues.md](walkthroughs/2026-06-21-round-215-workbench-snapshot-query-issues.md)：第二百一十五轮让主 Workbench State Snapshot 展示 `state/query` / full state 返回的 issues。
- [walkthroughs/2026-06-21-round-216-workbench-snapshot-issues-dead-state-cleanup.md](walkthroughs/2026-06-21-round-216-workbench-snapshot-issues-dead-state-cleanup.md)：第二百一十六轮清理未展示的前态 issues 死状态。
- [walkthroughs/2026-06-21-round-217-workbench-review-issue-focus.md](walkthroughs/2026-06-21-round-217-workbench-review-issue-focus.md)：第二百一十七轮修复 Review Queue issue 定位和未加载 slice 提示。
- [walkthroughs/2026-06-21-round-218-review-focus-issue-key.md](walkthroughs/2026-06-21-round-218-review-focus-issue-key.md)：第二百一十八轮让 Review Focus 按 issue key 精确定位。
- [walkthroughs/2026-06-21-round-219-review-focus-subject-filter-watch.md](walkthroughs/2026-06-21-round-219-review-focus-subject-filter-watch.md)：第二百一十九轮避免 Review Queue 自动 subject 过滤清掉 issue focus。
- [walkthroughs/2026-06-21-round-220-unloaded-review-issue-focus.md](walkthroughs/2026-06-21-round-220-unloaded-review-issue-focus.md)：第二百二十轮避免未加载 issue 在当前 slice 上显示成 manual focus。
- [walkthroughs/2026-06-21-round-221-clear-subject-filter-clears-issue-focus.md](walkthroughs/2026-06-21-round-221-clear-subject-filter-clears-issue-focus.md)：第二百二十一轮让清空 subject 过滤时清掉旧 issue focus。
- [walkthroughs/2026-06-21-round-222-slice-subject-filter-api.md](walkthroughs/2026-06-21-round-222-slice-subject-filter-api.md)：第二百二十二轮为 `GET /slices` 增加 `subjectIds` / `subjectMode` 服务端过滤，并让真实 Workbench subject timeline 使用该能力。
- [walkthroughs/2026-06-21-round-223-load-issue-slice-by-id.md](walkthroughs/2026-06-21-round-223-load-issue-slice-by-id.md)：第二百二十三轮增加 `GET /slices/:sliceId`，让 Review Queue 可懒加载并定位当前 timeline 未加载的 issue slice。
- [walkthroughs/2026-06-21-round-224-slice-detail-previous-time.md](walkthroughs/2026-06-21-round-224-slice-detail-previous-time.md)：第二百二十四轮让 slice detail 返回 `previousTime`，修正懒加载 issue slice 的切片前状态上下文。
- [walkthroughs/2026-06-21-round-225-merge-loaded-slice-by-previous-time.md](walkthroughs/2026-06-21-round-225-merge-loaded-slice-by-previous-time.md)：第二百二十五轮让懒加载 issue slice 按 `previousTime` 插入当前 timeline，减少定位后的视觉顺序混乱。
- [walkthroughs/2026-06-21-round-226-review-issue-subject-timeline-reload.md](walkthroughs/2026-06-21-round-226-review-issue-subject-timeline-reload.md)：第二百二十六轮让 Review Queue 点击 issue 后刷新对应 subject 的服务端 timeline，并保留目标 issue slice。
- [walkthroughs/2026-06-21-round-227-pending-subject-timeline-notice.md](walkthroughs/2026-06-21-round-227-pending-subject-timeline-notice.md)：第二百二十七轮为待接入 subject 的 timeline 空结果补明确同步提示。
- [walkthroughs/2026-06-21-round-228-pending-subject-clears-selected-slice.md](walkthroughs/2026-06-21-round-228-pending-subject-clears-selected-slice.md)：第二百二十八轮在待接入-only subject 过滤后清空旧选中 slice，避免 Inspector 残留旧上下文。
- [walkthroughs/2026-06-21-round-229-pending-subject-keeps-focus.md](walkthroughs/2026-06-21-round-229-pending-subject-keeps-focus.md)：第二百二十九轮在待接入-only subject 过滤后恢复 focused subject，避免 Slice Composer 默认目标串线。
- [walkthroughs/2026-06-21-round-230-subject-sync-init-time.md](walkthroughs/2026-06-21-round-230-subject-sync-init-time.md)：第二百三十轮在主体系统待接入面板显示同步初始化时间，让作者点击前知道 subject 初始化会落到哪个时间。
- [walkthroughs/2026-06-21-round-231-subject-sync-conflict-message.md](walkthroughs/2026-06-21-round-231-subject-sync-conflict-message.md)：第二百三十一轮把 subject 初始化非 init 冲突提示改写为 UI 可执行动作。
- [walkthroughs/2026-06-21-round-232-subject-sync-partial-refresh.md](walkthroughs/2026-06-21-round-232-subject-sync-partial-refresh.md)：第二百三十二轮让主体系统批量同步中途失败时刷新已成功接入的 subject。
- [walkthroughs/2026-06-21-round-233-subject-sync-time-override.md](walkthroughs/2026-06-21-round-233-subject-sync-time-override.md)：第二百三十三轮允许作者在主体系统待接入面板覆盖同步初始化时间。
- [walkthroughs/2026-06-21-round-234-preferred-subject-empty-timeline.md](walkthroughs/2026-06-21-round-234-preferred-subject-empty-timeline.md)：第二百三十四轮在 preferred subject 没有切片时保持空 subject 视角，避免旧 slice 串线。
- [walkthroughs/2026-06-21-round-235-contextual-empty-slice-state.md](walkthroughs/2026-06-21-round-235-contextual-empty-slice-state.md)：第二百三十五轮让无选中 slice 的空状态按当前视角显示 Project 空、subject 空、待接入 subject 或未选择 slice。
- [walkthroughs/2026-06-21-round-236-mixed-subject-composer-target.md](walkthroughs/2026-06-21-round-236-mixed-subject-composer-target.md)：第二百三十六轮让 mixed pending / registered subject 过滤下的新建 Slice 优先使用已注册 subject。
- [walkthroughs/2026-06-21-round-237-pending-subject-all-filter-guard.md](walkthroughs/2026-06-21-round-237-pending-subject-all-filter-guard.md)：第二百三十七轮禁止待接入 subject 参与“全部 subject”过滤，避免不可满足过滤造成假空列表。
- [walkthroughs/2026-06-21-round-238-world-view-subject-mode-label.md](walkthroughs/2026-06-21-round-238-world-view-subject-mode-label.md)：第二百三十八轮把当前视角里的 subject filter 模式显示为“任一 subject / 全部 subject”。
- [walkthroughs/2026-06-21-round-239-subject-mode-clears-review-focus.md](walkthroughs/2026-06-21-round-239-subject-mode-clears-review-focus.md)：第二百三十九轮让手动切换 subject filter mode 时清空旧 issue focus，避免审查面板残留旧问题。
- [walkthroughs/2026-06-21-round-240-clear-subject-filter-resets-mode.md](walkthroughs/2026-06-21-round-240-clear-subject-filter-resets-mode.md)：第二百四十轮让清空 subject 过滤和进入草稿视角时复位 subject filter mode，避免隐藏 `all` 模式残留。
- [walkthroughs/2026-06-21-round-241-empty-subject-filter-mode-guards.md](walkthroughs/2026-06-21-round-241-empty-subject-filter-mode-guards.md)：第二百四十一轮补齐刷新、移除最后 subject chip、恢复旧草稿后的空 subject mode 复位。
- [walkthroughs/2026-06-21-round-242-composer-known-slice-times.md](walkthroughs/2026-06-21-round-242-composer-known-slice-times.md)：第二百四十二轮让 Slice Composer 的默认时间参考已知全局切片时间窗口，而不是只看当前过滤 timeline。
- [walkthroughs/2026-06-21-round-243-known-slice-times-order.md](walkthroughs/2026-06-21-round-243-known-slice-times-order.md)：第二百四十三轮让局部 / 懒加载切片时间补到已知时间窗口前方，避免旧时间抢走默认下一时间基准。
- [walkthroughs/2026-06-21-round-244-subject-timeline-refresh-preserves-server-filter.md](walkthroughs/2026-06-21-round-244-subject-timeline-refresh-preserves-server-filter.md)：第二百四十四轮让 subject 过滤视角下的刷新 / 保存 / 删除 / 同步继续使用服务端 timeline，避免退回本地过滤。
- [walkthroughs/2026-06-21-round-245-slice-composer-close-dirty-guard.md](walkthroughs/2026-06-21-round-245-slice-composer-close-dirty-guard.md)：第二百四十五轮给 Slice Composer 与 Workbench 关闭动作补未保存草稿确认，避免误关丢稿。
- [walkthroughs/2026-06-21-round-246-slice-composer-open-preserves-dirty.md](walkthroughs/2026-06-21-round-246-slice-composer-open-preserves-dirty.md)：第二百四十六轮避免 Composer 已打开时顶部新建 / 编辑入口误清 dirty guard。
- [walkthroughs/2026-06-21-round-247-slice-composer-new-mode-dirty-guard.md](walkthroughs/2026-06-21-round-247-slice-composer-new-mode-dirty-guard.md)：第二百四十七轮给 Slice Composer 内部“新建模式”切换补未保存草稿确认。
- [walkthroughs/2026-06-21-round-248-slice-composer-save-and-continue.md](walkthroughs/2026-06-21-round-248-slice-composer-save-and-continue.md)：第二百四十八轮给 Slice Composer 新建模式增加“写入并继续下一步”，让连续推演少一次重新打开动作。
- [walkthroughs/2026-06-21-round-249-save-and-continue-no-remount.md](walkthroughs/2026-06-21-round-249-save-and-continue-no-remount.md)：第二百四十九轮让继续模式不再依赖父层重挂，避免刷新完成后抹掉下一步草稿。
- [walkthroughs/2026-06-21-round-250-save-and-continue-subject-focus.md](walkthroughs/2026-06-21-round-250-save-and-continue-subject-focus.md)：第二百五十轮让继续模式父层焦点对齐到最后一个 mutation subject，避免多 subject slice 后下一条默认目标漂移；第二百八十八轮已补充 fallback 到 `world.events` 时保留原 selected subject。
- [walkthroughs/2026-06-22-round-251-workbench-close-draft-guard.md](walkthroughs/2026-06-22-round-251-workbench-close-draft-guard.md)：第二百五十一轮让 Workbench 关闭动作统一确认会被丢弃的会话态草稿。
- [walkthroughs/2026-06-22-round-252-workbench-model-update-close-guard.md](walkthroughs/2026-06-22-round-252-workbench-model-update-close-guard.md)：第二百五十二轮让 Dialog v-model 关闭入口也走 Workbench 草稿确认。
- [walkthroughs/2026-06-22-round-253-project-switch-draft-guard.md](walkthroughs/2026-06-22-round-253-project-switch-draft-guard.md)：第二百五十三轮让主 IDE 切换 Project 前确认 World Engine Workbench 会话草稿。
- [walkthroughs/2026-06-22-round-254-bookshelf-switch-draft-guard.md](walkthroughs/2026-06-22-round-254-bookshelf-switch-draft-guard.md)：第二百五十四轮让 Bookshelf 内部 Project 切换也走同一 World Engine 草稿确认。
- [walkthroughs/2026-06-22-round-255-workbench-draft-restore-across-timeline.md](walkthroughs/2026-06-22-round-255-workbench-draft-restore-across-timeline.md)：第二百五十五轮让 Workbench 顶栏 Drafts 入口能跨过滤 / 跨 timeline 窗口重新载入草稿 slice。
- [walkthroughs/2026-06-22-round-256-save-edit-keeps-slice-visible.md](walkthroughs/2026-06-22-round-256-save-edit-keeps-slice-visible.md)：第二百五十六轮让保存 metadata / value 后当前 slice 仍保持可见。
- [walkthroughs/2026-06-22-round-257-review-triage-stable-issue-key.md](walkthroughs/2026-06-22-round-257-review-triage-stable-issue-key.md)：第二百五十七轮让 Review Queue 的确认 / 忽略状态不再因 issue 顺序变化丢失。
- [walkthroughs/2026-06-22-round-258-review-triage-identity-fallback.md](walkthroughs/2026-06-22-round-258-review-triage-identity-fallback.md)：第二百五十八轮让 transient issue 变成 persisted issue 后继续继承确认 / 忽略状态。
- [walkthroughs/2026-06-22-round-259-metadata-save-failure-preserves-draft.md](walkthroughs/2026-06-22-round-259-metadata-save-failure-preserves-draft.md)：第二百五十九轮让真实 Inspector metadata 保存失败时保留草稿。
- [walkthroughs/2026-06-22-round-260-value-save-busy-guard.md](walkthroughs/2026-06-22-round-260-value-save-busy-guard.md)：第二百六十轮让真实 mutation value 保存中禁用 apply/reset/clear，避免重复提交或误清草稿。
- [walkthroughs/2026-06-22-round-261-metadata-save-busy-guard.md](walkthroughs/2026-06-22-round-261-metadata-save-busy-guard.md)：第二百六十一轮让真实 Inspector metadata 保存中禁用字段和提交入口，避免重复提交或输入被回流覆盖。
- [walkthroughs/2026-06-22-round-262-delete-slice-clears-session-drafts.md](walkthroughs/2026-06-22-round-262-delete-slice-clears-session-drafts.md)：第二百六十二轮让删除 slice 后清理该 slice 的会话态草稿与审查上下文。
- [walkthroughs/2026-06-22-round-263-delete-slice-preserves-remaining-drafts.md](walkthroughs/2026-06-22-round-263-delete-slice-preserves-remaining-drafts.md)：第二百六十三轮让删除当前 slice 时保留其它 slice 的内部草稿内容。
- [walkthroughs/2026-06-22-round-264-workbench-banner-exclusive.md](walkthroughs/2026-06-22-round-264-workbench-banner-exclusive.md)：第二百六十四轮让主 Workbench 顶部错误 / 成功提示互斥，避免连续操作后旧成功和新错误同时显示。
- [walkthroughs/2026-06-22-round-265-route-switch-draft-guard.md](walkthroughs/2026-06-22-round-265-route-switch-draft-guard.md)：第二百六十五轮让 route/query 触发 Project 切换时也先确认 World Engine Workbench 会话草稿。
- [walkthroughs/2026-06-22-round-266-switch-confirm-side-effect.md](walkthroughs/2026-06-22-round-266-switch-confirm-side-effect.md)：第二百六十六轮把 Project 切换前的 World Engine 草稿确认改成纯确认，避免后续普通文件对话取消时提前丢草稿。
- [walkthroughs/2026-06-22-round-267-route-cancel-url-restore.md](walkthroughs/2026-06-22-round-267-route-cancel-url-restore.md)：第二百六十七轮让 route/query 触发的 Project 切换被取消后，URL 回到当前实际 workspace。
- [walkthroughs/2026-06-22-round-268-composer-context-switch-busy-guard.md](walkthroughs/2026-06-22-round-268-composer-context-switch-busy-guard.md)：第二百六十八轮让 Slice Composer 刷新 busy 期间禁止载入 / 切换编辑上下文，但保留普通下一步草稿输入。
- [walkthroughs/2026-06-22-round-269-composer-saving-close-guard.md](walkthroughs/2026-06-22-round-269-composer-saving-close-guard.md)：第二百六十九轮让 Slice Composer 保存请求飞行中不能关闭 Composer 或 Workbench。
- [walkthroughs/2026-06-22-round-270-saving-project-switch-guard.md](walkthroughs/2026-06-22-round-270-saving-project-switch-guard.md)：第二百七十轮让 Slice Composer 保存请求飞行中不能通过 Project 切换入口离开当前上下文。
- [walkthroughs/2026-06-22-round-271-saving-topbar-action-guard.md](walkthroughs/2026-06-22-round-271-saving-topbar-action-guard.md)：第二百七十一轮让 Slice Composer 保存请求飞行中禁用顶栏和空状态里的并发写入 / 刷新入口。
- [walkthroughs/2026-06-22-round-272-saving-function-guard.md](walkthroughs/2026-06-22-round-272-saving-function-guard.md)：第二百七十二轮把保存中保护下沉到 Workbench 用户入口函数，避免组件事件绕过 disabled 后切换上下文或触发写入。
- [walkthroughs/2026-06-22-round-273-slice-list-busy-guard.md](walkthroughs/2026-06-22-round-273-slice-list-busy-guard.md)：第二百七十三轮让 Slice List 在保存中禁用过滤、草稿定位、步进和自动选中，避免保存回流前上下文被列表带跑。
- [walkthroughs/2026-06-22-round-274-composer-saving-form-guard.md](walkthroughs/2026-06-22-round-274-composer-saving-form-guard.md)：第二百七十四轮让 Slice Composer 保存请求飞行中禁用表单与 Builder，并在 Builder 事件函数层直接返回，避免旧草稿输入被保存回流覆盖。
- [walkthroughs/2026-06-22-round-275-empty-state-subject-sync-action.md](walkthroughs/2026-06-22-round-275-empty-state-subject-sync-action.md)：第二百七十五轮把“同步主体系统”补到中间空状态，首次打开有待接入主体的 Project 时不用只在左栏找入口。
- [walkthroughs/2026-06-22-round-276-subject-creator-continuous-entry.md](walkthroughs/2026-06-22-round-276-subject-creator-continuous-entry.md)：第二百七十六轮让手动创建 subject 成功后清空 id/name、保留 type/time，并在请求飞行中禁用表单和使用请求体快照，支撑连续录入主体。
- [walkthroughs/2026-06-22-round-277-empty-state-create-subject-action.md](walkthroughs/2026-06-22-round-277-empty-state-create-subject-action.md)：第二百七十七轮把“创建 Subject”补到空 Project 主画布，点击后展开左侧创建面板，避免作者只能从折叠 details 里找第一步入口。
- [walkthroughs/2026-06-22-round-278-edit-slice-builder-sync.md](walkthroughs/2026-06-22-round-278-edit-slice-builder-sync.md)：第二百七十八轮让 Composer 载入所选 slice 时自动把第一条 mutation 同步进 Builder，避免编辑时 Builder 仍停在旧默认 mutation。
- [walkthroughs/2026-06-22-round-279-slice-time-required-validation.md](walkthroughs/2026-06-22-round-279-slice-time-required-validation.md)：第二百七十九轮把 Slice Composer 的 time 必填校验前移到前端，空 time 会直接提示并禁用写入。
- [walkthroughs/2026-06-22-round-280-continue-save-visible-receipt.md](walkthroughs/2026-06-22-round-280-continue-save-visible-receipt.md)：第二百八十轮让 `写入并继续下一步` 的保存成功回执显示在 Composer 内，避免 overlay 打开时父层 notice 不可见。
- [walkthroughs/2026-06-22-round-281-delete-issue-source-slice.md](walkthroughs/2026-06-22-round-281-delete-issue-source-slice.md)：第二百八十一轮让删除 slice 返回的 transient issues 保留被删除 slice 的来源，避免刷新后错挂到其它 slice。
- [walkthroughs/2026-06-22-round-282-empty-state-review-issues.md](walkthroughs/2026-06-22-round-282-empty-state-review-issues.md)：第二百八十二轮让无选中 slice 的空状态展示当前 Review Queue issue 摘要，删除后不再只剩顶部 issue 数量提示。
- [walkthroughs/2026-06-22-round-283-next-slice-time-date-rollover.md](walkthroughs/2026-06-22-round-283-next-slice-time-date-rollover.md)：第二百八十三轮让下一条默认 slice 时间支持默认数字历日 / 月 / 年边界进位，避免日末回退到 calendar examples。
- [walkthroughs/2026-06-22-round-284-subject-creator-project-defaults.md](walkthroughs/2026-06-22-round-284-subject-creator-project-defaults.md)：第二百八十四轮让 Subject Creator 在 Project 切换后重置 id/name/time，并在 schema 刷新时保护作者手动改过的初始化时间。
- [walkthroughs/2026-06-22-round-285-schema-source-path-surface.md](walkthroughs/2026-06-22-round-285-schema-source-path-surface.md)：第二百八十五轮在 Workbench / Preview 的 Schema 区域展示 `world-engine/schema.yaml` 与 `world-engine/calendar.yaml` 来源路径。
- [walkthroughs/2026-06-22-round-286-open-schema-source-path.md](walkthroughs/2026-06-22-round-286-open-schema-source-path.md)：第二百八十六轮让主 Workbench 的 schema/calendar 路径 chip 可直接打开 Project Workspace 内配置文件。
- [walkthroughs/2026-06-22-round-287-demo-schema-guard.md](walkthroughs/2026-06-22-round-287-demo-schema-guard.md)：第二百八十七轮让主 Workbench 在 schema 不适配内置示例世界时提前禁用示例入口，并把空状态降级到创建 subject / 新建 Slice。
- [walkthroughs/2026-06-22-round-288-continue-subject-context.md](walkthroughs/2026-06-22-round-288-continue-subject-context.md)：第二百八十八轮让 `写入并继续下一步` 保留作者当前 subject 语境，避免角色事件回退到 `world.events` 后把后续草稿带到 `world`。
- [walkthroughs/2026-06-22-round-289-snapshot-previous-time-detail.md](walkthroughs/2026-06-22-round-289-snapshot-previous-time-detail.md)：第二百八十九轮让 State Snapshot 缺少 `previousTime` 时按需读取 slice detail，使用真实全局前一刻查询 before 状态。
- [walkthroughs/2026-06-22-round-290-snapshot-detail-in-place.md](walkthroughs/2026-06-22-round-290-snapshot-detail-in-place.md)：第二百九十轮让 Snapshot detail 回填已有 slice 时原位替换，避免 subject-filtered timeline 因全局 previousTime 发生跳位。
- [walkthroughs/2026-06-22-round-291-value-draft-mutation-identity.md](walkthroughs/2026-06-22-round-291-value-draft-mutation-identity.md)：第二百九十一轮让底部 value 草稿绑定 mutation 身份，避免整块编辑后旧草稿串到同 index 新行。
- [walkthroughs/2026-06-22-round-292-composer-new-slice-request.md](walkthroughs/2026-06-22-round-292-composer-new-slice-request.md)：第二百九十二轮让顶栏 `新建 Slice` 在 Composer 已打开时真正请求子编辑器切回新建模式。
- [walkthroughs/2026-06-22-round-293-review-focus-clears-missing-issue.md](walkthroughs/2026-06-22-round-293-review-focus-clears-missing-issue.md)：第二百九十三轮让 Review Queue 中已消失的 issue 自动清理旧焦点，避免显示误导性的 `manual-focus`。
- [walkthroughs/2026-06-22-round-294-composer-edit-clears-drafts.md](walkthroughs/2026-06-22-round-294-composer-edit-clears-drafts.md)：第二百九十四轮让 Slice Composer 整块编辑保存已有 slice 后清理同 slice 的 metadata/value 会话草稿。
- [walkthroughs/2026-06-22-round-295-preview-slice-time-required.md](walkthroughs/2026-06-22-round-295-preview-slice-time-required.md)：第二百九十五轮让独立 Preview 写入 / 编辑 slice 也前置校验 `time` 必填。
- [walkthroughs/2026-06-22-round-296-preview-feedback-mutual-exclusive.md](walkthroughs/2026-06-22-round-296-preview-feedback-mutual-exclusive.md)：第二百九十六轮让独立 Preview 的错误 / 成功反馈互斥，避免连续操作后旧绿条和新红条同时显示。
- [walkthroughs/2026-06-22-round-297-preview-schema-openpath-deeplink.md](walkthroughs/2026-06-22-round-297-preview-schema-openpath-deeplink.md)：第二百九十七轮让独立 Preview 的 Schema / Calendar 路径 chip 可深链打开主 IDE 对应 Project Workspace 文件。
- [walkthroughs/2026-06-22-round-298-openpath-consume-before-normalize.md](walkthroughs/2026-06-22-round-298-openpath-consume-before-normalize.md)：第二百九十八轮修正主 IDE 先规范 URL 再消费 `openPath` 导致深链文件未打开的问题。
- [walkthroughs/2026-06-22-round-299-preview-subject-create-guard.md](walkthroughs/2026-06-22-round-299-preview-subject-create-guard.md)：第二百九十九轮让独立 Preview 创建 subject 前置校验 `id/type/time`，并在创建成功后清空 `id/name` 支撑连续录入。
- [walkthroughs/2026-06-22-round-300-preview-subject-duplicate-guard.md](walkthroughs/2026-06-22-round-300-preview-subject-duplicate-guard.md)：第三百轮让独立 Preview 在当前 subject id 已存在时禁用创建入口，并在函数入口提示填写新 id。
- [walkthroughs/2026-06-22-round-301-preview-schema-fill-current-subject.md](walkthroughs/2026-06-22-round-301-preview-schema-fill-current-subject.md)：第三百零一轮让独立 Preview 的 Schema attr 快捷填充优先使用当前 Builder / Query subject，避免多 subject 同类型时串到第一个 subject。
- [walkthroughs/2026-06-22-round-302-preview-write-slice-time-disabled.md](walkthroughs/2026-06-22-round-302-preview-write-slice-time-disabled.md)：第三百零二轮让独立 Preview 写入 / 编辑 slice 按钮在 `time` 为空时禁用，并保留函数入口校验。
- [walkthroughs/2026-06-22-round-303-preview-demo-schema-guard.md](walkthroughs/2026-06-22-round-303-preview-demo-schema-guard.md)：第三百零三轮让独立 Preview 的“创建示例世界”按钮在 schema 不适配时提前禁用，并显示原因。
- [walkthroughs/2026-06-22-round-304-preview-query-scope-disabled.md](walkthroughs/2026-06-22-round-304-preview-query-scope-disabled.md)：第三百零四轮让独立 Preview 的 State Query 按钮在 `subjectIds/type` 同时为空时禁用，并保留函数入口校验。
- [walkthroughs/2026-06-22-round-305-preview-mutation-list-controls.md](walkthroughs/2026-06-22-round-305-preview-mutation-list-controls.md)：第三百零五轮让独立 Preview 的 Mutation Builder 复用主 Workbench 的列表控制和动作按钮，支持单条 mutation 载入、替换、插入、复制、删除和移动。
- [walkthroughs/2026-06-22-round-306-mutation-empty-draft-append.md](walkthroughs/2026-06-22-round-306-mutation-empty-draft-append.md)：第三百零六轮区分提交解析和编辑解析，允许 `[]` 作为编辑器临时草稿，删除最后一条 mutation 后仍可继续追加。
- [walkthroughs/2026-06-22-round-307-preview-project-query-alias.md](walkthroughs/2026-06-22-round-307-preview-project-query-alias.md)：第三百零七轮让独立 Preview 同时接受 `projectPath` 和主 IDE 通用的 `project` query，避免手动打开时选错 Project。
- [walkthroughs/2026-06-22-round-308-preview-edit-load-builder-sync.md](walkthroughs/2026-06-22-round-308-preview-edit-load-builder-sync.md)：第三百零八轮让独立 Preview 载入已有 slice 编辑时同步第一条 mutation 到 Builder，避免 textarea 与 Builder 指向不同 mutation。
- [walkthroughs/2026-06-22-round-309-preview-subject-load-draft-sync.md](walkthroughs/2026-06-22-round-309-preview-subject-load-draft-sync.md)：第三百零九轮让独立 Preview 点击 subject 时，在安全条件下同步自动 mutation 草稿到该 subject，避免直接写入时仍指向旧 subject。
- [walkthroughs/2026-06-22-round-310-preview-edit-save-resets-draft.md](walkthroughs/2026-06-22-round-310-preview-edit-save-resets-draft.md)：第三百一十轮让独立 Preview 保存已有 slice 编辑后回到新建草稿，避免下一次写入误复制旧 slice 内容。
- [walkthroughs/2026-06-22-round-311-preview-write-busy-guard.md](walkthroughs/2026-06-22-round-311-preview-write-busy-guard.md)：第三百一十一轮让独立 Preview 的 Write Slice 区域在写入 / 编辑请求飞行中整体禁用，避免飞行中草稿被刷新覆盖。
- [walkthroughs/2026-06-22-round-312-preview-state-busy-guard.md](walkthroughs/2026-06-22-round-312-preview-state-busy-guard.md)：第三百一十二轮让独立 Preview 的 World State 面板在请求飞行中禁用刷新、subject 选择、载入编辑和删除 slice，并在页面入口函数层兜住并发动作。
- [walkthroughs/2026-06-22-round-313-preview-project-switch-busy-guard.md](walkthroughs/2026-06-22-round-313-preview-project-switch-busy-guard.md)：第三百一十三轮让独立 Preview 顶部 Project 选择器和刷新列表按钮在请求飞行中禁用，避免写入 / 删除时切走当前 Project 上下文。
- [walkthroughs/2026-06-22-round-314-preview-actions-form-busy-guard.md](walkthroughs/2026-06-22-round-314-preview-actions-form-busy-guard.md)：第三百一十四轮让独立 Preview 的 Create Subject 与 Query 表单在请求飞行中整体禁用，避免成功回流覆盖作者刚输入的下一步草稿或让查询条件与结果错位。
- [walkthroughs/2026-06-22-round-315-preview-schema-shortcut-busy-guard.md](walkthroughs/2026-06-22-round-315-preview-schema-shortcut-busy-guard.md)：第三百一十五轮让独立 Preview 的 Schema attr 快捷按钮在请求飞行中禁用，并在 `fillMutation()` 入口兜住绕过 UI 的草稿改写。
- [walkthroughs/2026-06-22-round-316-preview-project-form-busy-guard.md](walkthroughs/2026-06-22-round-316-preview-project-form-busy-guard.md)：第三百一十六轮让独立 Preview 的 Project 创建表单在请求飞行中整体禁用，避免新建 Project 成功回流时表单内容与实际创建目标错位。
- [walkthroughs/2026-06-22-round-317-preview-project-loading-guard.md](walkthroughs/2026-06-22-round-317-preview-project-loading-guard.md)：第三百一十七轮让独立 Preview 的 Project 面板在 Project 列表加载中也禁用新建、示例世界和 Schema attr 快捷填充，避免列表加载 / `loadWorld()` 回流期间抢上下文。
- [walkthroughs/2026-06-22-round-318-preview-actions-loading-world-guard.md](walkthroughs/2026-06-22-round-318-preview-actions-loading-world-guard.md)：第三百一十八轮让独立 Preview 的 Actions 面板在 `loadWorld()` 回流期间禁用创建 subject、写 slice 和查询 state，并在入口函数兜住 world 加载中的用户请求。
- [walkthroughs/2026-06-22-round-319-preview-project-panel-loading-world-guard.md](walkthroughs/2026-06-22-round-319-preview-project-panel-loading-world-guard.md)：第三百一十九轮让独立 Preview 顶部 Project 切换 / 刷新和左侧 ProjectPanel 在 `loadWorld()` 回流期间也禁用，并在 Project / Schema 入口函数兜住 world 加载中的操作。
- [walkthroughs/2026-06-22-round-320-preview-project-form-reset.md](walkthroughs/2026-06-22-round-320-preview-project-form-reset.md)：第三百二十轮让独立 Preview 新建 Project 成功后重置创建表单，并把默认标题时间戳精确到秒，减少连续创建试用 Project 时的同名误操作。
- [walkthroughs/2026-06-22-round-321-workbench-timeline-loading-action-guard.md](walkthroughs/2026-06-22-round-321-workbench-timeline-loading-action-guard.md)：第三百二十一轮让主 IDE Workbench 的 `workbenchActionBusy` 纳入 `timelineLoading`，并在新建 / 编辑 / 删除 / 示例世界 / 同步主体系统等入口兜住 timeline 局部刷新中的上下文动作。
- [walkthroughs/2026-06-22-round-322-workbench-timeline-filter-action-guard.md](walkthroughs/2026-06-22-round-322-workbench-timeline-filter-action-guard.md)：第三百二十二轮让主 IDE Workbench 的 slice 选择、Review Queue 定位、草稿视角和 timeline 过滤函数在工作台同步 / timeline 局部刷新中也直接返回，避免组件事件绕过 disabled 后继续改时间线上下文。
- [walkthroughs/2026-06-22-round-323-workbench-draft-summary-busy-state.md](walkthroughs/2026-06-22-round-323-workbench-draft-summary-busy-state.md)：第三百二十三轮让主 IDE Workbench 顶栏 Drafts 按钮的禁用态对齐 `workbenchActionBusy`，避免 timeline 回流中按钮看似可点但函数层只提示等待。
- [walkthroughs/2026-06-22-round-324-workbench-exit-busy-guard.md](walkthroughs/2026-06-22-round-324-workbench-exit-busy-guard.md)：第三百二十四轮让主 IDE Workbench 的 Preview、关闭 Workbench、打开 schema/calendar 配置文件入口在工作台同步中禁用并由函数层 guard 兜住，避免回流中离开当前上下文。
- [walkthroughs/2026-06-22-round-325-workbench-sidebar-busy-guard.md](walkthroughs/2026-06-22-round-325-workbench-sidebar-busy-guard.md)：第三百二十五轮让主 IDE Workbench 左栏 subject 选择、`整体世界` 和 schema/calendar 路径按钮在工作台同步中禁用，同时保留本地搜索、筛选、折叠和 resize 可用。
- [walkthroughs/2026-06-22-round-326-inspector-full-state-busy-guard.md](walkthroughs/2026-06-22-round-326-inspector-full-state-busy-guard.md)：第三百二十六轮让主 IDE Workbench 右侧 Inspector 的完整世界状态读取在工作台同步中禁用，并在 busy 结束后按展开状态自动补发真实 state 查询。
- [walkthroughs/2026-06-22-round-327-review-workbench-navigation-busy-guard.md](walkthroughs/2026-06-22-round-327-review-workbench-navigation-busy-guard.md)：第三百二十七轮让底部审查工作台的 `跳到草稿`、issue 定位和 subject 相关 slice 上 / 下一个在工作台同步中禁用，同时保留本地审阅状态切换。
- [walkthroughs/2026-06-22-round-328-empty-review-issue-busy-state.md](walkthroughs/2026-06-22-round-328-empty-review-issue-busy-state.md)：第三百二十八轮让主 IDE Workbench 无选中 slice 空状态里的待处理 issue 行在工作台同步中禁用，避免空状态 issue 摘要成为 issue 定位的旁路可点入口。
- [walkthroughs/2026-06-22-round-329-slice-time-sort-key.md](walkthroughs/2026-06-22-round-329-slice-time-sort-key.md)：第三百二十九轮让下一条默认 slice 时间按可解析 instant 从新到旧推导，不再依赖 timeline / 懒加载合并后的数组尾项顺序。
- [walkthroughs/2026-06-22-round-330-composer-builder-busy-guard.md](walkthroughs/2026-06-22-round-330-composer-builder-busy-guard.md)：第三百三十轮让 Slice Composer 的 Mutation Builder 在父 Workbench 回流 busy 中禁用，避免连续写入后 Builder 操作与自动下一步草稿抢状态。
- [walkthroughs/2026-06-22-round-331-preview-builder-busy-guard.md](walkthroughs/2026-06-22-round-331-preview-builder-busy-guard.md)：第三百三十一轮让独立 Preview 的 Mutation Builder 在 `loadingWorld/actionBusy` 中禁用，并补函数层 guard，避免 Project/世界数据回流时改写草稿。
- [walkthroughs/2026-06-22-round-332-preview-cancel-edit-busy-guard.md](walkthroughs/2026-06-22-round-332-preview-cancel-edit-busy-guard.md)：第三百三十二轮把独立 Preview 的用户“取消编辑”入口和内部清理函数分开，请求飞行中用户事件不会绕过 disabled 重置编辑草稿。
- [walkthroughs/2026-06-22-round-333-preview-state-panel-busy-guard.md](walkthroughs/2026-06-22-round-333-preview-state-panel-busy-guard.md)：第三百三十三轮让独立 Preview StatePanel 的用户刷新走请求飞行 guard，并让删除 slice 入口同时检查 `loadingWorld`。
- [walkthroughs/2026-06-22-round-334-real-author-flow-content-bridge.md](walkthroughs/2026-06-22-round-334-real-author-flow-content-bridge.md)：第三百三十四轮回到真实 `ming-ding-zhi-shi-2` 作者流做只读审查，确认当前首要卡点是 World Engine slice 与 `simulation/subjects` 六文件状态之间缺少产品桥接，而不是继续补输入边界。
- [walkthroughs/2026-06-22-round-335-subject-file-bridge-plan.md](walkthroughs/2026-06-22-round-335-subject-file-bridge-plan.md)：第三百三十五轮读取 subject 六文件、subject memory 工具、sidecar 合同和 `world.engine` profile 边界，收敛下一步为“显式主体文件更新建议”，不自动写 `state.md / events.jsonl / memory.jsonl`。
- [walkthroughs/2026-06-22-round-336-subject-file-proposal-surface.md](walkthroughs/2026-06-22-round-336-subject-file-proposal-surface.md)：第三百三十六轮实现 Workbench Inspector 的主体文件建议面，根据 slice 和主体系统摘要生成 `events.jsonl` 草稿、`memory.jsonl` facts 和 `state.md` 审查提示，但不自动写文件。
- [walkthroughs/2026-06-22-round-337-copy-subject-file-proposal.md](walkthroughs/2026-06-22-round-337-copy-subject-file-proposal.md)：第三百三十七轮为主体文件建议增加复制入口和可复制文本格式，让作者能把建议交给手动审查或后续 Agent，仍不自动写六文件。
- [walkthroughs/2026-06-22-round-338-mock-proposal-subject-system.md](walkthroughs/2026-06-22-round-338-mock-proposal-subject-system.md)：第三百三十八轮为 mock Workbench 补齐 `simulation/subjects` 摘要数据并传给 Sidebar / Inspector，让沙盘也能展示主体文件建议面。
- [walkthroughs/2026-06-22-round-339-open-subject-file-proposal-path.md](walkthroughs/2026-06-22-round-339-open-subject-file-proposal-path.md)：第三百三十九轮让主体文件建议的 `events.jsonl / memory.jsonl / state.md` 路径可从 Inspector 请求打开；真实 Workbench 复用现有 Project Workspace 打开链路，mock 沙盘只显示路径提示。
- [walkthroughs/2026-06-22-round-340-subject-file-proposal-jsonl-candidates.md](walkthroughs/2026-06-22-round-340-subject-file-proposal-jsonl-candidates.md)：第三百四十轮把主体文件建议从普通描述文本升级为可粘贴 JSONL 候选：`events.jsonl` 输出 `text/time`，`memory.jsonl` 输出 `topic/view`，同时保留 readable 摘要。
- [walkthroughs/2026-06-22-round-341-copy-subject-file-jsonl-lines.md](walkthroughs/2026-06-22-round-341-copy-subject-file-jsonl-lines.md)：第三百四十一轮在主体文件建议面补“复制行”入口，可单独复制 `events.jsonl` 行或 `memory.jsonl` 候选行集合，减少作者从完整 proposal 中手动挑 JSONL 的步骤。
- [walkthroughs/2026-06-22-round-342-event-jsonl-text-without-time-prefix.md](walkthroughs/2026-06-22-round-342-event-jsonl-text-without-time-prefix.md)：第三百四十二轮修正 `events.jsonl` 候选行的 `text`，不再把时间前缀塞进正文；时间只保留在 JSONL 的 `time` 字段，readable 摘要仍保留时间。
- [walkthroughs/2026-06-22-round-343-state-review-section-hints.md](walkthroughs/2026-06-22-round-343-state-review-section-hints.md)：第三百四十三轮把 `state.md review` 从技术 mutation 摘要升级为文档区块提示，例如 `location` 指向 `当前位置`、`hp/mp/sp` 指向 `资源`、`relationship` 指向 `关系压力`。
- [walkthroughs/2026-06-22-round-344-event-jsonl-subject-voice-draft.md](walkthroughs/2026-06-22-round-344-event-jsonl-subject-voice-draft.md)：第三百四十四轮把 `events.jsonl` 候选正文从 `某某相关` 外部标签改为 `我经历了这件事...` 主体经历草稿，并保守替换当前 subject name 为 `我`。
- [walkthroughs/2026-06-22-round-345-subject-file-proposal-review-notes.md](walkthroughs/2026-06-22-round-345-subject-file-proposal-review-notes.md)：第三百四十五轮在主体文件建议 UI 与复制文本里补充人工确认提示：event 写入前确认第一人称 / 认知边界，memory 写入前确认追加新 topic 还是改写旧 topic。
- [walkthroughs/2026-06-22-round-346-subject-sync-boundary-copy.md](walkthroughs/2026-06-22-round-346-subject-sync-boundary-copy.md)：第三百四十六轮在“同步主体系统”空状态和左栏待接入面板中补充边界文案：同步只注册 World Engine subject 身份，不复制或改写 `simulation/subjects` 六文件正文。
- [walkthroughs/2026-06-22-round-347-sidebar-subject-file-openers.md](walkthroughs/2026-06-22-round-347-sidebar-subject-file-openers.md)：第三百四十七轮在左栏 subject 卡片增加 `subject / events / memory / state` 文件按钮，复用 Project Workspace 打开链路，方便作者确认主体六文件。
- [walkthroughs/2026-06-22-round-348-mock-sidebar-openpath-wire.md](walkthroughs/2026-06-22-round-348-mock-sidebar-openpath-wire.md)：第三百四十八轮补齐 mock Workbench 左栏文件按钮的 `openWorkspacePath` 接线，避免沙盘里点击主体文件按钮静默无效。
- [walkthroughs/2026-06-22-round-349-state-review-copy.md](walkthroughs/2026-06-22-round-349-state-review-copy.md)：第三百四十九轮为 `state.md review` 增加独立“复制提示”入口，让作者打开 `state.md` 后能直接带走审查提示。
- [walkthroughs/2026-06-22-round-350-proposal-source-label.md](walkthroughs/2026-06-22-round-350-proposal-source-label.md)：第三百五十轮为主体文件建议增加来源标签，区分“直接触及该主体”和“当前主体语境下的 world 事件建议”。
- [walkthroughs/2026-06-22-round-351-copy-all-proposals.md](walkthroughs/2026-06-22-round-351-copy-all-proposals.md)：第三百五十一轮为主体文件建议增加“复制全部”入口，多主体 slice 可一次性复制全部 subject proposal。
- [walkthroughs/2026-06-22-round-352-proposal-slice-anchor.md](walkthroughs/2026-06-22-round-352-proposal-slice-anchor.md)：第三百五十二轮让主体文件建议复制文本带上 `sliceId / sliceTime / sliceTitle / sliceKind`，方便后续回查原切面。
- [walkthroughs/2026-06-22-round-353-event-value-fallback.md](walkthroughs/2026-06-22-round-353-event-value-fallback.md)：第三百五十三轮让 `events.jsonl` 候选在 summary 为空时优先使用 `events` mutation 的字符串值，避免退回技术摘要。
- [walkthroughs/2026-06-22-round-354-direct-proposal-event-context.md](walkthroughs/2026-06-22-round-354-direct-proposal-event-context.md)：第三百五十四轮让 direct subject proposal 也能在 summary 为空时借用同一 slice 的 `world.events` 叙事值。
- [walkthroughs/2026-06-22-round-355-subject-aware-event-context.md](walkthroughs/2026-06-22-round-355-subject-aware-event-context.md)：第三百五十五轮收窄 event draft 语境，只借当前 subject 和 `world.events`，避免串入其它角色 `events`。
- [walkthroughs/2026-06-22-round-356-event-deduplicate-title.md](walkthroughs/2026-06-22-round-356-event-deduplicate-title.md)：第三百五十六轮让 `events.jsonl` 候选在 title 与事件值重复时只输出一次，减少手动清理。
- [walkthroughs/2026-06-22-round-357-save-notice-subject-file-proposals.md](walkthroughs/2026-06-22-round-357-save-notice-subject-file-proposals.md)：第三百五十七轮在 Slice Composer 写入 / 编辑成功后，如果保存后的 slice 能生成主体文件建议，顶部成功提示会导向右侧 Inspector。
- [walkthroughs/2026-06-22-round-358-inspector-proposal-count-badge.md](walkthroughs/2026-06-22-round-358-inspector-proposal-count-badge.md)：第三百五十八轮在 Inspector 顶栏增加主体文件建议数量徽标，让作者打开右栏时能立刻看到当前 slice 有建议。
- [walkthroughs/2026-06-22-round-359-hidden-inspector-proposal-entry.md](walkthroughs/2026-06-22-round-359-hidden-inspector-proposal-entry.md)：第三百五十九轮在 Inspector 隐藏时也让顶栏按钮和右侧恢复 rail 显示主体文件建议数量，避免保存提示指向不可见面板。
- [walkthroughs/2026-06-22-round-360-save-proposal-focus-alignment.md](walkthroughs/2026-06-22-round-360-save-proposal-focus-alignment.md)：第三百六十轮修复保存提示与 Inspector 实际 proposal 语境不一致，保存后若用 context subject 算出建议，会把 focused subject 对齐到同一主体。
- [walkthroughs/2026-06-22-round-361-slice-card-proposal-badge.md](walkthroughs/2026-06-22-round-361-slice-card-proposal-badge.md)：第三百六十一轮在 timeline slice card 上显示 `files N` 主体文件建议徽标，方便作者回看多步推演后的历史切片。
- [walkthroughs/2026-06-22-round-362-typecheck-audit-after-proposal-badges.md](walkthroughs/2026-06-22-round-362-typecheck-audit-after-proposal-badges.md)：第三百六十二轮运行全量 typecheck；失败仍集中在无关 `server/agent/tools/control-tools.test.ts` 类型漂移，未出现 World Engine 相关类型错误。
- [walkthroughs/2026-06-22-round-363-real-author-flow-browser-acceptance-plan.md](walkthroughs/2026-06-22-round-363-real-author-flow-browser-acceptance-plan.md)：第三百六十三轮固化真实作者流浏览器验收清单，覆盖 `ming-ding-zhi-shi-2`、主体同步、多步 slice 推演、主体文件建议和常用操作。
- [walkthroughs/2026-06-22-round-364-slice-card-proposal-context-copy.md](walkthroughs/2026-06-22-round-364-slice-card-proposal-context-copy.md)：第三百六十四轮澄清 slice card `files N` 的 title 文案，说明该数量按当前主体语境计算。
- [walkthroughs/2026-06-22-round-365-slice-card-proposal-entry.md](walkthroughs/2026-06-22-round-365-slice-card-proposal-entry.md)：第三百六十五轮把 slice card 的 `files N` 从只读徽标改成入口，点击后选中 slice 并打开右侧 Inspector。
- [walkthroughs/2026-06-22-round-366-slice-card-proposal-scroll-target.md](walkthroughs/2026-06-22-round-366-slice-card-proposal-scroll-target.md)：第三百六十六轮让 `files N` 入口打开 Inspector 后自动滚到 `Subject file proposals` 区域。
- [walkthroughs/2026-06-22-round-367-hidden-inspector-proposal-target.md](walkthroughs/2026-06-22-round-367-hidden-inspector-proposal-target.md)：第三百六十七轮让隐藏 Inspector 时的顶栏按钮和右侧恢复 rail 也能直达主体文件建议区域，并补齐 mock preview 的同类入口。
- [walkthroughs/2026-06-22-round-368-proposal-copy-failure-notice.md](walkthroughs/2026-06-22-round-368-proposal-copy-failure-notice.md)：第三百六十八轮为主体文件建议复制动作增加剪贴板失败提示，避免作者点击复制后没有反馈。
- [walkthroughs/2026-06-22-round-369-typecheck-audit-after-proposal-copy-fallback.md](walkthroughs/2026-06-22-round-369-typecheck-audit-after-proposal-copy-fallback.md)：第三百六十九轮运行全量 typecheck；失败仍集中在无关 `server/agent/tools/control-tools.test.ts` 类型漂移，未出现 World Engine / Workbench 相关类型错误。
- [walkthroughs/2026-06-22-round-370-browser-acceptance-plan-refresh.md](walkthroughs/2026-06-22-round-370-browser-acceptance-plan-refresh.md)：第三百七十轮刷新真实作者流浏览器验收清单，补入 proposal 入口直达和复制失败反馈检查项。
- [walkthroughs/2026-06-22-round-371-real-project-preflight.md](walkthroughs/2026-06-22-round-371-real-project-preflight.md)：第三百七十一轮只读预检 `ming-ding-zhi-shi-2` 的 schema、calendar 和 `player` 六文件，确认验收目标存在，并记录旧月名与当前数字月格式并存的观察点。
- [walkthroughs/2026-06-22-round-372-real-project-sqlite-preflight.md](walkthroughs/2026-06-22-round-372-real-project-sqlite-preflight.md)：第三百七十二轮通过 `WorldEngineFacade` 只读预检 `ming-ding-zhi-shi-2` 的 Project SQLite，确认当前有 7 个 World Engine subject、6 个初始化 / 迁移 slice、读时 issues 为 0；同时修正验收心智：`sample-npc` 是 Workbench 显式忽略的示例主体，不能作为待接入 subject 验收点。
- [walkthroughs/2026-06-22-round-373-pre-browser-static-acceptance-audit.md](walkthroughs/2026-06-22-round-373-pre-browser-static-acceptance-audit.md)：第三百七十三轮做浏览器验收前静态审查，核对 Workbench / Preview 关键入口与 `sample-npc` 忽略逻辑，并运行 3 个 World Engine 窄测试，28 条通过。
- [walkthroughs/2026-06-22-round-374-browser-acceptance-pending-subject-prerequisite.md](walkthroughs/2026-06-22-round-374-browser-acceptance-pending-subject-prerequisite.md)：第三百七十四轮修正浏览器验收清单，把“同步主体系统”改为有前置条件的条件项；当前 `ming-ding-zhi-shi-2` 没有可用待接入主体，`sample-npc` 不可作为测试对象。
- [walkthroughs/2026-06-22-round-375-backend-api-agent-pre-browser-evidence.md](walkthroughs/2026-06-22-round-375-backend-api-agent-pre-browser-evidence.md)：第三百七十五轮运行 World Engine 后端 / API / Agent 目标测试，`4 files / 138 tests` 通过，作为浏览器验收前的底层链路证据。
- [walkthroughs/2026-06-22-round-376-real-browser-acceptance-runbook.md](walkthroughs/2026-06-22-round-376-real-browser-acceptance-runbook.md)：第三百七十六轮把真实浏览器验收清单细化为可执行 runbook，固定 `player` 语境、`14:00:06` 到 `14:00:09` 的测试 slice 数据、proposal 检查、编辑 / 删除 / 查询 / 草稿保护步骤。
- [walkthroughs/2026-06-22-round-377-browser-acceptance-cleanup-policy.md](walkthroughs/2026-06-22-round-377-browser-acceptance-cleanup-policy.md)：第三百七十七轮补充真实浏览器验收后的 `[验收]` slice 清理 / 保留策略，明确先记录结果再由用户决定是否通过 Workbench UI 清理。
- [walkthroughs/2026-06-22-round-378-runbook-time-window-preflight.md](walkthroughs/2026-06-22-round-378-runbook-time-window-preflight.md)：第三百七十八轮只读预检 runbook 时间窗口，确认 `14:00:06` 到 `14:00:09` 当前没有已存在 slice，可用于正式浏览器验收。
- [walkthroughs/2026-06-22-round-379-browser-acceptance-result-template.md](walkthroughs/2026-06-22-round-379-browser-acceptance-result-template.md)：第三百七十九轮补充浏览器验收结果模板，把 runbook 各步骤拆成 pass/fail/skip、证据和后续动作表格，方便授权后直接执行并记录。
- [walkthroughs/2026-06-22-round-380-real-browser-acceptance-result.md](walkthroughs/2026-06-22-round-380-real-browser-acceptance-result.md)：第三百八十轮按 runbook 执行真实浏览器验收，实际写入三条 `[验收]` 主线 slice 并删除专用测试 slice；确认打开真实 Project、默认 `world.events` 回退、连续写入、metadata 编辑、state 展开和 delete API 可用，同时发现 `files N` proposal 直达不稳定与 Composer 编辑 value 未落库两个 P0 前端问题。
- [walkthroughs/2026-06-22-round-381-author-flow-p0-fixes.md](walkthroughs/2026-06-22-round-381-author-flow-p0-fixes.md)：第三百八十一轮修复真实作者流两个 P0：`files N` 稳定绑定 clicked slice + proposal subject，Composer Builder text value 不再把 `[验收]` 误当 JSON，编辑保存真实落库；同时让主体文件 proposal 优先使用最新 `events` mutation narrative。
- [walkthroughs/2026-06-22-round-382-author-flow-common-actions.md](walkthroughs/2026-06-22-round-382-author-flow-common-actions.md)：第三百八十二轮补验作者常用动作前，修复 Composer 删除 / 移动 mutation 后旧 Builder dirty 草稿可能覆盖列表操作的问题；真实浏览器补验发现 proposal 语境和 subject filter 混在一起，随后给左栏主体卡片增加独立 `语境` 入口，整体时间线下 Step C `files 1` 已能直达 `薇洛丝 / 当前主体语境下的 world 事件建议`，剪贴板复制和打开目标文件仍待单独复验。
- [walkthroughs/2026-06-22-round-383-subject-filter-clear-discoverability.md](walkthroughs/2026-06-22-round-383-subject-filter-clear-discoverability.md)：第三百八十三轮把 subject filter 的 `清空过滤` 入口前移到中间列表顶部 scope 区，并在真实浏览器确认单 subject 视角可回到整体世界。
- [walkthroughs/2026-06-22-round-384-close-button-accessibility-and-confirm-audit.md](walkthroughs/2026-06-22-round-384-close-button-accessibility-and-confirm-audit.md)：第三百八十四轮为 Workbench / Slice Composer 关闭按钮补可访问名称和 test id；再次审查原生 confirm 取消分支，但 in-app browser 自动化仍无法可靠提供 dismiss 证据。
- [walkthroughs/2026-06-22-round-385-app-dialog-draft-confirm.md](walkthroughs/2026-06-22-round-385-app-dialog-draft-confirm.md)：第三百八十五轮把主 Workbench 的高风险原生确认迁到应用内 `useDialog()`，并在真实浏览器确认 Slice Composer 关闭取消分支会保留草稿。
- [walkthroughs/2026-06-22-round-386-mutation-editor-new-mode-dialog.md](walkthroughs/2026-06-22-round-386-mutation-editor-new-mode-dialog.md)：第三百八十六轮把 Slice Composer 内部“新建模式”草稿确认迁到应用内 `useDialog()`，并用静态契约测试钉住。
- [walkthroughs/2026-06-23-round-387-new-mode-dialog-browser-acceptance.md](walkthroughs/2026-06-23-round-387-new-mode-dialog-browser-acceptance.md)：第三百八十七轮真实浏览器补验 Slice Composer 编辑模式下点击“新建模式”的应用内确认取消分支，确认草稿和编辑模式都保留。
- [walkthroughs/2026-06-23-round-388-workbench-confirm-cancel-branches.md](walkthroughs/2026-06-23-round-388-workbench-confirm-cancel-branches.md)：第三百八十八轮真实浏览器补验 Workbench 关闭、打开工作区文件和删除 slice 三条应用内确认取消分支。
- [walkthroughs/2026-06-23-round-389-clear-subject-context.md](walkthroughs/2026-06-23-round-389-clear-subject-context.md)：第三百八十九轮为主体文件建议语境补显式 `清语境` 出口，并在真实浏览器确认清空语境不会改变 timeline subject filter。
- [walkthroughs/2026-06-23-round-390-copy-and-open-subject-file-proposal.md](walkthroughs/2026-06-23-round-390-copy-and-open-subject-file-proposal.md)：第三百九十轮为主体文件建议补 `复制并打开`，修复作者先打开文件后丢失 proposal 上下文的顺序坑；浏览器自动化受剪贴板权限限制，只验证到按钮可见和失败保护。
- [walkthroughs/2026-06-23-round-391-hide-init-subject-file-proposals.md](walkthroughs/2026-06-23-round-391-hide-init-subject-file-proposals.md)：第三百九十一轮过滤 `init` slice 的主体文件建议，真实浏览器确认初始化切面不再显示 `files N`，而 event slice 在主体语境下仍显示 `files 1` 并能打开 proposal。
- [walkthroughs/2026-06-23-round-392-preview-delete-app-dialog.md](walkthroughs/2026-06-23-round-392-preview-delete-app-dialog.md)：第三百九十二轮把独立 Preview 删除 slice 确认迁到应用内 Dialog，并在真实浏览器确认取消后不删除数据。
- [walkthroughs/2026-06-23-round-393-strip-acceptance-tags-from-proposals.md](walkthroughs/2026-06-23-round-393-strip-acceptance-tags-from-proposals.md)：第三百九十三轮让主体文件建议清理内部 `[验收]` 前缀，真实浏览器确认 `events.jsonl` 候选不再带验收标签。
- [walkthroughs/2026-06-23-round-394-proposal-landing-hints.md](walkthroughs/2026-06-23-round-394-proposal-landing-hints.md)：第三百九十四轮补主体文件建议落地提示，明确 `events.jsonl` 追加末尾、`memory.jsonl` 追加或按 topic 改写、`state.md` 检查对应区块。
- [walkthroughs/2026-06-23-round-395-schema-openpath-browser-acceptance.md](walkthroughs/2026-06-23-round-395-schema-openpath-browser-acceptance.md)：第三百九十五轮只读浏览器验收 Preview 与主 Workbench 的 schema/calendar 配置文件入口，确认主 IDE 能消费 `openPath` 并打开真相源文件。
- [walkthroughs/2026-06-23-round-396-subject-context-visibility.md](walkthroughs/2026-06-23-round-396-subject-context-visibility.md)：第三百九十六轮修复主体文件建议语境可见状态错位，避免 `world` 焦点让左栏显示假的 `清语境`。
- [walkthroughs/2026-06-23-round-397-subject-file-commit-decision-list.md](walkthroughs/2026-06-23-round-397-subject-file-commit-decision-list.md)：第三百九十七轮审查 P1 显式 commit / 追加六文件设计，建议第一版只做单条 `events.jsonl` 显式追加。
- [walkthroughs/2026-06-23-round-398-subject-event-commit-api.md](walkthroughs/2026-06-23-round-398-subject-event-commit-api.md)：第三百九十八轮落地单条 `events.jsonl` 显式 commit 后端 API，支持幂等追加、目标路径校验和 events RAG dirty 标记，尚未接前端按钮。
- [walkthroughs/2026-06-23-round-399-subject-event-commit-ui.md](walkthroughs/2026-06-23-round-399-subject-event-commit-ui.md)：第三百九十九轮把单条 `events.jsonl` commit API 接到 Workbench Inspector 的 `追加` 按钮，真实 Workbench 调 API 并刷新主体系统 overview，mock 浏览器烟测确认不会写真实文件。
- [walkthroughs/2026-06-23-round-400-real-event-commit-cancel-acceptance.md](walkthroughs/2026-06-23-round-400-real-event-commit-cancel-acceptance.md)：第四百轮在真实 `ming-ding-zhi-shi-2` Workbench 验收 `events.jsonl` 追加确认取消分支，取消后目标文件 hash 未变，仍未执行真实确认写入。
- [walkthroughs/2026-06-23-round-401-event-proposal-subject-voice-pronouns.md](walkthroughs/2026-06-23-round-401-event-proposal-subject-voice-pronouns.md)：第四百零一轮修正 `events.jsonl` 主体经历草稿中的常见第三人称残留，真实浏览器确认 `给了她...她决定...` 已显示为 `给了我...我决定...`。
- [walkthroughs/2026-06-23-round-402-event-commit-session-state.md](walkthroughs/2026-06-23-round-402-event-commit-session-state.md)：第四百零二轮为 `events.jsonl` commit 增加 Workbench 会话态，API 返回 `appended` / `already-exists` 后同一 proposal 按钮显示 `已追加` 并禁用，避免重复点击。
- [walkthroughs/2026-06-23-round-403-temp-project-event-commit-browser-acceptance.md](walkthroughs/2026-06-23-round-403-temp-project-event-commit-browser-acceptance.md)：第四百零三轮用临时 Project 真实浏览器验收 `events.jsonl` commit 的 `appended`、刷新后 `already-exists` 和会话态 `已追加` 禁用闭环；真实 `ming-ding-zhi-shi-2` hash 未变，临时 Project 已清理，同时记录 Project delete API 超时后残留 `.nbook` 的观察点。
- [walkthroughs/2026-06-23-round-404-project-delete-world-engine-client-release.md](walkthroughs/2026-06-23-round-404-project-delete-world-engine-client-release.md)：第四百零四轮修复 Project 删除前未释放 World Engine PrismaClient 的问题；打开过 World Engine SQLite 的 Project 现在能通过 `deleteProjectWorkspace()` 完整删除，不再复现 `.nbook` 残留。
- [walkthroughs/2026-06-23-round-405-subject-system-init-attrs-sync.md](walkthroughs/2026-06-23-round-405-subject-system-init-attrs-sync.md)：第四百零五轮让 `createSubject` 支持 schema 声明 attrs 初始化，并让 Workbench 同步主体系统时写入已声明的路径 / 六文件拓扑 / RAG source / 计数元数据，避免 UI 摘要与 World Engine state 割裂。
- [walkthroughs/2026-06-23-round-406-new-project-subject-sync-browser-acceptance.md](walkthroughs/2026-06-23-round-406-new-project-subject-sync-browser-acceptance.md)：第四百零六轮用临时 Project 浏览器验收新建 Project、设置 schema/六文件 fixture、同步主体系统、连续写 slice、主体文件建议、State Snapshot 和删除 slice；同时记录缺少 `world` subject 时 `world.events` 写入失败，以及 Project delete API 客户端超时但最终删除的问题。
- [walkthroughs/2026-06-23-round-407-world-subject-bootstrap.md](walkthroughs/2026-06-23-round-407-world-subject-bootstrap.md)：第四百零七轮补 `world` subject 显式创建入口，并禁用未实例化 subject type 的 schema shortcut；不自动创建，不写 `simulation/subjects` 六文件。
- [walkthroughs/2026-06-23-round-408-world-subject-bootstrap-browser-acceptance.md](walkthroughs/2026-06-23-round-408-world-subject-bootstrap-browser-acceptance.md)：第四百零八轮用临时 Project 浏览器验收 `world` subject bootstrap：同步 player 后显式创建 `world`，再通过 UI 写入 `world.events`，State Query 返回事件且 `issues=0`；临时 Project 已清理，3001 已释放。
- [walkthroughs/2026-06-23-round-409-project-delete-ebusy-retry-window.md](walkthroughs/2026-06-23-round-409-project-delete-ebusy-retry-window.md)：第四百零九轮把 Project Workspace 删除的 Windows `EBUSY` 重试窗口从短重试扩大到 `maxRetries=20 / retryDelay=500ms`，目标删除测试通过。
- [walkthroughs/2026-06-23-round-410-world-bootstrap-preserve-subject-context.md](walkthroughs/2026-06-23-round-410-world-bootstrap-preserve-subject-context.md)：第四百一十轮修复 `world` subject bootstrap 抢走角色主体文件建议语境的问题；临时 Project 浏览器验收确认创建 `world` 后 `player` 仍为 `语境中`，写入 `world.events` 后 slice 显示 `files 1` 并生成 `player` 主体文件建议。
- [walkthroughs/2026-06-23-round-411-default-template-subject-system-schema.md](walkthroughs/2026-06-23-round-411-default-template-subject-system-schema.md)：第四百一十一轮把默认 Project 模板的 `character` schema 补齐六文件主体系统映射字段；新 Project 同步模板内置 `player` 后可把 `sourcePath / subjectFiles / ragIndexSources` 等写入 World Engine init state。
- [walkthroughs/2026-06-23-round-412-default-template-browser-acceptance.md](walkthroughs/2026-06-23-round-412-default-template-browser-acceptance.md)：第四百一十二轮用临时 Project 做真实浏览器验收，确认默认模板不手写 schema 时，Workbench 同步内置 `player` 会显示主体系统、`2 events / 2 memory`，State Query 返回六文件路径、RAG source、计数和 `issues: []`。
- [walkthroughs/2026-06-23-round-413-default-template-full-flow-acceptance.md](walkthroughs/2026-06-23-round-413-default-template-full-flow-acceptance.md)：第四百一十三轮用默认模板临时 Project 跑完整作者流：同步 `player`、创建 `world`、连续写入两步、生成 `files 1` 主体文件建议、删除临时 slice、编辑已有 slice，并用 State Query 确认最终 `issues=[]`。
- [walkthroughs/2026-06-23-round-414-project-delete-marker-fallback.md](walkthroughs/2026-06-23-round-414-project-delete-marker-fallback.md)：第四百一十四轮修复 Project 删除在 Windows/Nuxt 下的真实作者路径卡点：删除 API 先释放模块句柄，物理移动失败时写 `.nbook/deleted-project.json`，让 Project 立即从列表消失并阻止同 slug 复用，物理清理后台化；5 轮真实 HTTP 删除回归均在约 0.9-1.6s 返回成功。
- [walkthroughs/2026-06-23-round-415-default-template-workbench-after-delete-marker.md](walkthroughs/2026-06-23-round-415-default-template-workbench-after-delete-marker.md)：第四百一十五轮在删除 marker 兜底后，用临时 Project 真实浏览器复验主 IDE Workbench：默认模板进入、创建 `world`、同步 `player`、写入 `player.events`、看到 `files 1` / State Snapshot 变更，并通过书架 UI 删除临时 Project；删除真实触发 `.nbook/deleted-project.json` 兜底且用户可见列表已隐藏。
- [walkthroughs/2026-06-23-round-416-bookshelf-create-project-route-sync.md](walkthroughs/2026-06-23-round-416-bookshelf-create-project-route-sync.md)：第四百一十六轮修复书架新建 Project 后 URL query 可能停在旧 `projectPath` 的入口问题：`createNovel()` 刷新列表时带上新 Project 的 `includeProjectPath`，并用 store 测试和真实浏览器窄复验确认新建后 URL 立即规范到新 Project。
- [walkthroughs/2026-06-23-round-417-refresh-deeplink-deleted-project-404.md](walkthroughs/2026-06-23-round-417-refresh-deeplink-deleted-project-404.md)：第四百一十七轮继续做新建 Project 后刷新 / deep link 验收；过程中发现已删除 Project 旧链接会让 Project Workspace 断言抛未处理 `ENOENT`，已改为稳定 `404 Project Workspace 不存在` 并补回归测试。真实浏览器确认新建临时 Project 后刷新仍停在新 Project，且可打开默认模板 World Engine Workbench。
- [walkthroughs/2026-06-23-round-418-stale-project-route-recovery.md](walkthroughs/2026-06-23-round-418-stale-project-route-recovery.md)：第四百一十八轮补齐已删除 Project 旧链接的前端恢复：route 初始化先确认 Project 列表，缺失时切到可用 Project、规范 URL，并显示 `Project 已不可用` warning；真实浏览器确认旧链接会切到 `World Tools Test` 并仍可打开 World Engine。
- [walkthroughs/2026-06-23-round-419-stale-project-openpath-discard.md](walkthroughs/2026-06-23-round-419-stale-project-openpath-discard.md)：第四百一十九轮补齐旧 Project 链接携带 `openPath` 时的恢复细节：fallback 到可用 Project 时会丢弃原链接文件路径并提示，避免打开 fallback Project 的同名 schema/calendar 文件；真实浏览器确认 URL 清掉 `openPath`，未打开 schema 内容。
- [walkthroughs/2026-06-23-round-420-calendar-ts-frontend-entry.md](walkthroughs/2026-06-23-round-420-calendar-ts-frontend-entry.md)：第四百二十轮将 Preview / 主 Workbench 的 Calendar 配置入口切到 `world-engine/calendar.ts`，并在旧 Project 缺文件时由前端通过 workspace-files create API 创建默认 Simple Calendar 草稿再打开。
- [walkthroughs/2026-06-23-round-421-calendar-ts-openpath-browser-acceptance.md](walkthroughs/2026-06-23-round-421-calendar-ts-openpath-browser-acceptance.md)：第四百二十一轮修正 `calendar.ts` 深链打开顺序，先用文件树判断缺失再创建默认草稿，真实浏览器确认旧 Project 缺文件时可自动创建并打开且不新增 ENOENT 日志。
- [walkthroughs/2026-06-23-round-422-task64-65-calendar-doc-sync.md](walkthroughs/2026-06-23-round-422-task64-65-calendar-doc-sync.md)：第四百二十二轮同步 Task 64 / 65 文档到最新 Calendar 路线，明确 `calendar.ts` 是唯一入口，`calendar.yaml` 兼容 / fallback 只作为历史旧设想保留。
- [walkthroughs/2026-06-23-round-423-calendar-ts-default-template-api-smoke.md](walkthroughs/2026-06-23-round-423-calendar-ts-default-template-api-smoke.md)：第四百二十三轮用临时 Project 做默认模板 API 烟测，确认 `calendar.ts` 时间格式下 create subject、write slice、state query、delete slice 和状态回退均可用且 issues 为 0。

## TODO / Follow-ups

- 真实作者流 P0 已补最小入口和出口：左栏 subject 卡片的 `语境 / 语境中` 只设置主体文件建议的 `focusedSubjectId`，标题区 `清语境` 只在该语境是主体系统 subject 时显示，不改变中间 timeline 过滤；整体时间线下可把 `player / 薇洛丝` 设为主体语境并让 Step C `world.events` 显示 `files 1`，也可显式回到整体世界视角。
- 主体文件建议现在同时支持单独复制、单独打开和 `复制并打开`；复制失败时不会离开 Workbench，复制并打开的落地提示已覆盖 `events.jsonl` 末尾追加、`memory.jsonl` 追加 / 改写和 `state.md` 区块审查。后续如果要真正代写或追加文件，需要进入 P1 显式 commit 设计。
- P1 显式 commit 的 `events.jsonl` 最小闭环已落地并通过临时 Project 真实浏览器验收：只支持单个 proposal 的幂等追加，保持 `{text,time}` 行格式并用 `time + text` 去重；`memory.jsonl` 与 `state.md` 暂不自动写，只保留 copy / review；commit 后只标记 events dirty，不自动 RAG rebuild，并刷新主体系统 overview。真实 `ming-ding-zhi-shi-2` 只验取消和 hash 不变，后续除非用户明确授权目标行，不需要再对真实项目执行确认写入。
- Round 403 暴露的 Project delete API 超时 / `.nbook` 残留已修复：删除 Project Workspace 前会释放 World Engine Project PrismaClient，并已用目标测试和最小复现脚本覆盖打开过 World Engine SQLite 后的删除路径。
- 主体系统同步现在会把 schema 已声明的主体系统映射 attrs 写进 init slice；真实 `ming-ding-zhi-shi-2/player` 已只读确认存在 `sourcePath / subjectFiles / ragIndexSources / eventCount / memoryCount`，暂不需要自动 backfill。若后续遇到旧 Project 缺这些字段，应设计显式刷新动作，不在 Workbench 打开时静默改写。
- 新 Project 作者流已完成临时浏览器验收；Round 407/408 已采用并验证显式 `world` subject bootstrap：schema 有 `world` type 且缺少 `world` subject 时，左栏会提示创建 `world`，并且未实例化 subject type 的 schema shortcut 会禁用；Round 410 又修复创建 `world` 后抢走角色语境的问题，临时 Project 已确认同步 player 后创建 `world` 仍保留 `player` 主体文件建议语境，再写入 `world.events` 会显示 `files 1` 并生成 `player` proposal。Round 411/412 已让默认 Project 模板的 `character` schema 声明主体系统映射字段，并用真实 Workbench 验收确认新建 Project 同步内置 `player` 时会把六文件路径 / RAG source / 计数写入 World Engine state，query `issues` 为空。Round 413 又用默认模板跑通同步、创建 `world`、连续写入、主体文件建议、删除、编辑和 State Query 对账。Round 415 在删除 marker 兜底后复验同一路径，确认创建 `world`、同步 `player`、写 `player.events` 与删除临时 Project 仍连贯。
- Project delete API 在 Round 406/408 暴露 Windows 下 Project SQLite 句柄与目录物理删除的长尾问题；Round 409 的 retry 只能吸收短暂 `EBUSY`，Round 414 已改为 deleted marker 兜底：删除返回时 Project 从列表消失且同 slug 不会被新建复用，物理清理后台化。后续若看到 `.nbook/deleted-project.json` 残留，应按后台清理问题处理，不再把作者删除动作卡在同步物理删除上。
- 书架新建 Project 后的 URL 同步已修：`createNovel()` 刷新列表会带 `includeProjectPath`，避免 route watcher 因列表里暂时没有新 Project 而把 URL 规范回旧 Project；真实浏览器确认新建后 URL 立即变为新 Project。
- 已删除 Project 的旧链接 / 历史 URL 现在会在 `assertProjectWorkspaceDirectory()` 统一返回稳定 404，不再把 `/api/config/bootstrap`、`/api/config/editor-snapshot`、`/api/workspace-files/tree` 等常用入口打成未处理 `ENOENT`；真实浏览器同时确认新建 Project 后刷新仍保持在新 Project 并可打开 Workbench。后续若要让前端自动从 404 Project 切到可用 Project / 书架，需要单独设计体验。
- 前端旧链接恢复已补：页面打开已删除 Project URL 时会先查项目列表，目标缺失则切到当前可用 Project、规范 URL，并提示 `Project 已不可用`；真实浏览器确认恢复后仍能打开 World Engine。
- 旧链接带 `openPath` 的误导风险已补：Project fallback 发生时会从 URL 移除 `openPath`，不在 fallback Project 中打开同名文件，并提示 `已忽略原链接中的文件路径`；常规有效 Project 的 schema / calendar 深链不受影响。
- `init` slice 已不再生成主体文件建议；主体文件建议只服务推演事件 / 状态变化后的人工六文件处理，不把 subject 注册和 schema default 初始化写成角色经历。
- 主体文件建议已过滤内部验收前缀，避免开发验收数据污染 `events.jsonl` 候选；该过滤只针对 `[验收]` / `[验收-...]` 前缀，不做通用标题清洗。
- Slice Composer 编辑 value 落库 P0 已在 Round 381 修复；Round 382 又补了删除 / 移动 mutation 后清理或重载 Builder dirty 草稿，避免保存前旧草稿覆盖列表操作。
- Workbench / Composer 关闭、打开工作区文件前的草稿确认、删除 slice 确认、独立 Preview 删除 slice 确认，以及 `WorldEngineMutationEditor.vue` 内部“切换到新建模式”的草稿确认已迁到应用内 Dialog 并完成主要取消分支浏览器验收。
- 扩展 Calendar：第一版已支持项目可配置序列化 / 反序列化格式；完整单位层级、gregorian / fantasy-simple 预设、不规则进位换算与缓存策略可后续细化。
- 定论模糊时间方案是否进第一版。
- 讨论 `editSlice` 后续产品交互：第一版已采用整块替换，preview 已可载入已有 slice 编辑；若需要追加 / 删除单条 mutation，再设计 patch 语义。
- 厘清与现有 plot + simulation（events.jsonl / memory.jsonl / runs / ticks）的迁移或共存边界。
- 主 IDE Workbench 后续继续产品化：当前已支持创建 subject、timeline、当前 subject timeline 过滤、timeline 搜索、selected slice 触及主体快捷选择、subject 状态查询、State Query 摘要视图与 query issues、selected slice 时刻状态查询、selected slice 触及主体批量状态查询、schema 浏览、示例世界、mutation 写入 / 编辑、slice 删除、slice issue badge、schema-aware value 控件、object value 行编辑器、固定 object fields 子表单、schema fields/itemType 投影、attr path 输入和 dirty guard；Mutation Builder 的 value 类型读取已统一为 list / collection 优先 `itemType`、其他属性使用 `type`，用于默认值、ref 下拉、value mode 和 value 类型提示；`list/collection itemType=object` 前后端契约已对齐，会显示顶层 JSON textarea、提交前校验必须是 JSON object，后端 schema / mutation 校验也会拒绝非 object item；开放 object 行编辑器会继承根 object 的 `itemType` 渲染 value 控件与默认值；Builder 已支持选择载入、追加、插入所选后方、复制所选、替换所选、删除所选、替换全部、上移 / 下移；固定 object fields 子表单会按字段 schema 渲染控件，嵌套 object 字段会显示 JSON 输入区并在提交前校验必须是 JSON object，但字段必须显式勾选才写入对象；Timeline、State Query 摘要、Selected Slice 检查器、Mutation Builder 顶部列表控制条、底部动作按钮和 object value / fixed fields 输入区已拆成子组件，后续需要补批量/模板化 mutation、必要时继续扩展递归 object / collection 控件，以及浏览器真实验收。
- 独立 Preview 后续若继续扩展 UI，建议优先放进已拆出的子组件；当前 `world-engine.preview.vue` 约 1083 行，已超过 800 行限制，后续应优先拆 API/session/composable 或继续下沉子组件，不要再把复杂 Builder / 状态流逻辑堆回页面单文件。
- Preview 若继续积累大量测试 Project，可考虑增加“仅显示 World Engine 相关 Project”或测试 Project 清理入口。
- 真实作者流 P0：需要定论 World Engine slice 与 `simulation/subjects` 六文件主体状态的桥接方式。当前 `ming-ding-zhi-shi-2` 的角色叙事状态主要在 `state.md / events.jsonl / memory.jsonl`，而 `character` schema 主要是结构化字段和主体系统路径；作者写 slice 后不会自然更新角色六文件，容易误解“世界引擎是否推进了角色状态”。
- 主 Workbench / mock Workbench Inspector 已落地 P0 主体文件建议面：选中 slice 后会根据 mutations、focused subject 与 `simulation/subjects` discovery 生成建议；角色没有 `events` attr、slice 落到 `world.events` 时仍能保留当前角色语境。该功能只展示建议，不自动写六文件。
- 主体文件建议面已支持复制单个 subject proposal；复制内容包含 events draft、memory facts、state review 和“不自动写入 simulation/subjects”的边界提示。
- mock `/world-engine.workbench-preview` 已补 `mockWorkbenchSubjectSystemSummaries` 并传给 Sidebar / Inspector，沙盘也可以看到主体文件建议面；本轮相关 vitest 与 `bun run typecheck` 均通过。
- 主体文件建议面已支持打开目标路径：真实 Workbench 里 `events.jsonl / memory.jsonl / state.md` 路径按钮会走主 IDE 的 Project Workspace 文件打开链路；mock 沙盘只展示路径 notice。本轮相关 vitest 与 `bun run typecheck` 均通过。下一步若继续桥接，应先决策是否进入 P1 显式 commit，而不是默认自动写六文件。
- 主体文件建议面已输出可粘贴 JSONL candidate：`events.jsonl` 建议会生成 `{"text":"...","time":"..."}`，`memory.jsonl` 建议会从 `memory.* / relationship.*` mutation 生成 `{"topic":"...","view":"..."}` 候选；复制文本会同时包含 `jsonl:` 和 `readable:`，仍由作者确认后手动写入。本轮相关 vitest 通过；`bun run typecheck` 被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞。
- 主体文件建议面已支持精确复制 JSONL 行：`events.jsonl draft` 可复制单条 event 行，`memory facts` 可复制全部 memory 候选行；完整“复制建议”仍保留用于审查上下文。本轮相关 vitest 通过；未重复执行已知被无关测试漂移阻塞的全量 typecheck。
- `events.jsonl` 候选行的 `text` 已去掉重复时间前缀，避免手动粘贴后同时在 `time` 字段和正文里出现同一时间；Inspector readable 摘要仍保留时间，方便快速审查来源 slice。本轮相关 vitest 通过；未重复执行已知被无关测试漂移阻塞的全量 typecheck。
- `state.md review` 已增加常见区块提示：`location` 会提示检查 `当前位置`，`hp/mp/sp/exp` 提示 `资源`，`inventory/equipment` 提示 `持有物品`，`appearance/body/status` 提示 `身体与姿态`，`relationship/faction` 提示 `关系压力`，`goal/shortTermGoal` 提示 `短期目标`。本轮相关 vitest 通过；未重复执行已知被无关测试漂移阻塞的全量 typecheck。
- `events.jsonl` 候选正文已更贴近主体经历流：生成 `我经历了这件事：...` 草稿，并把当前 subject name 的直接出现保守替换为 `我`；这仍不是自动文学润色，写入前需要作者确认角色口吻。本轮相关 vitest 通过；未重复执行已知被无关测试漂移阻塞的全量 typecheck。
- 主体文件建议 UI 与复制文本已补人工确认提示：`events.jsonl` 候选写入前需确认第一人称口吻、角色当时知道什么、是否应追加；`memory.jsonl` 候选写入前需确认追加新 topic 还是改写已有 topic。本轮相关 vitest 通过；未重复执行已知被无关测试漂移阻塞的全量 typecheck。
- 主体系统同步入口已明确边界：同步只注册 World Engine subject 身份，不复制或改写 `simulation/subjects` 六文件正文；六文件维护仍走主体文件建议 / 作者人工确认路径。本轮相关 vitest 通过；未重复执行已知被无关测试漂移阻塞的全量 typecheck。
- 左栏 subject 卡片已支持直接打开主体系统常用文件：`subject.md / events.jsonl / memory.jsonl / state.md`；这只做导航，不读取或写入六文件内容。本轮相关 vitest 通过；`bun run typecheck` 仍被无关 `server/agent/tools/control-tools.test.ts` 测试类型漂移阻塞，未出现本轮 Sidebar / World Engine 新错误。
- mock `/world-engine.workbench-preview` 已把左栏 subject 文件按钮接到 `openMockWorkspacePath()`，和 Inspector 文件按钮一样显示 mock path notice；`bunx vitest run app/utils/world-engine-workbench-preview.test.ts` 通过。
- `state.md review` 已支持独立复制审查提示：作者不必复制整份 proposal 再手动挑 state review；该入口仍只复制文本，不自动写 `simulation/subjects`。`bunx vitest run app/utils/world-engine-workbench-preview.test.ts` 通过。
- 主体文件建议已增加来源标签：direct mutation 会显示 `直接触及该主体`；角色事件回退到 `world.events`、由 focused subject 生成的建议会显示 `当前主体语境下的 world 事件建议`，复制整份 proposal 时也带 `source:`。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过；`bun run typecheck` 仍被无关 `server/agent/tools/control-tools.test.ts` 类型漂移阻塞。
- 主体文件建议已支持“复制全部”：多主体 slice 可以把全部 subject proposal 用 `---` 分隔后一次性复制，方便人工审查或交给后续 Agent；仍不自动写六文件。`bunx vitest run app/utils/world-engine-workbench-preview.test.ts` 通过。
- 主体文件建议已支持“复制并打开”：`events.jsonl` 行、`memory.jsonl` 候选行和 `state.md` 审查提示会先复制目标文本，复制成功后才打开对应主体文件；Workbench 打开文件链路也改为先关闭 Workbench，再请求父层打开 Project Workspace 文件，避免底层文件已打开但 Workbench 仍挡住。
- 主体文件建议复制文本已带稳定 slice 锚点：`sliceId / sliceTime / sliceTitle / sliceKind` 会出现在 proposal 头部，方便后续人工审查或 Agent 回查原切面。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- `events.jsonl` 候选文本已优化 summary 为空的 fallback：会优先提取 `events` mutation 的字符串 value，再退回技术 mutation 摘要，避免把 `world.events listAppend = ...` 写进主体经历草稿。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- direct subject proposal 的 `events.jsonl` 候选也会优先使用同一 slice 的 `events` 叙事值；例如 slice 同时有 `world.events` 和 `player.location`、summary 为空时，不再把 `player.location set ...` 塞进经历草稿。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- `events.jsonl` 候选的 event 语境已收窄到当前 subject 自己的 `events` 和 `world.events`；多主体 slice 中其它角色自己的 `events` 不会串进当前角色 proposal。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- `events.jsonl` 候选已处理 title 与事件值完全重复的情况：转成主体口吻并去掉常见标点 / 空白后相同则只输出一遍，避免 `我走向大厅。我走向大厅。` 这类重复草稿。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Slice Composer 写入 / 编辑成功后，如果刷新后的真实 slice 能生成主体文件建议，顶部成功提示会追加 `可在右侧 Inspector 查看 N 个主体文件建议`，让作者自然进入 P0 六文件人工处理流程；该提示不自动写 `simulation/subjects`，也不调用 Agent 工具。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Inspector 顶栏已显示主体文件建议数量徽标：当前 selected slice 有 proposal 时，右栏标题区域会显示 `N proposals`，避免建议区域在滚动下方时作者误以为没有后续处理内容；该徽标只读，不自动写六文件。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- 真实 Workbench 在 Inspector 隐藏时也会把当前 slice 的主体文件建议数量显示到顶栏 Inspector 按钮和右侧恢复 rail；按钮 title 会同时列出 metadata 草稿和主体文件建议，metadata 草稿高亮优先级保持不变。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Slice Composer 保存后，顶部提示和 Inspector 实际内容现在使用同一个 proposal context：如果 `payload.contextSubjectId` 能为保存后的 slice 生成主体文件建议，且该主体已注册，Workbench 会把 `focusedSubjectId` 对齐到该主体，再提示作者去 Inspector 查看建议，避免 `world.events` 保存后提示有建议但右栏落回 `world`。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Timeline slice card 已显示主体文件建议数量徽标：当前 slice 根据 focused subject 和 `simulation/subjects` 摘要能生成 proposal 时，卡片顶部会显示 `files N`，让作者回看历史切片时不用先点进右栏才知道有六文件后续建议。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Round 357-361 后已运行 `bun run typecheck` 做全量类型审查；当前仍失败于无关 `server/agent/tools/control-tools.test.ts` 的 Agent control tools 测试类型漂移，没有出现 World Engine / Workbench 新错误。本轮没有修无关测试。
- 已补真实作者流浏览器验收清单：后续经用户明确允许后，按 `ming-ding-zhi-shi-2` 打开 Workbench、同步主体、连续推演多步 slice、复制 / 打开主体文件建议、回看历史 slice、编辑 / 删除 / 查询等路径逐项验证并记录实际结果。
- Slice card `files N` 徽标 title 已改为 `按当前主体语境，当前切片有主体文件建议`，避免把 `world.events` 回退路径下随 focused subject 变化的 proposal 数量误读成全局归属。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Slice card `files N` 已从只读徽标改成主体文件建议入口：点击后会选中对应 slice，并打开右侧 Inspector；真实 Workbench 和 mock preview 都接入同一链路。该入口仍只展示 / 复制建议，不自动写 `simulation/subjects`。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过。
- Slice card `files N` 入口现在会带目标打开 Inspector：点击后不仅选中 slice 和显示右栏，还会滚到 `Subject file proposals` 区域，减少作者在 Inspector 内寻找建议的步骤。该行为通过 `subjectFileProposalFocusVersion` 版本号驱动，真实 Workbench 和 mock preview 共用同一链路。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过；未自动执行浏览器验收。
- 隐藏 Inspector 状态下的 proposal 入口已补齐：顶栏 Inspector 按钮和右侧恢复 rail 在当前 slice 有主体文件建议时，会用 `subject-file-proposals` 目标打开右栏并滚到建议区；mock preview 也补齐了 proposal count badge 与恢复 rail 徽标。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过；未自动执行浏览器验收。
- 主体文件建议复制动作已补失败反馈：如果浏览器剪贴板写入失败，会提示 `复制失败，请手动选择文本后复制。`；成功路径和“不支持剪贴板”提示保持不变。`bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts` 通过；未自动执行浏览器验收。
- Round 365-368 后已运行 `bun run typecheck` 做全量类型审查；当前仍失败于无关 `server/agent/tools/control-tools.test.ts` 的 Agent control tools 测试类型漂移，没有出现 World Engine / Workbench 新错误。本轮没有修无关测试。
- 真实作者流浏览器验收清单已刷新：后续验收需覆盖 `files N` 直达建议区、隐藏 Inspector 顶栏 / rail 直达建议区、历史 slice 的 proposal 直达，以及复制失败提示。该刷新只更新文档，未自动执行浏览器验收。
- 已完成真实 Project 只读预检：`workspace/ming-ding-zhi-shi-2` 存在，`world-engine/schema.yaml` / 当前 `world-engine/calendar.ts` 与 `simulation/subjects/player` 六文件存在；`character` schema 仍无 `events` attr，`events.jsonl` / `memory.jsonl` 格式与 proposal 候选一致。历史 walkthrough 中的 `calendar.yaml` 预检记录保留为当时事实。
- [walkthroughs/2026-06-23-round-424-main-workbench-empty-project-browser-smoke.md](walkthroughs/2026-06-23-round-424-main-workbench-empty-project-browser-smoke.md)：第四百二十四轮用临时 Project 做主 IDE Workbench 空项目极窄浏览器验收，确认第一步入口可见，`创建 world subject` 能真实创建 `world` subject 和 init slice；临时 Project 已清理，3001 已释放。
- [walkthroughs/2026-06-23-round-425-stage-closeout-audit.md](walkthroughs/2026-06-23-round-425-stage-closeout-audit.md)：第四百二十五轮做阶段收尾审计矩阵，把 Round 380-424 的真实项目、新 Project、默认模板、连续推演、常用操作和 Calendar 证据按用户路径归档；结论是当前“前后端雏形拼接 + 作者视角主路径”可以阶段收尾，后续转入体验打磨 / 新任务决策。
