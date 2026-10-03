# `wf.chart` 状态图规范

`wf.chart` 是 workflow 面向用户的主要运行视图。状态图从零开始，随代码执行增量长出；终图同时记录流程结构、执行顺序、循环次数、并行执行线和参与 session。

面向用户运行的 workflow 必须画 chart。只有进度条、日志或一个笼统节点，都不足以说明当前是谁在做什么。

## 核心语义

- 零预置：宿主不会根据 `phases` 自动生成状态图；没有 chart 事件时 `chartMermaid` 为 `null`。
- 只增不删：API 没有删除节点或边的操作。重复声明同一 key 会复用节点；重复走同一条边会追加执行序号。
- node 与 token 分离：node 是稳定业务状态；token 是当前执行线。默认 token 是 `main`。
- session 持久署名：`enter` 或 `move` 带 `sessionId` 后，该 session 会一直显示在做过工作的节点上；token 离开只改变活跃状态，不抹掉署名。
- 图是观测，不是控制流：`chart` 不会创建 agent、等待任务或改变 workflow 结果。先写真实控制流，再在对应位置发事件。

## API

```ts
wf.chart.node(key, title?);
wf.chart.edge(from, to, label?);
wf.chart.enter(key, {token?, sessionId?});
wf.chart.leave(key, {token?});
wf.chart.move(from, to, {token?, sessionId?, label?});
```

- `node`：声明业务节点。key 在整个 run 内稳定且唯一，title 给用户看。
- `edge`：声明一条边，适合并行分支的扇出、汇合。首次声明会得到执行序号；再次声明同一条边只复用边并可更新 label，循环计数应使用 `move`。
- `enter`：让 token 进入节点，节点变为活跃；带 `sessionId` 可显示执行者。
- `leave`：让 token 离开节点。它不创建边。
- `move`：原子执行 `leave(from)`、经过 `from -> to`、`enter(to)`；主线推进和循环优先用它。

`move` 会确保边存在。同一条边多次 `move` 后，边上会累积 `①②③…`，节点标题会显示访问次数 `×N`，因此循环不需要为每一轮复制节点。

## 构图口诀

1. 起点：一个 `node`，真实工作开始前立刻 `enter`。
2. 主线：进入下一阶段用 `move`，同时把下一位执行者的 `sessionId` 挂上去。
3. 扇出：`wf.map` 每项一个稳定 node、一个稳定 token；从起点 `edge` 到分支，再 `enter`。
4. 分支结束：先 `leave` 对应 token，再把分支 `edge` 到汇合节点。
5. 汇合：所有分支结束后让 `main` token `move` 或 `enter` 汇合节点，完成汇总工作。
6. 循环：复用 review/revise 等业务 node，用反复 `move` 留下边序号和访问次数。
7. 收尾：`move` 到完成节点，结果准备好后 `leave`，不要让终图错误地停在“运行中”。

## token 与 key

并发 token 必须来自稳定输入或数组序号，例如章节 id、subject id、`angle-${index + 1}`。不要用 session id、时间或随机数作为业务 key；重放时 session id 可以来自 journal，但它不应决定控制流结构。

节点 key 使用短的 ASCII slug，避免空格、引号和 Mermaid 标点：

```ts
const nodeKey = `chapter-${index + 1}`;
const token = `chapter-${index + 1}`;
```

title 可以包含中文和业务名称，但应简短。不要把整段 prompt、模型输出或敏感正文写进 title/label。

## 好示例：拆书扇出与汇合

```ts
wf.chart.node("read", "读取书稿");
wf.chart.enter("read");

const briefs = await wf.map(chapters, async (chapter, index) => {
    const token = `chapter-${index + 1}`;
    const nodeKey = `brief-${index + 1}`;
    const agent = await wf.agents.create("adhoc", {
        initial: {
            systemPrompt: "提取章节摘要，不补写原文没有的信息。",
            outputSchema: Type.Object({summary: Type.String()}),
        },
        ephemeral: true,
    });

    wf.chart.node(nodeKey, `摘要：${chapter.title}`);
    wf.chart.edge("read", nodeKey, "派发");
    wf.chart.enter(nodeKey, {token, sessionId: agent.id});

    const response = await agent.invoke({message: chapter.text});

    wf.chart.leave(nodeKey, {token});
    wf.chart.node("merge", "合并分析");
    wf.chart.edge(nodeKey, "merge", "并入");
    return response.result.data;
}, {concurrency: 3});

const analyst = await wf.agents.create("adhoc", {
    initial: {
        systemPrompt: "根据逐章摘要合并分析全书结构。",
        outputSchema: Type.Object({analysis: Type.String()}),
    },
    ephemeral: true,
});
wf.chart.move("read", "merge", {sessionId: analyst.id, label: "汇合"});
const result = await analyst.invoke({message: JSON.stringify(briefs)});
wf.chart.node("done", "完成");
wf.chart.move("merge", "done", {label: "产出"});
wf.chart.leave("done");
```

这个图能回答：切出了几条并行线、每条由哪个 session 执行、何时汇合、当前分析者是谁、最终是否已经结束。

## 好示例：评审循环

```ts
wf.chart.node("draft", "生成初稿");
wf.chart.enter("draft", {sessionId: writer.id});

let currentNode = "draft";
for (let round = 1; round <= reviewRounds; round++) {
    wf.chart.node("review", "评审");
    wf.chart.move(currentNode, "review", {
        sessionId: reviewer.id,
        label: `第 ${round} 轮评审`,
    });
    await reviewer.invoke({message: "评审当前稿件"});

    wf.chart.node("revise", "修订");
    wf.chart.move("review", "revise", {
        sessionId: writer.id,
        label: `第 ${round} 轮修订`,
    });
    await writer.invoke({mode: "followup", message: "按评审意见修订"});
    currentNode = "revise";
}
```

第二轮开始会再次经过 `revise -> review -> revise`。终图用访问次数和边序号表达真实循环，不需要生成 `review-1`、`review-2` 等重复业务节点。

## 坏示例

完全不画图：

```ts
const answers = await wf.map(items, work);
return merge(answers);
```

用户只能看到黑盒，无法分辨正在扇出、等待、汇合还是卡住。

只有一个总节点也不合格：

```ts
wf.chart.node("work", "处理中");
wf.chart.enter("work");
const answers = await wf.map(items, work);
wf.chart.leave("work");
```

它隐藏了每条并行线、参与 session 和汇合阶段，与单个 loading 状态没有区别。应按上面的扇出与汇合模式，为每个分支建立 node/token，并把执行者 `sessionId` 挂到节点上。

## 提交前自检

- 首个真实工作开始前是否已经 `enter`？
- 每个并行分支是否有独立稳定 token？
- 每个 agent 工作节点是否带 `sessionId`？
- 分支结束是否 `leave`，并连接到明确的汇合节点？
- 循环是否复用业务节点，并通过 `move` 留下执行序号？
- 所有成功返回路径是否在完成节点 `leave`？
- title/label 是否短小、无敏感正文、无需对话上下文也能理解？
