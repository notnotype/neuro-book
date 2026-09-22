---
schema: nbook.task/v2
taskId: t52-fix-picker-lab-smoke
---

# 修复 Component Lab 项目书架 smoke 的既有漂移

**状态：待修复。** 红分支边界要求 Component Lab 的 Lab smoke 保持绿色；`--suite project-picker` 当前红，且**不是**本批改动引入。

## 证据（Leader 已定位）

- 命令与结果：`node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3521 --browser-executable "C:/Program Files/Google/Chrome/Application/chrome.exe"`（cwd `packages/neuro-book`）→ 退出码 1；
  失败阶段 `[选择组件与默认场景]`：`locator('[role="group"][aria-label="场景"] [role="radio"]').filter({hasText: '标准书架'})` 等待 30s 超时；同刻另有 5 条 `400 (Server Error)` 控制台错误（未定位，需你确认是否与本条相关）。
- 断言方：`scripts/smoke/project-picker-view.ts:18`（另见 `:39/:45` 等使用「标准书架」语义的断言与后续 `零项目空态/新建表单/加载态/错误态/会话恢复/手机 390×844` 阶段）。
- 现状方：`app/component-lab/fixtures/index.ts` 的 `component: "ProjectPickerView"` 场景已改为 `经典网格 / 密集列表 / 宽幅图文 / 零项目空态 / 新建对话框 / 创建中 / 加载中 / 加载失败 / 手机 390×844`。
- 引入批次：场景改名来自 picker 的既有提交（`139cf49a`、`0f038c32`、`655c3d06`）；基线 `da4c5aca` 上已无「标准书架」，故为**既有漂移**，与切片 4/5 无关。
- 已确认未受影响：`--suite core` 与 `--suite agent-profile` 均 exit 0（同一 revision `a74c7fb8`）。

## 要求

1. 把 smoke 脚本的场景选择与阶段断言对齐到**当前** fixture 场景（用稳定 id 或当前 label，优先 id）；语义等价映射要逐条说明（如「标准书架」→ `default / 经典网格`）。
2. 若某阶段在当前 fixture 已无对应场景（例如「会话恢复」之类），不要伪造：改写为当前等价的可用阶段，或在脚本中移除该阶段并在报告中写明原因与失去的覆盖。
3. 结构性更正：脚本此前**从未**随 picker 改版更新；请检查是否还有其它同类陈旧断言（组件名、`aria-label`、`data-*` 选择器），一并核对。
4. 不要为了过测放宽断言：卡片数、封面比例、零横向溢出等约束按当前 fixture 的真实语义重新标定，并说明依据。
5. 查清那 5 条 `400 (Server Error)`：是 smoke 自身的请求、Lab 的安全注入、还是应用真实报错；给出结论与证据（服务端日志或响应体）。

## 验证与交付

- 真实运行：隔离系统 Temp State/Cache 根 + 显式空闲端口（`NUXT_PORT` 与 `PORT` 都设；**不要用 3001**，它属于开发者）。
- 目标：`--suite project-picker` exit 0，并复跑 `--suite all` 记录 `core`/`agent-profile`/`project-picker` 三者结果。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、逐阶段结果、映射表、5 条 400 的结论、未验证项。
- 不提交、不 push；不改 `app/component-lab/fixtures/**` 的产品语义（除非发现 fixture 本身有缺陷——那要先报告）。
- 最终回复具体结果，不返回空文本或句点。
