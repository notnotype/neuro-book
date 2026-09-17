---
schema: nbook.task/v2
taskId: t62-lab-scene-coverage
role: tasker
---

# 可挂载组件的 Lab 场景覆盖

**状态：已实现并验证**——交付物与证据见 [walkthroughs/implementation.md](walkthroughs/implementation.md)。

## 结果

组件索引里**可挂载但没有任何场景**的组件从 9 个降到 0 个：7 个编辑器工作区组件（`EditorTabBar` / `EditorToolbar` / `EditorWelcome` / `EditorViewHost` / `CodeEditorView` / `MonacoCodeEditor` / `MarkdownEditorView`）与 `SettingsLoadState` / `WorkbenchContainerSection` 各有一份独立 fixture，覆盖 41 个场景。它们此前在 Lab 里只显示「它可以挂载，但还没有人为它写 fixture」——组件规范把纯零件与受控零件的状态说明交给 fixture 承载，没有场景等于既没有文档也没有演示。

## 范围

- `packages/neuro-book/app/component-lab/fixtures/` 下新增 9 个夹具与 `fixtures/index.ts` 登记；**只补场景，不改组件实现**。
- `fixtures/index.test.ts` 增加两条覆盖断言：可挂载组件必须有场景登记（含非空场景与 loader）；登记不得指向不存在或不可挂载的组件。
- 顺带修两处被新场景照出来的既有缺陷（见下）。

## 排除

- 不动 `app/utils/workbench/descriptors{,.test}.ts`（用户 dirty 文件）。
- 不引入真实网络、真实 Project/Session、Provider/Model、浏览器持久化；夹具只用版本控制内的内存假数据。
- 不迁 t61 的暂存原件，不改 Storage 定义，不碰 3001。

## 实现要求与判定

1. **夹具扮演宿主**：正文、tab 清单、菜单结构、节点快照等输入由夹具提供；`data-lab-subject` 标在被检视组件上，不标在夹具自己的台子上。
2. **内核与替身分开**：`CodeEditorView` / `MonacoCodeEditor` / `MarkdownEditorView` 挂真实 Monaco 与 TipTap；`EditorViewHost` 用**明确标注的替身视图**（textarea），因为那里检视的是宿主的可见性、结算与错误收敛合同，不是内核本身。
3. **宿主合同要能看出来**：替身把输入结算延迟 1.5 秒、其中一档把句柄延迟 1.2 秒、一档渲染即抛错，用来观察「换视图先结算旧视图」与「目标就绪前旧视图仍可见」。
4. **两处顺带修复**：
   - `settings.state.reload` 在 zh-CN / en-US 都不存在，`SettingsLoadState` 错误态的默认重试按钮会渲染成原始键——补上文案；夹具里自定义文案特意避开默认值，否则两档看起来一样。
   - `EditorToolbar.md` 声称组件「补充 `aria-label` 与 `aria-checked`」，但 nb-ui `Menubar` 模板不消费 `checked`，组件也只做文案后缀与图标——按实际行为改正文档，并补上零件夹具入口。

## 约束

- 主代理拥有公共文件（`fixtures/index.ts`、`index.test.ts`、文档、i18n）；子代理只写各自一个夹具文件且不运行任何命令。

## 验证

- 真实浏览器（隔离验收副本 44322）：9 个组件共 40 个场景逐个选中并切换，全部挂载出内容、`data-lab-subject` 有正尺寸、页面横向溢出 0、控制台无错误。
- 宿主交互路径实测：点「慢就绪替身」后 350ms 内可见的仍是旧视图，2 秒后才切换；点「失败替身」后出现「宿主收敛到的失败：…」诊断且旧视图仍在。
- `bun run test app/component-lab app/components/editor-workbench app/components/workbench` → 15 文件 72 例通过；`bun run typecheck` exit 0；`bun run docs:check` 无失败；Lab smoke `--suite all` exit 0。
