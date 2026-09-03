---
schema: nbook.walkthrough/v1
taskId: t05-component-lab
sequence: 4
role: tasker
status: completed
createdAt: 2026-09-02T00:00:00Z
---

# t05 收尾：Surface 规范统一与 Component Lab 浏览器 smoke

在 `.worktree/w00003-neurobook-ui-foundation-migration`、分支 `refactor/w00003-nb-ui-adoption` 上执行。

## 本轮决策

开发者审查并明确：

- Surface 的一级结构判据是承载关系：直接压在窗体底纹上的属于材质轴，从材质层往上叠的属于层级轴，不承载内容的区域不给面。
- `chrome` / `paper` 降为主题内容角色，不再作为选择 Surface 轴的结构判据。
- 超过三层时钳制到第 3 层；开发环境警告，生产环境不中断。
- 普通 Vue 嵌套使用 Vue 上下文自动推导层级；Portal 与纯 CSS 使用显式编号边界。
- 暗色材质下限由各主题自行决定，库不提供统一数值或统一可读性保证。
- 本次产品适用范围只验证 Lab，不推断写作页、设置页等产品页面。
- Surface token、公共类和消费方迁移是独立 follow-up，不属于本 Task 完成门禁。

## 已完成

- `packages/nb-ui/docs/design-language.md` 第一节已改为承载关系优先；`chrome` / `paper` 改为内容角色表述，并补充文档/数据侧栏与面板内工具条的边界例子。
- `docs/proposals/nb-ui-surface-model.md` 已记录上述决策；产品适用范围单列，三个工程决策标为已决定但待独立实现 follow-up。
- `packages/neuro-book/app/component-lab/LabShell.vue` 增加窄屏初始化收起两侧栏，并将顶栏、画布工具条和三栏容器的横向溢出收在各自容器内，避免 390px 页面级溢出和控件被面板遮挡。
- 新增 `packages/neuro-book/scripts/smoke/component-lab.ts`，覆盖主应用 Lab 的路由加载、四个右栏 tab、确定性场景切换、数据面板还原、主题切换、离开 Lab 后主题清理、手机 `390×844` 预设和页面级横向溢出。
- `packages/neuro-book/package.json` 新增 `smoke:component-lab` 入口，使用 Node + `playwright-core`，不交给 Windows Bun 启动 Chromium。

## 浏览器证据

3000 端口进程命令行为目标工作树：

`C:\Users\notnotype\Documents\CodeRepository\GithubProjects\neuro-book\.worktree\w00003-neurobook-ui-foundation-migration\node_modules\@nuxt\cli\bin\nuxi.mjs dev --no-fork`

真实页面 `http://localhost:3000/lab` 已观察到：

- 页面标题为“组件 Lab”。
- 索引显示 7 个组件：`JsonViewer`、`CollapsibleSidePanel`、`EventLogPanel`、`HighlightBox`、`MarkdownView`、`SurfaceTierDemo`、`ViewportCanvas`。
- 右栏存在四个 tab：文档、元素、事件、数据。
- 场景选择、手机/平板/随窗口预设、画布底、画布缩放、检查按钮均存在。
- 主题从 NeuroBook 切换到 macOS 后，文档根的 `data-nb-theme` 变为 `macos`；离开 `/lab` 回到 `/` 后主题属性被清理。
- `390×844` 真实视口下文档和 body 的宽度均为 390px，无页面级横向溢出；窄屏重新进入 `/lab` 时两侧栏收起，主页面仍可加载。

## 开发者人工验收

开发者已确认 t05 通过。

- 桌面 Lab 验收通过。
- 以手机视口重新进入/刷新 `/lab` 的窄屏验收通过。
- 本次验收不证明“Lab 已打开后再把浏览器窗口缩窄”时两侧栏会自动收起；当前实现只在 `onMounted` 读取一次 `window.innerWidth`，运行中 resize 监听属于后续改进边界。
- 开发者对当前 Lab UI/UX 评分为 **3/5**：骨架和主要交互可用，但尚未完成动画等 UI/UX 细调，整体界面细节仍不完整。

可重复 smoke：

```text
bun run --cwd packages/neuro-book smoke:component-lab -- --url http://localhost:3000 --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"
```

结果：

```text
Component Lab smoke passed: http://localhost:3000/
```

smoke 监听 console error、console warning 和 pageerror；本次运行未产生失败记录。

## 规范与格式验证

- `bun run docs:check`：`failures: []`，`checkedFiles: 5410`。
- `git diff --check`：通过；仅报告工作树 LF→CRLF warning，无 whitespace error。
- `bun run --cwd packages/neuro-book typecheck`：通过，退出码 0。
- `bunx tsc --noEmit --strict --target ESNext --module ESNext --moduleResolution bundler --skipLibCheck --types node,bun scripts/smoke/component-lab.ts`（在 `packages/neuro-book` 下执行）：通过，退出码 0；该聚焦命令证明新 smoke 脚本自身通过类型检查。
- `bun run --cwd packages/neuro-book scripts:typecheck`：未通过；失败仍来自既有 `server/workspace-files/system-asset-installation.ts` 的类型错误，不在本轮改动路径。错误位置为 594、597、600、603 行，包含 `assets` / `profiles` 在 `object` 上不存在、回调参数隐式 `any`、`object` 不能赋给 `LegacySyncStateDocument`。

本轮曾误触该迁移文件，已恢复为原工作树状态；`git diff -- packages/neuro-book/server/workspace-files/system-asset-installation.ts` 无输出。故不把未授权迁移修复混入 t05，也不把 `scripts:typecheck` 失败归因于新 Component Lab smoke。

## 已知边界与后续缺口

- t05 已由开发者人工验收通过；本 walkthrough 的 t05 范围闭合。
- UI/UX 细调不是本 Task 的阻塞条件，但已记录为后续缺口：当前评分 3/5，动画、转场和整体细节完整度仍不足。
- 运行中 resize 自动收起两侧栏未实现，也未纳入本次 smoke；当前合同证据限定为以目标手机视口重新进入/刷新 `/lab`。
- t05 尚未新增 Lab 零件的组件级 Vitest 测试；本轮以真实页面 smoke 覆盖 Lab ask，未声称已有 happy-dom/组件单测。
- Surface token、公共类和现有消费方迁移未做，按开发者决策作为独立 follow-up，不计入 t05 完成门禁。
- t06 preview 清退仍未开工。

