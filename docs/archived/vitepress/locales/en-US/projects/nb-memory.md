# nb-memory

`@notnotype/nb-memory` is a TypeScript/Bun-native narrative memory framework. It separates ingestion order (`tick`) from story time (`instant`), and stores episodes, facts, a subject registry and mutable state independently. LLM, embedding, storage and indexing are injected ports.

```ts
import {FsStorage, NbMemory} from "@notnotype/nb-memory";

const memory = await NbMemory.open({storage: await FsStorage.open(dir), embedder, llm, indexStore});
await memory.ingestBatch([{tick: 1, instant: 86400n, time: "day one", text: "..."}]);
const hits = await memory.search("Where does she live?", {asOfInstant: 1_000_000n});
```

JSONL is the source of truth; vector and lexical indexes are rebuildable. Query filters fail closed: when an axis is requested, records without a coordinate on that axis are invisible. See the [project README](https://github.com/notnotype/neuro-book/blob/master/packages/nb-memory/README.md) for APIs, query planning and current limitations.
