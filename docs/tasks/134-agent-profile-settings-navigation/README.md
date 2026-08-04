# Agent Profile 设置面板二级化重构

> Active task directory format: `NN-kebab-case-name/`。归档时移到 `docs/tasks/archived/agent-profile-settings-navigation/`。

## Relative documents refs

- `app/components/novel-ide/NovelIdeSettingsDialog.vue`：配置中心宿主，一级 section 导航与 header 保存/恢复按钮。
- `app/components/novel-ide/settings/NovelIdeModelSettingsPanel.vue`：同一 Dialog 内已有的 master-detail 参照实现（左 Provider 列表 + 右详情）。
- `docs/tasks/58-agent-profile-settings-low-code/README.md`：Profile lowcode 设置表单的来源任务。

## User Request / Topic

- 用户反馈「Agent Profile 模型」设置界面最大的问题是所有 profile 的设置都堆在一页，建议做二级菜单，其余细节由实现方分析决定。
- 用户拍板：二级菜单做成**面板内左右分栏**（不占用全局左侧菜单），范围为**二级菜单 + 详情页重排**。

## Goal

把「Agent Profile 模型」面板从单条长滚动流改成面板内 master-detail 二级导航，每屏只渲染一个 profile；验证面为 `bun run typecheck` 中 `app/`+`shared/` 零错误、`app/components/novel-ide/settings` 全部 vitest 通过、以及浏览器走查清单。约束：不改任何 DTO / server 端、不改保存粒度、不改 scope 继承语义、保持 `defineExpose({dirty, loading, saving, saveSettings, restoreSettings})` 契约（Dialog header 的保存/恢复按钮依赖它）。

## Current State

改动已实施完成，并已完成一轮自审修复（见「自审轮」小节），typecheck 与单测已通过，**浏览器走查尚未进行**（见 TODO）。

### 改动前的问题

面板 1118 行，一屏渲染 250+ 个表单控件：

- 顶部「默认 Agent Profile」+「默认参数」（模型 5 字段 + 运行策略 14 字段，含两个 5 行 textarea）
- `v-for` 平铺 **14 个 builtin profile 卡片**，每卡 = 模型 5 字段 + 运行策略 14 字段 + lowcode 表单

连带缺陷：

1. 无搜索、无锚点，找具体 profile 要长滚动。
2. 没有覆盖标记，看不出哪些 profile 被改过；保存按钮是全局的，用户不知道会写进去哪几个。
3. DTO 里的 `loadStatus`（7 态）、`issue`、`sourcePath`、`buildState` **在模板里完全没渲染** —— profile 编译失败只能靠"设置不生效"倒推。
4. 每个 profile 的 14 个运行策略字段永远展开。
5. `fileChangeDiffMaxChars`（文件变更通知）被夹在 `summarizerMaxTokens` 和 `compactionEnabled` 之间，摘要/压缩/文件通知三类字段混排。

### 改动后

```
┌ 配置中心 ─────────────────────────────────────────────┐
│ [启动][全局][项目][浏览器]              [恢复][保存设定] │   ← 未改
├──────────┬────────────────────────────────────────────┤
│ 配置文件 │ ┌──────────┬─────────────────────────────┐ │
│  模型设置│ │🔍 搜索…  │ writer            [回到默认]│ │
│ ▸Agent   │ │ 默认设置 │ 已加载 · leader.default ⭐  │ │
│   Profile│ ├──────────┤ ▼ 模型参数                  │ │
│  可观测  │ │AGENT PROF│ ▶ 运行策略覆盖（已覆盖 1 项）│ │
│          │ │●writer  3│ ▶ Profile 设置              │ │
│          │ │⚠rp.writer│                             │ │
│          │ └──────────┴─────────────────────────────┘ │
└──────────┴────────────────────────────────────────────┘
```

- 左侧全局菜单 9 项未动；面板内新增 240px 二级列表（搜索框 + 「默认设置」+ `Agent Profiles` 分组）。
- 列表项 = 编译状态点 + `profile.name` + `profileKey` + 覆盖计数徽标 + 未保存圆点 + 当前默认 ⭐。
- 右侧只渲染当前选中项，`<Transition name="fade-slide" mode="out-in">` 切换。

## ADR / Decisions / Discussion

- **D1 二级菜单形态 = 面板内左右分栏**（用户拍板）。备选是把 14 个 profile 提到全局左栏做二级项，被否：全局左栏会变成 23 项且要自己滚动，且「模型设置」是分区、`writer.profile` 是数据项，语义层级不对等。
- **D2 复用 `NovelIdeModelSettingsPanel` 的视觉语言**，不发明新样式：`grid xl:grid-cols-[240px_minmax(0,1fr)]`、aside 的 `rounded-2xl border bg-[var(--bg-panel)] p-2`、列表项左侧 3px 激活指示条、`fade-slide` 过渡。同一个 Dialog 里两个面板的交互结构因此一致。
- **D3 导航 key 用空串表示「默认设置」页**，不引入跨文件常量。`<script setup>` 不允许 export 运行时值，用常量就得额外开一个普通 `<script>` 块或独立模块，收益不抵成本；任何 `profileKey` 都不会是空串。
- **D4 覆盖计数直接基于 patch 计数**（`countProfileRuntimeOverrides` / `countModelOverrides` 复用既有 `build*Patch`）。语义天然等于"实际会写进配置的字段数"：`interval` / `trigger` / `keepRecent` 这类 kind+value 成对字段算 1 项；填了但校验不通过的字段不进 patch，也不计入。
- **D5 折叠初始态由覆盖数决定**：profile 详情的「运行策略覆盖」「Profile 设置」在 N>0 时展开、N=0 时折叠；「模型参数」恒展开。详情组件按 `:key="profileKey"` 重建，所以每次切 profile 都重新判定。
- **D6 「默认设置」页三块平铺不折叠**：这页只有 19 个字段（比原来少一个数量级），它本身就是"设基线"的主场景，再折叠反而增加操作成本。
- **D7 保存粒度不变**（仍是整个面板一次写回）。改为 per-profile 保存会牵动 Dialog header 的 expose 契约与 config 写回形态，超出本次范围；改用「未保存圆点」让用户看清这次会提交哪几个 profile。
- **D8 模型参数布局 5 列 → `md:grid-cols-2`**：二级化后详情区只有约 730px 宽（1280px Dialog 减去两级导航），原来的 5 列压缩网格必然挤爆。
- **D9 二级导航常驻**：aside 用 `sticky top-0` + `self-start`。两者必须成对：grid 默认 `align-items: stretch` 会把 aside 拉满高度，此时 sticky 无处可粘。滚动容器是 `NovelIdeSettingsDialog.vue:839` 的 `overflow-y-auto`，中间没有其它 overflow 祖先，粘定位链路成立。
- **D10 文案归位**：新增 `runtime.globalDefaultsDescription` / `runtime.projectDefaultsDescription` 承载「通用运行默认值」段说明；`nav.profilesHint` 承载二级列表说明；原 `globalProfilesDescription` / `projectProfilesDescription` 两个 key 从两个 locale 删除（旧版专为已消失的「Agent Profiles」平铺 section 而写）。其中「写入 Project Workspace `.nbook/config.json`」这条信息并入面板级 `projectDescription`，不丢失。
- **偏差记录**：计划里叫 `agent-profile-model-draft.ts`，实际落为 `agent-profile-draft.ts` —— 该模块除模型草稿纯函数外还需要承载 `AgentProfileDraft` / `AgentProfileSettingsDraft` / `AgentProfileConfigDraft` 类型（详情组件要整个 draft 类型做 prop），再为几个类型单开一个文件不划算。
- **偏差记录**：计划预估主面板收敛到 ~700 行，第一版实际 858 行（超 AGENTS.md 的 800 行线）。追加两步拆分才达标：抽出 `AgentProfileDefaultsPanel.vue`，以及把 `cloneSettingsDraft` / `buildSettingsPatch` / `buildProfileConfig` / `buildProfileConfigMap` / `buildGlobalProfileConfigMap` 这批**纯数据变换**移入 `agent-profile-draft.ts`（签名改为显式接收 `scope`，不再读组件状态）。最终 703 行。
- **偏差记录**：计划里 `AgentProfileModelFields` 的 `inheritMode` 是两值，实际需要三值 `globalDefaults | projectDefaults | profile` 才能完整覆盖原有文案行为 —— Global 默认参数没有"继承"选项，Project 默认参数说「继承 Global（x）」，Profile 覆盖说「默认（x）」。

## 自审轮

首轮实施完成后做过一次逐行对照 `HEAD` 的复检（走查 Global 保存 / Project 保存 / 重置 Home / 编译失败 / 编译轮询 / 搜索六条链路，并逐字节比对 `buildGlobalSavePayload` 的键顺序与 `snapshotText` 赋值点），发现 5 处遗漏，已全部修掉：

| # | 问题 | 修法 |
|---|---|---|
| 1 | **文案串位**：拆组件时把旧版「Agent Profiles」平铺 section 的说明（Global 版原文「只配置与默认参数不同的 Profile 覆盖。」）挪到了「通用运行默认值」段头上，语义正好反了；同时二级列表失去了说明文字 | 见 D10 |
| 2 | **计划里的 `sticky top-0` 漏做**，只写了 `self-start`。运行策略段含两个 5 行 textarea，往下滚会把 14 项列表整个滚出视野 | 见 D9 |
| 3 | 列表为空（加载失败 / 无 profile）时也显示「没有匹配的 Profile」，但用户并没有搜索 | 按 `items.length === 0` 与过滤为空分开取文案，新增 `nav.empty` |
| 4 | 「重置 Home」禁用条件被弱化：旧版是任意 profile 重置中就全禁用，新版只禁当前项。A 重置中切到 B，B 的按钮看着能点但被 `resetProfileHome` 的 guard 静默拦掉 | `saving` prop 换成 `resetHomeDisabled`，由主面板传 `Boolean(resettingHomeProfileKey) \|\| saving`；`resettingHome` 保留只用于按钮转圈 |
| 5 | `hasSettingsForm` 是死字段：DTO → draft → 无人读取，且与 `settings !== null` 完全等价（服务端 `config-service.ts:891` 就是这么判的）。旧版即已如此 | 从 `AgentProfileDraft` 与两处赋值点删除 |

复检同时确认没有问题的点：保存形态键顺序与 `HEAD` 完全一致；`captureSnapshots()` 的两个调用点精确对应旧版 `snapshotText` 的两个赋值点；`status.*` 七个态与 `config.dto.ts:172` 的 zod 枚举一一对应，两个 locale 无缺失 key。

**已知但未处理（非本次引入）**：`refreshBuildStatus` 检测到编译结束后会调 `loadSettings()`，整份草稿被覆盖。旧版同样如此，但旧版所有 profile 摊在一屏，草稿被冲掉尚可察觉；二级化后只显示一个 profile，后台某个 profile 编译完成会让当前编辑中的草稿连同未保存黄点一起无声消失。要不要加保护是独立议题。

## 空白修复轮（2026-08-04，issue #57）

浏览器验收发现：左侧点任意 Profile，右侧永久空白；切回「默认设置」同样空白；控制台无报错。首屏能正常显示默认设置。

**根因**：`<Transition name="fade-slide" mode="out-in">` 被卡死。`AgentProfileDefaultsPanel.vue` 的模板根注释写在根 `<div>` 外面，dev 编译（保留注释）让它的根变成「注释 + 元素」两个节点，即 Fragment 根（patchFlag `2112` = `STABLE_FRAGMENT | DEV_ROOT_FRAGMENT`）。`out-in` 卸载这种组件时，`setTransitionHooks` 递归到 Fragment `subTree` 就停，不下沉到里面的 `<div>`，那个真正被删的元素身上只有挂载时的 enterHooks、没有 `afterLeave`；`performRemove` 读到 `transition.afterLeave` 为 `undefined`，`state.isLeaving` 永不复位，之后每次渲染都返回 `emptyPlaceholder`——这就是「切回默认设置也空白」的原因。

**为什么静默、为什么只在 dev**：Vue 那条 `Component inside <Transition> renders non-element root node` 警告是在 `getChildRoot()` 把 root 重指到元素**之后**才判断的，根本不触发，所以控制台干净是符合预期的；生产构建剥掉注释，根回到单元素，行为正常。

**修法（两步，缺一不可）**：

1. `AgentProfileDefaultsPanel.vue`：根注释移进根 `<div>` 内部，消掉 Fragment 根。
2. `NovelIdeAgentProfileModelSettingsPanel.vue` 的 Transition 两个分支各包一层带 key 的 `<div>`，让直接子节点恒为元素。只做第 1 步的话，下一个人在根元素上方补一行注释就原地复发（AGENTS.md 自己的 HTML 规范就是「容器附近加注释」），而且照样静默、照样只在 dev 复发；包一层后子组件根是什么形状都无所谓，这才在设计上锁死不变量。`v-if` 从组件移到包装 `<div>` 后 vue-tsc 对 `activeProfile` 的 narrowing 不受影响（typecheck 已验证）。

**自审轮为什么漏了**：首轮自审逐行比对了数据流、保存形态键顺序和文案，但没检查「原来 Transition 的子节点是内联元素，抽成子组件后变成组件」这个从未写下来的结构性前提——D2 抄的参照实现（`NovelIdeSettingsDialog.vue:840` 包装 `<div>`、`NovelIdeModelSettingsPanel.vue` 内联元素）恰好都躲过了这个坑。属于自审维度缺失。

同轮附带把配置中心弹窗调大一档（`NovelIdeSettingsDialog.vue`：宽 `1280px` → `min(1440px, calc(100vw - 48px))`，高 `86vh` → `90vh`；宽度顺带补上此前缺的小屏保护）；连带同步 `AgentProfileNavList.vue` 里照弹窗高度硬算的滚动区魔数 `calc(86vh-330px)` → `calc(90vh-330px)`，并加注释标明跨文件耦合。

## Verification / Test

- `bun run typecheck`：本任务触及的 `app/components/novel-ide/settings/**` 与 `app/i18n/locales/**` **零错误**。仓库其余既有错误与本次无关：`server/agent/session/migrations/session-v2*/migration.ts`、`server/agent/skills/llmlint.test.ts`（本次未改任何 server 代码），以及 `app/components/novel-ide/agent/AgentChatSurface.vue` / `agent-chat-surface-state.*`（他人在途改动，工作区里是 `M` + 未跟踪新文件）。
- 注意 `bun run typecheck` 输出不稳定：自审轮连跑两次，`AgentChatSurface.vue` 相关报错一次 3 条一次 2 条。判断本任务是否干净只看错误路径是否落在本任务文件上，不要看总数。
- 为确认 `nuxt typecheck` 真的覆盖 `.vue`，临时在 `AgentProfileNavList.vue` 插入 `const typecheckProbe: number = "probe"`，typecheck 如期报 `TS2322`，随后移除探针。
- `bunx vitest run app/components/novel-ide/settings`：**8 文件 40 用例通过**（含新增的覆盖计数用例）。自审修复后重跑仍为 8 文件 40 用例通过。
- 2026-08-01 合并收口后，根 `bun run typecheck` 已全绿；前两条保留实施当时用于区分本任务与并行改动的历史证据。
- typecheck 与 vitest 分开跑，未并发（并发会让 nuxt 重写 `.nuxt/tsconfig` 产生假失败——本次确实撞到过一次，同一条命令里连跑两次 typecheck 出现 3 个幽灵错误，单跑即消失）。
- **浏览器走查未做**（AGENTS.md 禁止自动浏览器验证）。走查期间 dev server 出现 `worker entry not found in .nuxt/dev/index.mjs`，且 `/api/projects/open` 长时间 pending，走查前需重启 dev server。
- **结构性回归无自动化能拦**：`vitest.config.ts` 是 `environment: "node"`，settings 目录下 8 个测试文件全是纯逻辑投影，不挂载 `.vue`。issue #57 的空白 bug（Transition 子节点变成 Fragment 根）就是这类结构性问题——typecheck 与现有 vitest 都拦不住，只能靠浏览器走查。修复轮验证：worktree 内 `bun run typecheck` 全绿（`app/` 零错误，`activeProfile` narrowing 未受影响）、`bunx vitest run app/components/novel-ide/settings` 仍 8 文件 40 用例通过（只动模板未越界）。

## Implementation Walkthrough

### 新增文件

| 文件 | 行数 | 职责 |
|---|---|---|
| `app/components/novel-ide/settings/agent-profile-draft.ts` | 311 | 草稿类型（`AgentProfileDraft` / `AgentProfileModelDraft` / `AgentProfileSettingsDraft` / `AgentProfileConfigDraft` / `ConfigSettingsScope`）+ 全部纯数据变换（clone / build / merge / count / settings patch / profile config map） |
| `app/components/novel-ide/settings/AgentProfileNavList.vue` | 125 | 二级导航：搜索框、「默认设置」入口、profile 列表（状态点 / 覆盖计数 / 未保存圆点 / 默认 ⭐）；`sticky top-0` 常驻 |
| `app/components/novel-ide/settings/AgentProfileDetailPanel.vue` | 184 | 单 profile 详情：头部（状态徽章 / sourcePath / 编译中提示 / issue 告警条 / 回到默认 / 重置 Home）+ 三个折叠段 |
| `app/components/novel-ide/settings/AgentProfileDefaultsPanel.vue` | 103 | 默认设置页：默认 Profile 选择 + 当前生效 + 默认模型参数 + 通用运行默认值 |
| `app/components/novel-ide/settings/AgentProfileModelFields.vue` | 187 | 模型 5 字段编辑区，对称于 `ProfileRuntimeSettingsFields.vue`；默认页与详情页共用 |

### 修改文件

- `NovelIdeAgentProfileModelSettingsPanel.vue`：**1118 → 701 行**。保留全部加载 / 保存 / 草稿构造 / 编译状态轮询与 `defineExpose` 契约；新增 `activeNavKey`（空串=默认页）、`navSearch`、`activeProfile`、`navItems`、`defaultsSnapshot` + `profileSnapshots`（未保存标记的真相源）、`captureSnapshots()`（在两个 apply 分支末尾调用，顺带把指向已消失 profile 的 `activeNavKey` 复位）。模板换成二级分栏。
- `ProfileRuntimeSettingsFields.vue`：132 → 152 行。字段按「自动摘要 / 上下文压缩 / 文件变更通知」三组重排并加小标题，修掉 `fileChangeDiffMaxChars` 的错位。**只搬位置，字段语义、校验与 emit 形态未动。**
- `profile-runtime-settings.ts`：新增 `countProfileRuntimeOverrides()`。
- `profile-runtime-settings.test.ts`：新增「覆盖计数只统计真正写进配置的字段」用例（空草稿=0；kind+value 成对算 1 项；越界值不计入）。
- `app/i18n/locales/zh-CN.ts` + `en-US.ts`：`settings.panels.profileModels` 下新增 `nav.*`（6）、`status.*`（7 个编译态）、`runtime.groups.*`（3）、`runtime.globalDefaultsDescription` / `runtime.projectDefaultsDescription`、`overrideCount` / `unsavedChanges` / `currentDefault` / `modelSection` / `sourcePath` / `buildRunning` / `buildQueued`；删除 `globalProfilesDescription` / `projectProfilesDescription`；`projectDescription` 追加写入路径说明。

### 关键实现点

- 切换二级项**不丢草稿**：所有草稿都在主面板的 `profiles` ref 里，切换只影响渲染谁。
- 子组件一律 `modelValue` + `update:*` 整体替换，不 mutate props；主面板用 `updateActiveModel` / `updateActiveRuntime` / `updateActiveSettings` 写回，避免在模板里操作可能为 null 的 computed。
- 模板用 `v-if="activeProfile"` 在前、默认页 `v-else` 在后，让 vue-tsc 的 narrowing 可靠生效。

## TODO / Follow-ups

- [ ] **浏览器走查**（需重启 dev server）：
  - 全局配置 → Agent Profile 模型：左侧出现「默认设置」+ 14 个 profile；搜索 `writer` 能过滤。
  - 改某个 profile 的温度 → 该项出现未保存圆点、覆盖计数 +1；切走再切回，草稿还在。
  - 顶部「保存设定」可用；保存成功后圆点消失。
  - 切到「项目配置」scope：二级导航正常，「重置 Home」按钮出现。
  - 运行策略三组标题顺序正确，`单文件 diff 字符上限` 落在「文件变更通知」组。
  - 有覆盖的 profile 打开时运行策略段自动展开，无覆盖的保持折叠。
  - 制造一个编译失败的 profile，确认列表状态点变红、详情头部出现状态徽章与 issue 告警条。
  - 自审轮新增：详情页往下滚到运行策略段底部，左侧二级列表仍常驻可见（`sticky`）。
  - 自审轮新增：「通用运行默认值」段的说明文字读起来是"给所有 Profile 设基线"，不是"只配置差异覆盖"。
  - 自审轮新增：Project scope 下对某个 profile 点「重置 Home」，重置进行中切到另一个 profile，该 profile 的「重置 Home」按钮应为灰色禁用态。
  - 空白修复轮（issue #57）：点任意 Profile → 右侧出现该 Profile 详情（核心）；再点「默认设置」→ 正常回到默认页；连续切换两个不同 Profile → 都能渲染，有覆盖的 Profile 打开时运行策略段自动展开、无覆盖的保持折叠（确认 A2 包装层没破坏 D5）。
  - 空白修复轮（issue #57）：配置中心弹窗尺寸变大后观感到位；二级列表在新高度下滚动区正常、`sticky` 仍常驻；把浏览器窗口拖窄到 1280px 以下，弹窗不溢出屏幕。
- [ ] 若 profile 数量继续增长，考虑给二级列表加分组（leader / writer / 工具类）。
- [ ] 保存粒度仍是整面板一次写回；如需 per-profile 保存要一并调整 Dialog header 的 expose 契约。
