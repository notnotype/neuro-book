# nb-memory

`@notnotype/nb-memory` 是 TypeScript/Bun 原生的叙事记忆框架。它区分摄入序 `tick` 与故事时间 `instant`，并把 episode、fact、主体 registry 和可变 state 分开保存；LLM、embedding、存储与索引均通过 port 注入。

```ts
import {FsStorage, NbMemory} from "@notnotype/nb-memory";

const memory = await NbMemory.open({storage: await FsStorage.open(dir), embedder, llm, indexStore});
await memory.ingestBatch([{tick: 1, instant: 86400n, time: "第一天", text: "……"}]);
const hits = await memory.search("她住在哪？", {asOfInstant: 1_000_000n});
```

JSONL 是事实源，向量与倒排索引可重建。查询过滤采用 fail-closed：指定时间轴时，缺少该轴坐标的记录不可见。API、查询计划和当前限制见[项目 README](https://github.com/notnotype/neuro-book/blob/master/packages/nb-memory/README.md)。
