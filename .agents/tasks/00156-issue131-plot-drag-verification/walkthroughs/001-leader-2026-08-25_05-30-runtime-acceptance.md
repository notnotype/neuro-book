---
schema: nbook.walkthrough/v1
taskId: 00156-issue131-plot-drag-verification
sequence: 001
role: leader
status: completed
createdAt: 2026-08-25T05:30:00Z
---

# 001-leader-2026-08-25_05-30-runtime-acceptance

## 背景与授权

Issue #131 的修复 `8cd7d7fa`（PR #164）已在 `master`，但缺陷验收条件中的运行时验证一直缺失。开发者批准本 Task 计划：在隔离环境补齐三条产品拖拽路径的运行时证据；`app/pages/dnd.preview.vue` 经产品决定不纳入。验证 revision `557d721e49aaa494b16df5110fd872145ea7582b`。

## 执行环境

- `bun run --cwd packages/neuro-book migrate:application-state -- --apply` 初始化全新临时 State Root（app-sqlite applied changedItems=4，其余 skipped/0）。
- `hub start nbook-i131`: `PORT/NUXT_PORT/NITRO_PORT=3157` + `NEURO_BOOK_STATE_ROOT/CACHE_ROOT=<系统临时根>/nbook-i131-OathtPSy/{state,cache}`，port ready 通过。
- `/api/hello`、`/api/app/version` 均 HTTP 200；dev 模式鉴权默认关闭（boot-config.ts:31），全程未登录。
- 注记：首次以 `bun --cwd packages/neuro-book run dev` 形式启动失败（argv 解析打印脚本列表后 exit 0），改用 walkthrough 011 验证过的 `bun run --cwd <dir> dev` 形式成功。

## Fixture

1. `POST /api/projects {title:"I131 拖拽验证"}` → projectRoot `i131-tuo-zhuai-yan-zheng`。
2. `POST /api/projects/open {projectRoot}` 打开项目。
3. `POST /api/projects/plot/threads?projectRoot=…` `{name:"i131-drag-line",title:"I131 拖拽验证线",isMainThread:true}` → thread id 1。
4. `POST /api/projects/plot/scenes` ×3（场景1/2/3，threadSortOrder 0/1/2）。
5. `GET /api/projects/plot/tree` 自检：1 线 3 场通过。

## 三路径运行时结果

| 路径 | 挂载错误 | 指针拖拽 | 结果 | 服务端持久化 |
| --- | --- | --- | --- | --- |
| 剧情线面板 `PlotThreadScenePanel` | 无 | `[1,2,3]→[2,1,3]` | 通过 | tree API 确认 `[2,1,3]` |
| 剧情工作台 `PlotWorkbenchSceneList` | 无 | `[2,1,3]→[1,3,2]`（sensor 激活探针 true） | 通过 | tree API 确认 `[1,3,2]` |
| TSX Profile 工作台 `ProfileTemplateVisualEditor` | 无 | Message 库项拖入画布，节点 17→19、Message 卡片 5→6 | 通过 | user-profile 模式无自动保存，画布态即合同 |

三条路径 console error/warning 全程为 0；目标错误 `AutoScroller plugin depends on Scroller plugin` 0 命中。逐项 JSON 见 [browser-drag-acceptance.json](../evidences/browser-drag-acceptance.json)，截图三份同目录。

## 合成拖拽排障记录（不影响产品结论）

headless 合成指针与 dnd-kit 的三个交互细节，记录给后续自动化复用：

1. **工作台 Dialog 遮罩**：把手 boundingBox 越出 Dialog 内容面板时落在 `fixed inset-0 z-[9000]` 包装层上，事件不到卡片；需滚动或选可视区内卡片。
2. **dnd-kit preventActivation**：库项按钮内层 `<span>` 命中会被 `isInteractiveElement` 拦截激活；必须在 button 自身裸露点位按下（对照：sortable 把手因 `source.handle.contains(target)` 直接放行）。依据 `@dnd-kit/dom` PointerSensor `defaults.preventActivation` 实现。
3. **落点条极小**：`.node-edge-drop-*` 高约 10px，快速扫过会错过碰撞帧；直接压点长驻 ≥900ms 可稳定提交。

以上均为测试手法问题；期间所有失败尝试 console 同样零错误，不构成缺陷证据。

## notRun 与边界

- `focused-test` / `regression-test`：无源码改动，按 README frontmatter notRun 理由执行。
- `typecheck` / `build`：主线基线由 Issue #163 独立跟踪（PR #164 CI 失败归属同源），非本缺陷门禁。
- 真实浏览器人工验收：本轮为 headless 自动化证据；如需人工复核可在同一 fixture 步骤上重放。
- `dnd.preview.vue` 未触碰未验收（范围决定）；其 preset 残留属后续独立清理事项。

## 终态

三路径全绿 → README `status: completed`。Task 文档（README/context/walkthrough/evidences）尚未 commit；push/PR/Issue 更新未获授权，留给 PM 与开发者决策。
