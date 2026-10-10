---
schema: nbook.task/v2
taskId: t73-lab-nb-ui-and-storage
---

# 完善新 Lab：nb-ui 进 Lab、偏好改存 Storage

## 目标与范围

开发者 2026-10-10 决定第 6 步之后先做 workbench 与 Lab，Lab 在前：

- nb-ui 的基础组件进入新应用的 Lab 组件索引，每个可挂载组件都有场景；
- Lab 不再用 localStorage 与 sessionStorage：界面偏好改存 `nbook.storage`，标签页内的状态放进地址栏；
- 迁移中可以顺带排错、优化与调整样式。

实施计划：[plan.md](plan.md)。

行为合同：[`ui/component-lab.md`](../../../../../docs/specs/ui/component-lab.md)；Storage 的记录规则见 [`storage/persistence.md`](../../../../../docs/specs/storage/persistence.md)，store 见 [`state/store.md`](../../../../../docs/specs/state/store.md)。

## 前置

第 6 步 Files 竖切 t68–t72 已完成。

## 当前状态

- 2026-10-10 调研完成，计划起草；开发者同意计划与三个待定项的推荐，并要求 omp 审查计划、补充遗漏的细节与更有用的功能，处理后实施 t73–t75。
- 2026-10-10 S1+S2（`5c4a5f19`）：
  - **入口与索引**：nb-ui 公开入口 `@notnotype/nb-ui/lab-sources`；组件索引并入 nb-ui，组件名全局唯一（重名只收路径在前的一个并提示）。
  - **场景**：75 个 nb-ui 组件的场景，按 nb-ui 分类放在 `fixtures/nb-ui/`。
    - 透传登记加了 `slotPresets` 与 `rootless`；
    - Dialog、DialogWindow、ContextMenu 手写夹具；
    - 日期组件当非受控用；`Table` 用实例化表达式按行类型检查；
    - `GridRenderer` 标 `验证入口: WorkbenchShellLayout`。
  - **截图检查**：`lab:shot` 扫了全部组件，组合为手机与 1400×900、深浅配色，共 980 张。
    - 页面问题 36 张，都是根为传送门或片段的组件接不住 `data-lab-subject`，已修；
    - 越界报告多为测量误报（读屏播报区、视觉隐藏的 input），Lab 的测量改为跳过看不见的元素，e2e 补了用例；
    - 真实问题只有 Collapsible：内容区向外扩 6px，在贴边容器里造成 6px 横向溢出。这是保护焦点光环的设计取舍，写进组件文档。
  - **验证**：nb-ui 与 neuro-book 的 typecheck、`build` 与 `check:dist`、Lab 的 Bun 37 例、Vitest 27 例、e2e `lab.e2e.ts` 与 `lab-shot.e2e.ts` 11 例，全部通过。变异 6 个全杀。
- 2026-10-10 S5 第一部分完成（变量页签与结构检查）：
  - **变量页签**：从 playground Lab 迁入。覆盖集的校验与快照（`lab-overrides.ts`，快照格式不变，旧文件可导入）、变量分组从 nb-ui 公开入口取（`lab-tokens.ts`）、覆盖层只在内存（`use-lab-overrides.ts`，不写浏览器存储，刷新后消失）、面板 `LabVariablesPanel.vue`。地址栏的 `tab` 参数多了 `variables`。
  - **结构检查**：迁入元素页签（`inspect-checks.ts`）。旧的“invalid 语义”检查依赖 playground 场景上的标记，新 Lab 没有，不迁；“预览边界”改为“画布边界”，不在画布里的元素不判。读数里的 role 补上原生元素的隐式角色（迁移时发现原生 `<button>` 显示为“—”）。
  - **验证**：typecheck；Lab Bun 43 例、Vitest 34 例；`lab.e2e.ts` 新增场景 23；全部 Lab e2e 31 例通过。变异 4 个全杀；其中“导入时合并而不是替换”第一次活了下来，原因是用例导入前刚清空，补了“导入前另有覆盖”的步骤后杀死。
- 2026-10-10 S4 完成：
  - **拆分**：`LabShell.vue` 从 2045 行降到约 930 行。顶栏 `LabToolbar.vue`、左栏 `LabNavPanel.vue`、右栏 `LabInspectPanel.vue` 只呈现与转发，各带同名 `.md`；侧栏布局在 `use-lab-layout.ts`；样式移到不 scoped 的 `lab-shell.css`，几个外壳零件共用。画布那一条工具条（场景、尺寸、缩放、画布底）与舞台连得紧，留在 LabShell，与计划表里“工具条含场景与画布”不同。
  - **拆分后的样式对照**：在开发服务上把改动的文件临时换回 HEAD，对 Lab 外壳每个元素记录 16 项计算样式与位置，两种窗口宽度各一份。对照抓到一处回归：直接在窄屏打开时，偏好里展开的侧栏盖掉了自动收起（偏好改成异步读取后时序变了）。已修：偏好放进界面之后按窗口宽度再收一次；`lab.e2e.ts` 补了直接窄屏打开的断言，变异检查确认能拦下。另一处是减少动态的规则：原来写在 LabShell 的 scoped 样式里，改成全局后优先级不够、被 `CollapsibleSidePanel` 自己的转场盖掉，挪进了该组件。修完后外壳样式前后一致，只有舞台里第三方 JSON 编辑器的内部高度稳定多出 1px，原因没有查到，不影响外壳。
  - **画布作为浮层定位容器**：nb-ui 加 `provideTeleportTarget` 与 `useTeleportTarget`；Dialog、DialogWindow、AlertDialog、Drawer、QuickInput 的缺省传送目标改为宿主提供的、否则 `body`，尺寸从 `vw`、`vh` 改为容器单位 `cqw`、`cqh`（没有容器时等于视口单位，产品页不变）。`ViewportCanvas` 在画布盒子里放浮层落点（尺寸容器加 `contain: layout`）并提供给场景。
    - 顺带修了 nb-ui 的一个真实问题：Dialog 的 `sm`、`default` 两档宽度写死 360px、420px，在 390px 窄屏溢出，现在按可用宽度收窄。
    - 实施中踩到：`container-type: size` 不会让 `fixed` 后代以它为包含块（它不带 layout containment）。玻璃主题碰巧靠画布盒子的 `backdrop-filter` 成了包含块，editorial、aurora 主题下命令面板仍按窗口定位。加上 `contain: layout` 后修好；验收 24 的用例改用不开模糊的 editorial 主题，变异检查确认能拦下。
    - `lab-commands.e2e.ts` 的 390px 用例改为看手机画布：面板按画布宽度收窄，窗口宽度不再决定它的尺寸。
    - `dist/nb-ui.css` 重新生成：除了 Drawer 换成容器单位的两条，还去掉了 `mx-1`、`ml-2`、`ml-4`、`shrink`、`opacity-80`、`bg-[var(--border-color)]` 六条。这六个类在 nb-ui 组件源码里已经没人用，是之前的提交改了组件却没有重新生成产物。
  - **验证**：neuro-book 与 nb-ui typecheck；Lab Bun 41 例（含架构测试）；nb-ui Vitest 529 例通过，另有 `colorway.test.ts` 5 例失败。这 5 例与本次改动无关：本机 Node 26 自带的实验性全局 `localStorage` 没有 `--localstorage-file` 时为 undefined，盖住了 happy-dom 的实现，该文件本次没有改动。`build` 与 `check:dist`；e2e：Lab、命令、工作台共 81 例全过。变异 6 个全杀（传送目标 3 个、浮层落点 2 个、窄屏收起 1 个）。
- 2026-10-10 S3 完成：
  - **偏好**：改存 `nbook.storage` 的 `lab.preferences`（user、shared），`defineStore("lab")` 按字段合并保存、恢复默认写空对象、暂停期间合并成一份、重试与放弃；读到之前只显示占位；问题提示按界面状态表给出操作。“字段问题”分类从资源管理器挪到 `src/shared/store/problem.ts` 共用。localStorage、sessionStorage 的全部路径删去。
  - **地址栏**：`use-lab-session.ts` 经宿主 router 同步，切组件 `push`、其余 `replace`，后退前进由当前路由驱动；参数补 `zoom`、`tab`，不认识的参数保留，旧参数名改写；复制场景链接；地址里的场景不存在时回落并提示。
  - **偏离计划一处**：计划写“`cw` 与 `theme` 地址栏指定、随之写入偏好”。偏好搬到服务端后所有窗口共用一份，照此实现 `lab:shot` 每拍一张都会改掉开发者自己的 Lab 主题（以前它用独立的浏览器上下文，碰不到）。改为地址里的主题与配色只作用于这个标签页，在界面上换主题或配色时才写进偏好并从地址栏去掉。Spec 已同步。
  - **全场景 e2e**：改为每个标签页整页加载一次、之后经 router 在 Lab 里切场景（`pushState` 加 `popstate`，与浏览器前进后退同一条路），用时从 11 分钟降到 34 秒。变异检查：fixture 加载失败、传送门根挂 `data-lab-subject` 的 Vue 警告，都被拦下。
  - **验证**：typecheck；Bun 162 例（Lab、资源管理器、store、架构）；Vitest 49 例；`build` 与 `check:dist`；`lab.e2e.ts` 13 例（新增场景 9 坏记录、20 双窗口、21 历史与 router、22 换端口、复制链接）；其余 Lab 与资源管理器 e2e 27 例。变异 9 个全杀（按字段合并、恢复默认用 reset、暂停期间合并、拖动不写、地址主题被取代时写两项、宽度核对、读取失败重试后放进界面、保留未知参数、切组件 push）。
- 2026-10-10 S0 完成：`docs/specs/ui/component-lab.md` 写入 nb-ui 来源与组件名唯一、偏好改存 `lab.preferences`（user、shared）与界面状态表、地址栏作会话状态（`zoom`、`tab`、Router 的 push 与 replace、复制场景链接）、变量页签与结构检查、画布作浮层定位容器；验收 1、8、9、13 改写，新增 18 到 24；删去 localStorage、sessionStorage 的字段表与“拆分已延期”。尚未实现的条目标“（planned）”。nb-ui 的 `AGENTS.md`、`README.md` 与 `docs/ui-development-spec.md` 第 7 节改为在新 Lab 登记，删去与“一个场景一个组件”冲突的多方案矩阵条目。
- 2026-10-10 S2b 完成：
  - **迁移矩阵**：[evidences/s2-migration.md](evidences/s2-migration.md) 逐个对照旧 playground 的 52 个组件。对照中发现漏迁的场景与事件已补回：FormInput 的前缀插槽、FormCheckbox 无标签、TimePicker 与 Listbox 的禁用、QuickInput 的长列表与“在对话框上打开”、表单控件的 `focus`、Splitter 的 `gesture-start`、DialogWindow 的 `update:height`。其余差异写明了原因。
  - **全场景 e2e**：`e2e/lab-scenes.e2e.ts` 在开发会话里逐个打开 360 个场景，要求就绪、没有加载失败、页面错误与控制台警告，4 个标签页并行，用时约 11 分钟。
    - 每个场景开新标签页：开发服务一次整页加载请求约 1155 个模块，同一标签页连续加载四到七次就报 `ERR_INSUFFICIENT_RESOURCES` 或渲染进程崩溃，首页也一样；生产构建连续 20 次正常。
    - 关标签页时插件按 `runtime/plugins` 以 `receiver-closed` 撤回交付并记警告，属于正常诊断，用例只统计打开到就绪之间的问题。
    - S3 改由 Router 维护地址后，改为在 Lab 内切换场景，减少整页加载。
  - **生产排除**：`check:dist` 加了 `标签: [` 标记。变异检查：产品入口误引 `lab-sources` 时构建成功、`check:dist` 报出该标记并失败。截图检查的结论见 [evidences/lab-shot.md](evidences/lab-shot.md)。
  - **顺手修**：S2 提交的 `subject-fixture.dom.test.ts` 在 `tsconfig.browser-test.json` 下有类型错误（测试组件没声明插槽），已补；那次只跑了前两个配置。治理检查的固定等待规则把 Playwright 的 `test.setTimeout`（用例时间上限）误判为等待，已豁免，并补了 `window.setTimeout` 仍算违反的反例（变异 2 个全杀）。
  - **发现，留给后续**：
    - Dialog、QuickInput 这类传送到 `body` 的浮层按整个窗口居中，手机画布只截到一半。Lab 画布不是真实视口，需要给画布一个传送目标并让它成为 `fixed` 的包含块；S4 拆分时一并处理。
    - `lab.e2e.ts` 的“主题、窄屏与偏好”在连跑时 4 次失败 1 次，单跑与另两轮都通过，失败细节没有留下。这条用例测的是 localStorage 偏好，S3 会重写，届时重点观察。
  - **验证**：neuro-book 与 nb-ui typecheck、`build` 与 `check:dist`、`check-dist.test.ts` 4 例、Lab Vitest 28 例、全场景 e2e、其余 Lab e2e 24 例（两轮全过）。
- 2026-10-10 计划审查（omp 一个会话，报告 [evidences/design-review.txt](evidences/design-review.txt)）：14 条问题、7 条补充，全部核实成立。
  - **并入 t73 计划**：P01–P06、F01–F03，包括：
    - 恢复默认改为写空对象；
    - 偏好的界面状态表；
    - 地址栏由 Router 维护；
    - 迁移对照表与遍历全部场景的 e2e；
    - 双窗口并发写的验收；
    - `check:dist` 识别 `lab-sources`。
  - **写进后续 Task**：P07–P09、F04–F05 写进 t74 README；P10–P14、F06–F07 写进书架页提案。

