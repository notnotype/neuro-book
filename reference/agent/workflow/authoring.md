# Workflow 编写指南

本页描述当前运行时真实支持的 workflow 定义与 `wf` API。先读入口 [README.md](README.md)；状态图写法见 [chart.md](chart.md)。

## 定义文件

当前运行时没有可调用的 `defineWorkflow()` helper。源码也不能导入类型或函数，因此必须直接 default export 一个定义对象：

```ts
export default {
    key: "my-workflow",
    title: "人类可读标题",
    description: "一句话说明产出。",
    whenToUse: "说明 leader 应在什么用户意图下选用，以及不该在什么场景选用。",
    argsHint: [
        {name: "topic", label: "议题", defaultValue: ""},
    ],
    phases: [
        {key: "draft", title: "生成初稿"},
        {key: "review", title: "评审修订"},
    ],
    run: async (wf, args) => {
        return {topic: args?.topic ?? "", ok: true};
    },
};
```

必需字段只有 `key` 与 `run`。catalog 还读取 `title`、`description`、`whenToUse`、`argsHint`；`phases` 用于阶段进度投影。目录型 workflow 的最终 `key` 由目录名决定。

源码先经过 TypeScript `transpileModule`，随后在不提供 `require` 的 CommonJS 壳中求值。求值函数只注入 `Type`（typebox JSON Schema builder）；`wf` 要到 `run` 调用时才作为参数传入。`Type` 可在模块顶层直接使用。这个过程只转译、不做完整类型检查；类型标注不能替代运行级测试。禁止 `import`、`require`、`process`、文件系统或环境读取，也不要为了 Type 写 import。

## 参数

`run(wf, args)` 的 `args` 与 `wf.args` 是同一份 run 入参。当前没有 `args` schema 声明或自动校验；`argsHint` 只是用户主动触发时的字符串表单提示。

在 `run` 开头完成默认值、类型收窄和上下限约束：

```ts
const topic = typeof args?.topic === "string" && args.topic.trim()
    ? args.topic.trim()
    : "未命名议题";
const concurrency = Math.max(1, Math.min(Number(args?.concurrency) || 3, 6));
```

不要依赖表单保证类型正确。Agent 调用 `run_workflow` 时可以直接传数组、布尔值等 JSON 值，而 `argsHint.defaultValue` 始终是字符串。

## 创建与复用 agent


```ts
const agent = await wf.agents.create("adhoc", {
    initial: {
        name: "评审",
        systemPrompt: "只评审调用方提供的稿件，指出问题和改法。",
        outputSchema: Type.Object({
            issues: Type.Array(Type.String()),
        }, {additionalProperties: false}),
    },
    tags: ["workflow:my-workflow", "role:reviewer"],
    ephemeral: true,
    model: "provider/model",
});
```

选项含义：

- `initial`：profile 的实例初始化参数，必须符合该 profile 的 initial contract；不要把每轮任务塞进这里。
- `tags`：session 标签，建议至少包含 `workflow:<key>`。
- `parent`：可选父 `SessionHandle`。
- `ephemeral`：`true` 表示 run 成功后自动归档，适合一次性参与者。
- `model`：该 session 的模型覆盖。只能使用用户批准的可见模型；优先让调用方通过 `run_workflow({model})` 设置 run 级默认值。省略时先取 run 级默认，再取 profile 默认。

跨 run 需要连续记忆时使用持久参与者：

```ts
const editor = await wf.agents.acquire({
    profileKey: "leader.default",
    tag: "workflow:serial-editor",
});
```

它按 `(profileKey, tag)` 复用未归档 session。一次性并行分支不要用 `acquire`，否则不同 run 会意外共享上下文。`adhoc` 的 initial 含必填 `systemPrompt`，因此第一次必须先用 `create(..., {initial, tags, ephemeral: false})` 建立持久 session；后续 run 才能用 `acquire({profileKey: "adhoc", tag})` 复用。不要让 `acquire` 尝试无 initial 新建 adhoc。

一次性帮工优先用内置 `adhoc` profile：`initial` 的真实合同只有 `{name?, systemPrompt, outputSchema?}`。工具固定 `read + report_result`，没有 `tools`、`humanMessage` 或 `inputSchema` 字段。任务放 `invoke.message`；`outputSchema` 声明后，`report_result.data` 必填且会按 schema 严格校验，调用方继续消费并检查 `result.data`。推荐始终传 `ephemeral: true`。完整示例见 [README.md](README.md) 的「ad-hoc agent」一节。

`wf.agents.profile(profileKey)` 会以 journaled Activity 读取 profile 信息。只有编排确实需要基于 profile 元数据构造结果时才调用；判断 profile 是否存在应在 workflow 入库和测试阶段完成，不要把运行时探测当作正常分支。

## 调用 agent

`wf.agents.create` 返回 `SessionHandle`。调用方法在句柄上，不存在根级 `wf.invoke`：

```ts
const outcome = await agent.invoke({
    mode: "prompt",
    message: "请给出三条具体建议。",
    input: {topic},
});

if (outcome.status === "waiting") {
    return {status: "agent-waiting", question: outcome.result.message};
}

const text = outcome.result.message;
const data = outcome.result.data;
```

`mode` 可为 `prompt`、`continue`、`steer`、`followup`。`message` 是自然语言任务；`input` 是必须符合目标 profile payload contract 的 JSON 值。adhoc 没有 input schema，任务直接拼进 message。返回值固定为 `{status, result: {message, data}}`：宿主优先使用 `report_result.result/data`，否则 message 回落到最后一条 assistant 文本、data 为 `null`。

已有 session id 可用 `wf.agents.invoke(sessionId, options)`，或先 `wf.sessions.open(sessionId)` 获取句柄。`SessionHandle` 还提供：

- `id`：session id；
- `leaf()`：当前句柄游标；
- `transcript({tail?})`：读取当前游标路径上的对话；
- `append({role, message?, input?})`：在当前游标追加消息；
- `checkout(entryId)`：把句柄与 session active leaf 移到指定 entry；
- `excursion(at, fn)`：从 `entryId` 或 `"leaf"` 开旁支，回调结束或抛错后自动回到原游标。

这些是高级 session 树原语。除非流程明确需要开旁支或移动游标，不要用它们代替普通 `invoke`。

## 并发与汇合

并发 map 使用 `wf.map`：

```ts
const answers = await wf.map(angles, async (angle, index) => {
    const agent = await wf.agents.create("adhoc", {
        initial: {
            systemPrompt: `只从「${angle}」角度回答。`,
            outputSchema: Type.Object({ideas: Type.Array(Type.String())}),
        },
        ephemeral: true,
    });
    const response = await agent.invoke({message: `围绕「${topic}」提出想法。`});
    return {index, angle, ideas: response.result.data};
}, {concurrency: 3});
```

异构任务使用惰性 thunk：

```ts
const [outline, risks] = await wf.all([
    async () => await outlineAgent.invoke({message: "给出提纲"}),
    async () => await riskAgent.invoke({message: "列出风险"}),
]);
```

不要使用裸 `Promise.all`。`wf.map` 与 `wf.all` 会为每个分支分配稳定路径，确保并发完成顺序不会改变 Activity 身份。返回数组仍按输入顺序排列。

## 其他稳定 API

- `wf.workspace.read(path)`：只读当前 Project Workspace 文件，路径使用 `manuscript/...`、`lorebook/...` 等 Project Workspace 相对语义。
- `wf.ask(spec)`：创建 `select`、`text` 或 `approve` 人工参与点；可附 `description` Markdown 说明；未应答时 Run 进入 `waiting`。默认后台 Run 的问题会显示在发起 Session Composer 下方的 Workflow 待处理区，用户逐项提交后再 resume；`wait:true` 没有 Job 收件箱，遇到 ask 会取消并报错，编写需要人工参与的流程时不要要求调用方使用 `wait:true`。不要让 agent 代答，也不要重复启动同一个 Run。
- `wf.log(message)`：写运行日志。
- `wf.progress({phase, done?, total?})`：更新阶段进度；`phase` 应来自定义中的 `phases`。
- `wf.caller()`：获取发起方 session 句柄。只有 agent 通过工具触发时存在，其他入口会抛错。
- `wf.chart.*`：发出状态图观测事件，完整规范见 [chart.md](chart.md)。

## 返回值设计

`run` 必须返回 JSON 值：`null`、布尔值、数字、字符串、JSON 数组或只含 JSON 值的对象。不要返回 `undefined`、`Error`、`Map`、`Set`、class 实例、函数或 session 句柄。

返回业务结果，不返回平台元数据：

```ts
return {
    topic,
    perspectives: answers,
    synthesis: merged.result.message,
};
```

默认后台模式先返回 jobId/runId，平台在完成回流和 `get_job` 中提供业务结果、触达 session 与 usage；`wait: true` 的完整 details 还包含终态状态图。workflow 自定义结果不要复制这些平台元数据。公开 usage 只包含 token 明细，不包含 `cost`；Run 的公开 `journal/events` 同样移除 invocation usage 中的 `cost`，但保留自定义结果自己的 `cost` 字段；价格仍属于普通 Session 的内部统计。

## 确定性与重放

Activity 的身份由分支路径、路径内序号、操作种类和参数指纹共同决定。恢复或重跑时，已完成且指纹相同的 Activity 命中 journal，不会再次执行副作用。

必须遵守：

- 禁止 `Date.now()`、`new Date()`、`Math.random()`、环境变量和进程状态；
- 外部读取、agent 创建/调用、人类提问都走 `wf` API；
- 并发只用 `wf.map` 或 `wf.all`；
- 不要按并发完成先后决定下一步；
- 把会改变结果的内容放进 `args`、`message`、`input` 或其他 `wf` API 参数，使变化进入指纹；
- 循环次数、数组顺序和分支 key 必须来自稳定输入，不能来自时间或随机数。

`wf.log`、`wf.progress` 与 `wf.chart` 是观测事件，不写 journal。代码重放时会按同一控制流重新发出，因此它们也必须使用稳定 key、token 与顺序。
