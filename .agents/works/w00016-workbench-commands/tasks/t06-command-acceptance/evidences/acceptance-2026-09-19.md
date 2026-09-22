# t06 验收证据（2026-09-19）

环境：`refactor/w00003-nb-ui-adoption` worktree，隔离验收根 `%TEMP%/neuro-book/acceptance/w00016/ced45125`（state/cache 独立，`migration:check` 为 ready）。服务：主 Lab `127.0.0.1:3216`、nb-ui playground `127.0.0.1:3217`。浏览器：Playwright Chromium（1440×1000 与 390×844）。

## 命令行证据

| 命令 | 结果 |
|---|---|
| `bun run test -- app/utils/workbench app/composables/useWorkbenchCommands.test.ts app/component-lab app/components/editor-workbench app/components/workbench` | 40 files / 370 tests passed |
| `bun run typecheck` | exit 0，0 条 TS 错误 |
| nb-ui 包门禁（t04 交付内执行） | test 377 passed；typecheck exit 0；build:css 已更新；test:e2e 64 passed；`git diff --check` 干净 |

## 浏览器闭环（主 Lab）

1. **按钮/面板单入口**：Monaco 输入 → 按钮「撤销」与面板「重做」互逆；命令 tab 记录每次执行恰好一条，`id` 为 canonical，`invocation.source=user`；面板聚焦时 undo 仍列出（`editor-focus=false` 不影响 `editor-active/editor-writable`）。
2. **行号跳转**：`:15` 后键入 `M`，DOM 读回 `M第 15 行：命令导航验收`（真实 `setPosition` + `revealLineInCenter`）；`:1`/`:60` 边界同样通过；`:0`/`:61`/`:1.5`/空`:` 均不可提交：文案分别为「输入行号（1–60）」「行号超出范围：61（共 60 行）」「行号无效：1zzz-nonexistent」。
3. **键盘**：`Ctrl+Shift+P` 打开（`>` 预填）、Escape 关闭后焦点归还原元素、`>聚焦编辑器` 后焦点留在 Monaco、`>跳转到行…` 为同层切换（始终 1 个 dialog、输入框变为 `:` 且保持聚焦）；ArrowDown 全序列 `open-line → focus → redo → undo → open-line` 回绕；Tab/Shift+Tab 不离开面板；组合输入 Enter 由单测钉住（未做真实 IME）。
4. **降级**：只读场景撤销/重做禁用且不在候选中，`:1` 仍可用；无编辑器场景候选为空、`:15` 显示「没有活动编辑器」；返回命令导航后 4 条编辑命令重新就绪且无重复注册错误。
5. **agent 确认**：normal 模式「以 agent 执行撤销」弹出确认（标题/`callerId=lab`/参数/「仅操作当前 Lab 内存文档」）；取消不改正文；批准后正文回退且结果为完成；discuss 模式同一按钮不弹确认并返回 `read-only（只读模式（discuss）拒绝写入类 agent 调用：nbook.edit.undo）`，审计 `source=agent, callerId=lab`。
6. **命令 tab 与偏好**：第五个 tab 刷新后保持；`nb-lab:preferences:v1` 置为非法 JSON 后页面正常回落默认（文档 tab）并可恢复；执行「聚焦编辑器」后空查询该命令排首位，Escape 取消与 `:N` 执行不改变 MRU，刷新后 MRU 清空。
7. **主题与窄屏**：`nbook/macos/editorial/aurora × 昼/夜` 八组实测均 `z-index: 9200`、视口顶部居中 `x=400,w=640,y=72`、圆角随主题（20/18/8/12px）、文本/选中底色随配色切换（浅色 `rgb(31,28,23)`、深色 `rgb(239,233,223)`）；390×844 下面板 `x=12,w=366`，页面无横向溢出。
8. **nb-ui 叠层**（playground `/lab?component=quick-input&scene=dialog-stack`）：底层 Dialog + QuickInput 两层时，第一次 Escape 只关 QuickInput，第二次才关 Dialog；外点只关 QuickInput；关闭后 `body` 的 `pointer-events/overflow` 均还原。
9. **主 Lab 叠层**：编辑器「关闭未保存的文件」确认与 S4 并存时第一次 Escape 只关 S4、确认仍在，第二次才取消确认；标签上下文菜单打开时 S4 的方向键/Enter/Escape 不影响下层菜单；命令确认框显示期间 `Ctrl+Shift+P` 不打开面板、不新增审计或错误提示。

## 截图

- `palette-light-nbook.png`／`palette-light-aurora.png`：浅色（nbook/aurora 主题）面板与右键联动。
- `palette-aurora-nbook-dark.png`／`palette-editorial-nbook-dark.png`：暗色主题面板。
- `palette-line-mode.png`：`:15` 行号模式（单一候选「跳转到第 15 行」）。
- `palette-empty.png`：`:1zzz-nonexistent` 无效行号空态。
- `palette-390.png`：390×844 窄屏面板。

## 修复记录（验收发现）

`CodeEditorViewFixture.vue` 模板 `@ready="readyHandlerFor(mountKey)"` 是内联语句：Vue 编译为 `($event) => readyHandlerFor(mountKey)`，返回的处理函数被丢弃，Monaco 的 `ready` 事件永远到不了 `onReady`，四条编辑命令从未注册（界面显示「等待内核」）。改为计算属性方法引用 `@ready="readyHandler"` 并在注释中写明原因；修复后内核就绪、命令注册与全部编辑路径在真实浏览器恢复。

## 未覆盖

- 真实输入法组合输入的 Enter 抑制仅有单测（`QuickInput.test.ts`），本机无 IME 环境未做端到端复现。
- 主页面接入、`Ctrl/Cmd+P` 文件搜索、`@` 符号导航按范围不交付。

## 验收后缺陷（用户复现，已修复）

- **现象**：用户自己的 dev server（3001）打开组件 Lab 选 `WorkbenchCommandPalette` 报「场景加载失败：Failed to fetch dynamically imported module …/WorkbenchCommandPaletteFixture.vue」。
- **根因**：`WorkbenchCommandPaletteFixture.vue` 写的是 `import CodeEditorViewFixture from "../CodeEditorViewFixture.vue"`，指向父目录；全仓该文件只在同目录 `fixtures/` 下。Vite 解析不到 → 模块 404（curl 复核：该模块 URL `404 Not Found`，同目录 `CodeEditorViewFixture.vue` 同时 200），注册表测试只查元数据所以仍全绿。
- **修复**：改为 `"./CodeEditorViewFixture.vue"`；用户 dev server 无需重启，模块 URL 变 200，真实浏览器加载三条场景（命令与行号导航 / 只读文档 / 无活动编辑器），内核就绪、`Ctrl+Shift+P` 面板 z=9200、Escape 关闭。
- **回归守卫**：`app/component-lab/fixtures/index.test.ts` 新增「fixture 模块的相对导入都能在磁盘上解析」（扫描 fixture 目录下 `.vue`/`.ts` 的真实导入语句）。用一次性探针文件 `__import-probe.vue`（`import Missing from "./Missing.vue"`）证明可捕获后删除，验证序列为 红 → 删 → 绿。
- **原验收缺口**：当时只在 `CodeEditorView` 场景内验证面板，从未打开 `WorkbenchCommandPalette` fixture 自身场景，因此漏掉了这条动态导入失败路径。

## 「随窗口」画布下编辑器塌陷（用户要求修复）

- **现象**：画布预设「随窗口」下两个编辑器场景的 Monaco 只有 `1000 × 5`，画布看是一片空白；切「平板」才正常（`766 × 992`）。
- **根因两层**：
  1. 画布按契约给「自然高度」（`ViewportCanvas` 注释与容器语义），夹具根只有 `h-full` 时百分比高度在 auto 高度里解析成 0，编辑器链整体塌陷。
  2. Monaco 会把自己测得的像素高度写成内联高度；从平板切回随窗口时该内联高度顶住 auto 高度链，盒子卡在 1024（`画布尺寸` 标签已是「自动 × 自动」），只有切换场景/组件才回落 420。
- **修复**：`CodeEditorViewFixture.vue` 根元素 `min-h-0` → `min-h-[420px]`（沿用 `EditorBreadcrumbsFixture` 既有写法）；编辑器宿主改 `relative min-h-0 flex-1` + `<CodeEditorView class="absolute inset-0">`，用绝对定位切断 Monaco 内联高度对父级内容高度的贡献。
- **约定登记**：`app/component-lab/fixtures/README.md` 新增 §1.3「需要撑满高度的夹具自己声明下限」。
- **真实浏览器逐档测量**（用户 3001 服务，最终代码）：

| 状态 | 画布盒 | Monaco | 备注 |
|---|---|---|---|
| 随窗口（初始） | 452 | 420 | 内部滚动，正文首行可见 |
| → 平板 | 1024 | 992 | 撑满 |
| → 随窗口 | 452 | 420 | 无残留 |
| → 手机 | 844 | 796 | 撑满 |
| → 随窗口 | 452 | 420 | 无残留 |

  三个场景在随窗口下：命令与行号导航 `452/420`、只读文档 `452/420`、无活动编辑器 `452/无编辑器`；`WorkbenchCommandPalette` 场景同值；无页面级横向溢出。
