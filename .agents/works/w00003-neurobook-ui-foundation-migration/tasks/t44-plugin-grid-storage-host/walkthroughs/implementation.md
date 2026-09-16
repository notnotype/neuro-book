# 插件 grid 持久化宿主实现

状态：实现与聚焦验证完成，待 Leader 统一全包 typecheck 与独立复核（检查点 A）。
分支/工作区：`.worktree/w00003-neurobook-ui-foundation-migration`（`refactor/w00003-nb-ui-adoption`），未提交。

## 结果

`packages/neuro-book/app/utils/workbench/storage-grid-host.ts` 把 nb-ui grid 原语接到工作台 Storage
消费上下文上，是纯模块（无 Vue/Pinia、不读文件、不自己开 session、不释放工作台句柄）。
逐条对应 Task「实现要求」：

1. **持久化边界**：`defineGridLayoutState({owner, key, scope, locality?, records, defaultLayout, limits?})`
   → `DefinedStorageState<GridLayoutRecord>`，`schemaVersion` 固定为快照版本 2，`records: "single" | "identified"`
   与 locality/scope 直通 `defineStorageState`；记录值类型是 `{version, root}` 加任意未知字段。
   宿主只消费 `WorkbenchStorageOwnerHandle` 的 `read`/`save`/`subscribe`，`resource` 只作稳定恢复地址
   （`single` 拒绝资源标识、`identified` 强制要求，且用与服务端同一套 `isSafeStorageIdentifier` 预检）。
2. **恢复与原件保留**：读取分类经共享投影 `projectStorageState` 映射；`missing`/`deleted` 保持调用方
   产品默认树且不落盘；`value` 经原语整体校验后一次发布（`grid.restore` 失败不半更新）；记录载荷版本
   为 1/高于 2、结构非法（重复 id 等）、`legacy-value`/`unsupported-version`/`corrupt` 一律回落默认布局、
   `writable=false`、按 `blocked` 与 issue 分类报告。未知引用只过滤呈现，原件保留为合成底本，重新出现
   后 `restoreFromBaseline()` 可恢复。读取失败（I/O）不当作缺失：保持默认呈现、禁止普通保存，
   `open()` 可重试（一次调用保证"已读取并已订阅"），订阅初始快照只补基线、`restoreFromBaseline()` 才应用。
3. **原件合成**：`composeGridLayoutRecord(base, fields)` 从原件出发，只改写 `fields` 指到的节点 `size`，
   结构与未知字段/未知引用节点（含其在分支中的原始位置）全部原样保留；过滤后的呈现树
   （`grid.serialize()`）永远不是保存内容。没有落点的字段不静默丢失，记入 `skipped`
   （`unknown-node` / `invalid-value`），值未变化的字段既不算 `applied` 也不算 `skipped`。
4. **手势提交**：`gestureStart` 捕获基线（分支直接子节点 + 当时 layout + 容器 + 树代数），
   `gestureEnd` 一次提交；只把 `active` 字段写进原件。百分比→px 与 100% 校验复用产品唯一口径
   `workbenchBranchGesture`（`WorkbenchBranch` 消费的同一 helper），不新增第二套换算。
   `setContainer`（测量/程序布局）、取消、no-op 手势、字段与原件相同都不写盘。
5. **外来确认隔离**：`subscribe` 的 `onUpdate` 只更新已确认基线（record + credential），不重挂当前呈现，
   也不清除未确认意图；拖动期间外来确认只刷新基线，手势照常用开始时的基线提交。
6. **CAS 冲突与失败收口**：`STORAGE_REVISION_CONFLICT` → 重读 → 只重放本次主动字段 → 再条件提交一次；
   二次冲突或明确拒绝保留当前显示与未确认意图（`pending.autoReplayed=true`，停止自动重试），
   `retry()` / `abandon()` 为出口（放弃采用已确认值，不删除其它记录）。`committed === null` 的
   超时/断线既不报"已保存"也不报"未写入"：重读核对后按结果收口。
7. **实例与生命周期**：记录由 `resource` 与句柄分区寻址，两个 resource 互不影响；同 resource 的两宿主
   各自持有呈现与释放权，一方提交后另一方仅按订阅更新基线。`release()` 先停止接纳新提交再等在途请求
   收口（不释放工作台句柄）；上下文失效/换代后 `phase="invalidated"`，`retry()` 拒绝且不向失效句柄补写。

## 公开 API 用法

```ts
// 1) owner 登记布局格式（插件/主工作台共用）
const definition = defineGridLayoutState({
    owner: "nbook.shell", key: "layout", scope: "project", records: "single",
    defaultLayout: createShellGrid(viewportWidth, defaultSizes).serialize(),
});

// 2) 每个 grid 一个宿主：网格实例是调用方的产品默认树（运行约束在树里），句柄由工作面决定
const handle = await project.owner("nbook.shell");            // t40 借用句柄，宿主不释放
const host = createGridLayoutHost({
    grid: shellGrid, handle: handle.handle, definition,
    resource: "main",                                          // identified 记录的稳定恢复地址
    resolveRef: (ref) => ({ref, ...currentConstraints[ref]}),
});
await host.open();                                             // 一次发布 + 建立订阅

// 3) 渲染器：测量 → 呈现；Splitter 手势 → 提交
host.setContainer({width: shellWidth, height: shellHeight});     // 只重算呈现，不保存
const layout = host.layout();                                    // 传给 WorkbenchBranch
host.gestureStart({branchId: node.id, sizes: state.sizes});      // Splitter gesture-start
const outcome = await host.gestureEnd({branchId: node.id, active: state.active, sizes: state.sizes});
// outcome: saved | unchanged | unsaved（pending 可 retry/abandon）| rejected
```

消费者约定：宿主只改自己的树，不额外发事件——所有发布路径（`open`/`restoreFromBaseline`/`abandon`/
`gestureEnd`）都由调用方 await，调用方在这些返回后自行刷新渲染 epoch；订阅更新不重挂呈现，因此
不需要事件通道。`state.projection` 用共享投影词汇（confirmed/legacy/default/unavailable），
`state.blocked` 是写入侧的阻断原因（结构非法的当前值在投影里仍是 confirmed）。

## 快照合成约定

- 记录形状：`{version: 2, root: <快照节点树>}`，未知顶层字段与未知节点字段原样保留。
- 合成：以**读取时保留的原件**为骨架，逐节点只为 `fields` 命中的 id 改写 `size[axis]`；`ref`、未知字段、
  未知引用节点及其兄弟顺序都不动。`applied` 只含真正变化的字段；值相同或没有落点的字段不写。
- 未知引用被恢复过滤（`dropped`）时仍留在记录里；`restoreFromBaseline()` 在插件回归后可按当前
  resolver 重新解析并一次发布。
- 记录载荷版本不是 2（v1 / 更高）不进入原语：v1 缺两轴信息、更高版本未知，都只保留原件并给出诊断。

## 验证

命令与退出码（cwd 均为本 worktree 的 `packages/neuro-book` 绝对路径）：

1. `bun run test app/utils/workbench/storage-grid-host.test.ts`
   - 首次运行 **exit 1**：3 个失败——① 合成纯函数把"已知节点但值未变化"的字段误报成 `unknown-node`
     （宿主缺陷，已改为 `placed`/`invalid` 两个集合分别判定）；② 结果未确认用例的记录构造不严谨
     （改为用传输捕获的真实提交值做重读结果）；③ 未知引用恢复用例的手势百分比个数没跟随四叶拓扑。
   - 复核读取路径时再发现并修复一处真实缺陷：`open()` 重试被 `phase !== "loading"` 提前返回打断，
     导致读取失败重开后订阅没有补建（旧代码会一直无订阅）；用例现在用"重开成功后再次 `open()`
     不产生新读取"断言订阅已建立（修复前该断言会失败）。
   - 最终 **exit 0**（末次运行）：1 file passed / **17 tests passed**（`Duration 4.55s`）。
   - 覆盖：value 一次发布与不写盘、missing 不落盘且首存可用、legacy/高版本/损坏/结构非法分别诊断、
     合成纯函数（未知字段/未知引用/原位保留/未变化不算 applied）、一次手势只写 active 字段、
     程序布局与取消与 no-op 不保存、订阅只更新基线且不打断手势、同地址共享时一方释放后另一方继续提交、
     冲突重放不丢另一窗口字段、二次冲突停自动重试并可显式重试、放弃不清其它记录、
     读取失败不当缺失且重开补齐订阅、订阅补齐基线但不重挂呈现、两 resource 隔离、
     真实 adapter 往返（read → 手势保存 → 重新打开 → 原件合成 + 未知引用恢复）、
     未确认结果两种收口、release 排空在途、上下文失效不补写。
2. 计划外但本 Task 自用的 scoped 类型检查（临时配置，已删除）：`node ../../node_modules/vue-tsc/bin/vue-tsc.js
   --noEmit -p .t44-scoped.json`（extends 包内 `tsconfig.json`，include 只列本 Task 两个文件 + `.nuxt/**/*.d.ts`）
   - 首次 **exit 2**：本 Task 文件 2 条 —— `gestureStart` 里 `container` 未收窄、测试内脚本化句柄的
     泛型方法赋值不兼容（已改为"真实 adapter + 注入传输"的脚本化传输）。
   - 最终仍 **exit 2**：5 条错误全部位于被 `.nuxt` 声明间接引入的无关文件（`DesktopTitleBar.vue`、
     `NovelIdeSettingsDialog.vue`、`server/agent/tools/web-tools.ts` 缺 `@types/jsdom`/`@types/turndown`），
     **本 Task 两个文件 0 条**。这些是否属于真实门禁问题以 Leader 的全包 typecheck 为准。
3. 真实 owner adapter 贯穿：用例「真实 adapter 往返」用 `createWorkbenchStorageContext` +
   `openStorageOwnerHandle` + 注入 `StorageValueTransport`，read → 手势保存 → 新工作台重新打开 →
   未知引用回归后恢复，断言记录里 outline 360 / plugin 180 / editor 540 / 未知字段保留。

## 文件

- `packages/neuro-book/app/utils/workbench/storage-grid-host.ts`（新增，974 行，含公开类型与纯 helper）
- `packages/neuro-book/app/utils/workbench/storage-grid-host.test.ts`（新增，891 行，17 用例）
- `packages/neuro-book/app/utils/storage/README.md`（新增一段 grid 宿主消费说明，不改既有语义）
- 本记录

## 未运行与偏差

- 未运行全包 typecheck/build/测试：按 Task 约定由 Leader 统一执行；未运行 `git diff --check`。
- 未启动产品宿主、未访问/重启 `3001`、未做浏览器人工验收：本 Task 无 UI；Lab fixture 与四主题/390×844
  浏览器验收由后续 Task 承接（`ui.nested-grid` 仍为 planned）。
- 未在 `storage-plugin-sample.ts` 增加 grid 样例：Task 中该项为可选；消费路径已由测试内的真实工作台
  上下文 + 真实句柄 + 两 resource/同地址场景覆盖，避免再加一份与测试同形的接线样例。需要时可按同一
  `defineGridLayoutState` + `createGridLayoutHost` 两条调用补齐。
- 未覆盖项：`deleted` 记录与 `missing` 共用同一条 accept 分支（同一段代码，未单列用例）；`release()`
  关闭自身订阅由实现保证（`subscription.close()` 后在稳定点收口），用例只断言了"停止接纳 + 在途排空"。
- 结构编辑（增删/移动叶）不在本切片：`fields` 指到原件树里不存在的节点时记 `skipped(unknown-node)`
  并报告，不用过滤树覆盖原件；结构持久化留给后续切片。
- 未提交、未 push、未创建 PR；未触碰用户 dirty 的 `app/utils/workbench/descriptors{,.test}.ts`。
