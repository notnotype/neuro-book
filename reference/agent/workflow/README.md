# Agent Workflow

Agent Workflow 用一段可重放的 TypeScript 编排多个 agent session。它适合步骤固定、需要并发或循环、运行过程要给用户看、结果还要带 session 与 token 元数据的任务。

开始前按需要继续阅读：

- [authoring.md](authoring.md)：定义文件、参数、agent 调用、并发、返回值与确定性约束。
- [chart.md](chart.md)：`wf.chart` 状态图规范。所有面向用户运行的 workflow 都必须遵守。

## 什么时候使用

使用 workflow：

- 同一种多阶段流程会重复运行，例如拆书、并行脑暴、写作评审循环；
- 需要固定扇出、汇合、循环或人工确认点，而不是让主 agent 临场调度；
- 用户需要在 workflow 气泡中持续看到状态图；
- 需要一次返回自定义结果、参与 session、token 用量和终态图。

直接创建或调用子 agent：

- 只有一个短任务，完成后直接把结果交回主会话；
- 流程仍在探索，步骤会随调查结果大幅变化；
- 不需要可重放编排、并发控制或状态图。

Skill 负责提供知识和操作方法；workflow 负责执行确定的多阶段编排。不要为了把说明文字打包而创建 workflow。

## 目录与覆盖

每个 catalog workflow 独占一个目录，入口固定为 `workflow.ts`：

```text
agent/workflows/
└── my-workflow/
    └── workflow.ts
```

- Install Root：Workspace Root `.nbook` 下的 `agent/workflows/<key>/workflow.ts`；默认物理位置是 `workspace/.nbook/agent/workflows/<key>/workflow.ts`。内置 workflow 由安装器从随程序附带的种子包装到这里，装完就是普通的已安装包。
- Project Root：当前项目根 `.nbook/agent/workflows/<key>/workflow.ts`。只有调用方显式绑定了该 Project Workspace 时才会读取这一层；未绑定项目时，项目 workflow 不会泄漏到全局或其他项目。
- `assets/workspace/.nbook/agent/workflows/` 是 Seed Root，**不是 catalog 层**。catalog 不从这里加载任何 workflow，它只作为安装器的来源。
- `<key>` 是稳定寻址键。同 key 时整个 catalog 条目覆盖，不会合并两份 `workflow.ts`。
- 覆盖顺序固定为 `Install Root → Project Root`；后层同 key 有效目录覆盖前层。安装、升级、卸载与来源记账见 [agent-asset-install.md](../agent-asset-install.md)。
- 文件内的 `key` 仍应和目录名一致，但 catalog 最终以目录名覆盖文件内 `key`。
- catalog 只读取固定入口 `workflow.ts`。源码不能 `import` 或 `require`；运行能力来自 `wf`，JSON Schema 构造器来自宿主注入的 typebox `Type`。

临时编排不写目录。Agent 可以把完整源码作为 `run_workflow({script})` 运行；它和目录源码使用同一套转译与受限求值边界。

## 发现与运行

先用 `list_workflows({})` 查看当前可见的 workflow 以及可指定的模型。运行工具有两种互斥入口：

```ts
run_workflow({
    workflowKey: "parallel-brainstorm",
    args: {topic: "新章节的冲突设计"},
    model: "provider/model",
    // 默认后台运行；无需写 wait: false
});
```

```ts
run_workflow({
    script: "export default { key: 'inline', run: async (wf, args) => ({ ok: true }) };",
    args: {},
    wait: true,
});
```

`workflowKey` 与 `script` 必须二选一。`args` 必须是对象，不是 JSON 字符串。顶层 `model` 是本次 run 创建 agent session 时的默认模型，只能来自 `list_workflows` 返回的用户批准清单；省略时使用各 profile 的默认模型。

每次 `run_workflow` 都需要用户审批。

## 后台运行与 wait

`run_workflow` 默认非阻塞：审批通过后立即注册后台 job，并以 details 返回 `{jobId, runId, workflowKey, status: "started", background: true}`。发起方 agent 应向用户简述任务已启动，然后结束当前回合，不要轮询。workflow 结束后，结果卡（自定义返回值 JSON、参与 session、token 用量）会以系统 followup 自动回流到发起 session，触发新一轮回合；agent 再据此向用户汇报或继续编排。

- `wait: true` 走阻塞路径：当前工具调用等待 workflow settle 并直接返回完整 details，只适合不含长调用和人工参与点的短内联编排。
- `wf.ask` 挂起时：后台 job 转为 `waiting`，用户在 workflow 面板应答后自动恢复跟踪；`wait: true` 则以 `waiting` 正常返回，后续不再有 job followup。两种情况都不要重复启动同一个 workflow。
- `list_jobs({status?})` 默认只列当前 session 发起的 job；只有确需全局排查时才传 `all: true`。
- `get_job({jobId})` 返回 job 快照；workflow job 还带 run 状态、结果、待应答问题、参与 session 与 usage。它用于用户主动询问或一次性诊断，不用于循环轮询。状态图继续看 workflow 气泡或 run 状态接口。
- `cancel_job({jobId})` 只能取消当前 session 发起的 job。取消请求会传播到执行链：Workflow 当前 Agent activity 通过 Run signal 取消，Harness 对不合作的 provider/tool 在有界宽限后提交唯一 aborted 终态；waiting job 会立即解除等待并进入 `cancelled`。Job 只有在执行链完成收口后才确认最终 `cancelled`，调用方应读取后续快照确认。

## 返回契约

后台模式（默认）的工具即时 details 只有 `{jobId, runId, workflowKey, status: "started", background: true}`；完整结果在自动回流消息与 `get_job` 中。回流中的结果 JSON 直接返回完整结构化数据，不使用 Markdown code fence，也不以字符数截断；`get_job` 返回同一份完整结果。`wait: true` 阻塞模式下，工具正文给主 agent 一段可读摘要；结构化 `details` 是完整结果：

```ts
{
    runId: string,
    workflowKey: string,
    status: "completed" | "waiting" | "failed" | "cancelled",
    result: JsonValue | null,
    error: string | null,
    pendingAsks: string[],
    sessions: Array<{
        sessionId: number,
        profileKey: string,
        title: string,
        tokens: AgentInvokeUsage | null,
    }>,
    usage: AgentInvokeUsage,
    chartMermaid: string | null,
}
```

`result` 只包含 workflow `run` 的自定义返回值。`sessions`、`usage` 与 `chartMermaid` 由平台附加，workflow 不要自行伪造或重复包装这些元数据。后台完成通知与 `get_job` 共享同一份完整结构化 JSON；Job 列表中的 preview 只用于轻量展示，不能作为结果真相源。

## ad-hoc agent（adhoc profile）

一次性帮工不必先写 profile 文件：内置 `adhoc` profile 用「提示词 + 可选输出 schema」直接定义临时 agent（Task 111 E3）。

```ts
const extractor = await wf.agents.create("adhoc", {
    initial: {
        name: "章节要素抽取器",
        systemPrompt: "你是小说章节结构分析师。用户给你一章正文，你提取人物、场景与冲突。",
        outputSchema: Type.Object({
            characters: Type.Array(Type.String()),
            conflict: Type.String(),
        }, {additionalProperties: false}),
    },
    ephemeral: true,
    tags: ["workflow:my-workflow"],
});
const outcome = await extractor.invoke({message: `分析这一章：\n${chapterText}`});
const data = outcome.result.data; // agent 调用 report_result 后，这是通过 outputSchema 校验的对象
```

- `initial.systemPrompt` 定义稳定角色；每轮任务内容走 `invoke({message})`，不要塞进 initial。外部文件先用 `wf.workspace.read` 读出再拼进 message。
- `initial.name` 可省略，`initial.systemPrompt` 必填；稳定角色、规则和 few-shot 放 initial，每轮真实任务只放 `invoke.message`。没有 `humanMessage` 或 `inputSchema` 字段。
- `initial.outputSchema` 是 JSON Schema 对象；声明后该 session 的 `report_result.data` 变为必填，并按它严格校验。workflow 求值作用域在模块顶层注入了 typebox `Type`，直接写 `Type.Object(...)`，不要 `import {Type} from "typebox"`；也可使用裸 JSON Schema 字面量。
- adhoc 工具固定为 `read` + `report_result`。V1 没有 `initial.tools` 字段，传入会因 additionalProperties 门禁被拒绝；`report_result` 始终存在，不属于可选白名单。
- `invoke` 优先把 `report_result.result/data` 投影为 `outcome.result.message/data`；若模型没有调用 `report_result`，message 回落到最后一条 assistant 文本，data 为 `null`。声明了 outputSchema 的 workflow 应检查 data 非空，否则明确失败。
- 一次性参与者推荐 `ephemeral: true`：run 成功后自动归档；failed/waiting 会保留现场，rerun 命中 journal 后继续复用同一 session。

## 内置 workflow

- `split-book`：读取 Project Workspace 书稿，逐章并发摘要，再汇总剧情结构。
- `write-review-loop`：在两个独立 session 间执行固定轮数的初稿、评审与修订，返回最终文本和评审记录；它不直接写文件。
- `parallel-brainstorm`：按多个角度并发发散，再汇总去重为一份方案。
