---
schema: nbook.task/v2
taskId: t05-lab-dev-tools
---

# Lab 截图调试工具与夹具样板精简

## 目标

开发者在 t04 收尾复盘后批准（2026-09-30）：

1. 给 Component Lab 加截图等调试工具，让 Agent 不必每轮手写 Playwright 脚本、也不依赖会被他人改动的界面选择器。
2. 减少新建组件时的 Lab 样板：简单的透传夹具不再需要单独的 `.vue` 文件。

## 合同

[ui.component-lab](../../../../../docs/specs/ui/component-lab.md)（implemented）：新增 URL 参数、调试接口与截图命令的行为、实现合同和验收条目。

## 范围

- Lab 打开时可由 URL 参数 `vp`（尺寸）、`cw`（配色）、`theme`（主题）直接进入指定状态。
- 舞台加稳定标记 `data-lab-stage`；页面暴露只读调试接口 `window.__nbLab`（当前状态、场景列表、舞台测量与越界元素）。
- 新增 `lab:shot` 命令：按组件、场景、尺寸、配色批量截图并输出 JSON 报告（溢出、页面错误与警告）。
- 新增 `defineSubjectFixture`：一处登记组件、场景、记录的事件、事件回写与运行期 props；本 Work 新建的 agent 零件夹具迁过去。其他人的既有夹具不动。

## 非目标

- 在 Lab 界面里做截图按钮（浏览器内截取 DOM 需要额外依赖，命令行已覆盖 Agent 的需要）。
- 迁移本 Work 以外的既有夹具。

## 当前状态（2026-09-30）：已完成，开发者已确认

## 验证

- `lab:shot` 对 10 个迁移后的零件与 `AgentConversationView` 各跑“手机 + 1400x900”全部场景，共 74 张截图：全部退出码 0，没有溢出、越界元素、页面错误或警告。抽查截图确认 `runtimeProps` 注入的注册表生效（`AgentToolDetail` 的 read 适配），1400 宽下对话视图每轮限宽居中。
- 调试中发现并修掉两处：同一标签页连续导航开发服务约第七次会停在空白页（改为每个组合新开标签页；根因未查明）；固定宽高的画布大于窗口可用区时舞台被检视栏盖住（按画布尺寸放大窗口）。
- `app/component-lab` 与 `app/components/agent` 单测 174 个，165 通过；9 个失败都在未改动的 `WorkbenchShellLayoutFixture.test.ts`，与 t04 记录相同。
- `bun run typecheck` 仍为改动前的 32 个既有错误；`scripts:typecheck` 无 `scripts/lab` 错误；`docs:check` failures 为 0。

## 进展记录

已改：
- `app/component-lab/lab-url.ts`（新）：地址栏参数解析与画布预设；`LabShell.vue` 改用它，舞台加 `data-lab-stage`，挂载时安装调试接口。
- `use-lab-preferences.ts`：恢复顺序改为 URL > session > 偏好 > 默认，主题与配色按登记表校验。
- `app/component-lab/lab-debug.ts`（新）：`window.__nbLab` 与 `measureStage`（跳过被横向裁剪或滚动容器挡住的元素）。
- `scripts/lab/shot.ts`（新）与 `lab:shot` 脚本。
- `fixtures/subject-fixture.ts`（新）：`defineSubjectFixture`；10 个 agent 零件夹具迁过去，删除对应的 `Agent*Fixture.vue`。
- 文档：Spec `ui.component-lab` 补行为、实现合同与验收 13～15；`fixtures/README.md` 新增 3.3、3.4 两节。
- 单测：`lab-url.test.ts`、`lab-debug.test.ts`、`fixtures/subject-fixture.test.ts`。

回写（t04 复盘第 1～4 条，开发者已批准）：`AGENTS.md` 的 Conventions 一节加反思触发；新建 `.claude/skills/` 8 个指向 `.agents/skills/` 的软链接；删除 `~/.claude/skills/` 里指向全局副本的 `diagnosing-bugs`、`doc-review`、`writing-for-agents` 三个同名链接；`ui-development` 的“UI 专属检查”一节改写第 1 条、新增第 3 条。写入后 Claude Code 的 skill 目录已列出这 8 个项目 skill。
