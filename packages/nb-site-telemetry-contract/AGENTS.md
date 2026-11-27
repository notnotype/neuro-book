# nb-site-telemetry-contract 包入口

本包位于 `packages/nb-site-telemetry-contract`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。官方站各包共用的规则（依赖方向、迁移、起服务、跑合同测试）在 [`../nb-site-server/AGENTS.md`](../nb-site-server/AGENTS.md)，本文件只保留本包的专属规则。

`@notnotype/nb-site-telemetry-contract` 是官方站统计模块对外的 HTTP 合同（[ADR 0059](../../docs/adr/0059-official-site-one-process-split-ready-modules.md) 决策 2）：站点地址上的路径前缀 `TELEMETRY_API_PREFIX`；三个写入口的路径、请求体上限、响应与失败码（`src/ingest.ts`）；收集清单的各个版本与三种上报的 schema（`src/manifest/`）。应用的遥测插件、官网前端、合同测试与统计模块都只经它认识统计的接口。行为合同是 [`telemetry/protocol.md`](../../docs/specs/telemetry/protocol.md)，两处不一致时以 Spec 为准。

## 边界

- 运行时依赖只许 `typebox`，devDependencies 里的工作区包只许测试支持包；由 `nb-site-server/src/architecture.test.ts` 检查。
- 两个入口：`.` 转出全部；`./constants`（`src/constants.ts`）只转出不导入 TypeBox 的常量（现在只有路径前缀，在 `src/path-constants.ts`）与全部类型，给浏览器用，免得只取一个常量也把写入口与收集清单的 schema 连同 TypeBox 的运行时打进官网的看板块。`src/constants.test.ts` 顺着运行时导入检查；前端要一个还在带 schema 的文件里的常量时，先把它挪进不导入 TypeBox 的文件。
- 只放合同：路径、schema、错误码、收集清单。不放实现，也不放只有统计模块自己用的类型。校验的算法（丢弃不认识的字段、版本回退、判的先后）是服务端的实现，在 `nb-site-telemetry`。
- 改这里就是改对外合同：写入口的形状由已发布的客户端在用，变了要按 Spec 判断是否破坏兼容。

## 收集清单

- 清单是公开合同：服务端按它拒收与聚合，应用里的收集项说明与官网的“我们收集什么”由它生成。字段、取值、分档与协议的字段表和取值表逐项一致，协议里没有的不加。
- 每个版本是 `src/manifest/anonymous.ts`、`usage.ts` 里的一个常量，发布之后不改，连说明也不改。要变就写一个新版本的常量、追加到同一文件的版本列表末尾（版本号接着上一个），旧常量原样留着；变更的三种（只加取值或改说明、加字段或改分档、使用档加类别）都要提版本，后果与发版顺序（先部署服务端，再发带新版本的应用）见协议的“边界与兼容”。
- 加版本之前先改协议，再照协议改 `src/manifest.test.ts` 里手写的期望值。那几条期望值是对着协议逐项写的，不要从清单里算出来。
- 说明文字是给用户看的：写这个字段是什么、为什么收，中英文意思一致，不写实现细节。
- 取值随别的字段而变的地方（错误码随 `owner`、事件码随 `kind`）只用 `dependent` 字段表达，匿名档里不许有。
- `owner` 的名单照应用随发行构建带的插件（`packages/neuro-book/src/manifest.ts` 的 `productPlugins`）列，只在开发时加载的不列。应用加了或改名了自带插件时，这里要出一个新的使用档版本；本包不能依赖应用，两边的核对由应用一侧的测试做（还没有，随 w00053 的遥测插件加）。
- 错误码表与事件码表：使用档第 1 版在每个 `owner`、每个 `kind` 名下都只收 `other`（w00037 t06 第 1 片的调查：应用里的错误码没有一处能列全）。什么算错误码由 w00053 定，具体的码随使用档第 2 版加。
- 已有的取值名与分档名在以后的版本里保持原来的意思：要换意思就起一个新名字，旧名字不再列，不拿旧名字装新意思。聚合按名字长期累计，同一个名字前后意思不同，跨版本的数就对不上。

## 完成门禁

```text
bun run typecheck
bun test
```

改了合同，另跑 `nb-site-telemetry`、`nb-site-server` 与 `nb-site-contract-tests` 的 `bun test`（`test:affected` 按依赖图会选中它们）。
