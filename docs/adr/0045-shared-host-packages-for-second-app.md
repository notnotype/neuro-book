---
schema: nbook.adr/v1
status: accepted
decided: 2026-11-10
superseded-by: null
---

# ADR 0045：第二个应用要的宿主底座抽成 nb-host、nb-models、nb-file-lock 三个包

- 日期：2026-11-10
- 决策者：开发者
- 关联工作：[w00043 t02](../../.agents/works/w00043-neurobot/tasks/t02-host-base/README.md)（计划见该 Task 的 [plan.md](../../.agents/works/w00043-neurobot/tasks/t02-host-base/plan.md)）；起因是提案 [NeuroBot 第一版](../proposals/neurobot.md)
- 部分取代：[ADR 0030](0030-plugin-platform-layering.md) 决策 2 里的搬包条件“出现第二个使用插件模式的应用时，再把这个目录搬成包”；0030 的其余决定不变
- 相关文档：[`runtime/server-host.md`](../specs/runtime/server-host.md)、[`runtime/browser-host.md`](../specs/runtime/browser-host.md)、[`runtime/diagnostics.md`](../specs/runtime/diagnostics.md)、[`models/service.md`](../specs/models/service.md)、[`monorepo-boundaries.md`](../modules/monorepo-boundaries.md)、[ADR 0024](0024-multi-instance-runtime-topology.md)、[ADR 0029](0029-workspace-packages-publish-source-to-npm.md)

## 背景

NeuroBot 是 monorepo 里第二个建在 nb-runtime 上的应用（开发者 2026-11-09 选定：新建应用包、在 nb-runtime 上自建）。nb-runtime 只管内核：生命周期、服务、插件、远程服务。真正跑起一个应用还要一层宿主，这一层现在都在 NeuroBook 应用包里：

- 服务端宿主：只许监听回环、HTTP 的 `Host` 不是回环名回 421、RPC 端口与带 `Origin` 的写请求只接受本进程页面的来源（否则 403）、状态根认领、RPC 端口的监听与握手、启动与停止的顺序与退出码。安全规则见 [`runtime/server-host.md`](../specs/runtime/server-host.md)。NeuroBot 只监听本机、没有登录，安全全靠这几条（提案第四节第 10 小节）。
- 浏览器宿主：浏览器一侧的内核实例、到服务端的 RPC 连接、断线后的退避重连。
- HTTP 插件的准入与分发、诊断日志的 JSONL 出口（宿主要在任何插件之前就能记录）。
- 模型服务（`nbook.models` 的核心）：按角色解析模型、服务商与模型配置、OMP 凭据库、给 harness 的模型端口。
- 加锁替换（`src/backend/locked-replace.ts`）：设置、Files、canon、插件平台都靠它跨进程安全地写文件。

仓库规则是领域包不得依赖应用包（[`monorepo-boundaries.md`](../modules/monorepo-boundaries.md)），有了实际的跨宿主复用才下沉。NeuroBot 就是这个复用。

提案第二稿列了四种做法：(a) 各写最小版；(b) 只把安全攸关、已经调好的抽成包共用，其余 NeuroBot 自己写；(c) 整层应用平台抽包；(d) 不另起应用，做成 NeuroBook 的一组插件。开发者 2026-11-10 选 (b)。t02 的计划审查又提出模型服务的去处、加锁替换会被抄第三份、诊断出口没有归属三件事，开发者同日同意了推荐的做法，并在同意 w00043 的 Task 规划时追认了包名、子路径与内置角色表三项。

ADR 0030 决策 2 让第三方插件的通用管理暂留应用的 `src/plugin-platform/`，条件写的是“出现第二个使用插件模式的应用时搬成包”。NeuroBot 照字面就是第二个装配插件的应用，但它只用内置插件，用不上安装、登记与装载。开发者 2026-11-10 同意改这个条件。

## 决策

1. **新包 `@notnotype/nb-host`：两端宿主中与应用无关的部分。**
   - 服务端：回环与来源校验、状态根认领协议、端口顺延、RPC 监听、停止来源的汇合、`startHostServer`（启动与停止的顺序、两路排空、退出码）、HTTP 插件（准入、分发、`Host` 与 `Origin` 核对、页面资源）、诊断的 JSONL 出口。
   - 浏览器：内核实例、远程会话（首连与退避重连）、RPC 套接字、客户端身份、控制台诊断出口；两端共用的套接字链路。
   - 应用名、环境变量、缺省端口、产品名、插件 id、认领档案里的应用字段一律由应用传入，包的源码不出现应用名，由扫描测试守住（同 ADR 0030 决策 1 的做法）。
   - HTTP 与诊断两个宿主插件由 `startHostServer` 自己建，来源判定由包算出、同一个判定交给 HTTP 分发与 RPC 升级；应用只给插件 id、宿主路由与静态目录，换不掉判定，也漏装不了这两个插件。
2. **新包 `@notnotype/nb-models`：模型服务。** 配置形状、内置角色（`tiny`、`fast`、`main`、`deep` 与 `compaction`）与选择顺序、纯规则、远程合同的定义对象与失败码表、服务核心都在包里，两个应用共用。服务键与远程合同的 id、设置分区、角色的名字与说明文字、设置页留在各应用；设置存储由应用按包的存储接口实现，接口的语义由包导出的一致性测试守住。包依赖 nb-runtime 与 nb-harness；nb-harness 不反向依赖它。
3. **新包 `@notnotype/nb-file-lock`：跨进程锁与加锁替换。** 工作区里只有它直接用 `proper-lockfile`，锁的过期与退避参数只有这一份；nb-host 的状态根认领、NeuroBook 的设置与 Files、以后 NeuroBot 的记忆与设置都从它取。
4. **三个包都是 `private: true`，不发 npm。** 子路径：`nb-file-lock` 只有 `.`；`nb-host` 为 `./server`、`./http/contracts`、`./socket`、`./web`、`./testing`；`nb-models` 为 `./config`、`./contract`、`./core`、`./testing`，其中 `./config`、`./contract` 可进浏览器。要发布时另行决定（同 ADR 0029 决策 6 对其它工作区包的说法）。
5. **部分取代 ADR 0030 决策 2 的搬包条件**：改为“出现第二个需要第三方插件（安装、登记、装载）的应用时，再把 `src/plugin-platform/` 搬成包”。NeuroBot 只用内置插件，`plugin-platform` 留在 NeuroBook 应用。
6. **不抽的由各应用自己写**：设置与存储、把 harness 接进应用的那层、网页一侧的对话宿主、开发监督进程、项目子进程、命令行，以及启动环境与 OMP 进程级处理的接管（[ADR 0036](0036-app-package-installs-omp.md)：它们必须是每个入口最先执行的导入，包替不了入口）。

## 备选方案

下面是提案讨论与计划审查时列出的各方案代价。开发者按推荐选定，没有另外说明理由，以后不要把这些当作开发者的理由引用。

- **(a) 各写最小版**：安全规则与调过多轮的启动、停止顺序复制成两份，会各自走样。
- **(c) 整层应用平台抽包**：设置、存储、Agent 接线现在只有 NeuroBook 一个使用者，接口只会照着它设计；NeuroBot 的会话按“哪个 bot、在哪里聊”开，接线会不同，等写出来再比重复多少。
- **(d) 做成 NeuroBook 的一组插件**：NeuroBook 是按作品打开的写作工作台，NeuroBot 是常驻的多渠道服务，产品与发布会绑在一起。
- **宿主放进 nb-runtime 的新子路径**：nb-runtime 的运行时依赖只有 TypeBox、前后端共用；服务端宿主要 Bun 的服务、Hono 与文件锁。
- **加锁替换随 nb-host 走**：设置、Files、canon 这些与宿主无关的代码也用它，不该为此依赖宿主包；nb-host 自带一份只取锁放锁的精简版，会丢锁失效时的报告与放锁前的身份核对，参数也成两份。
- **模型服务放进 nb-harness**：服务的远程合同建在 nb-runtime 上，而 nb-harness 不依赖 nb-runtime（w00032 t32 加扫描守住）。
- **只把 `plugin-platform` 照 0030 的字面搬成包**：没有第二个使用者，搬过去的接口仍只照 NeuroBook 设计，正是 0030 当初不现在抽包的理由。

## 后果

- NeuroBook 用户可观察的行为、配置、环境变量、诊断事件名与 HTTP 错误码不变；`runtime/server-host.md`、`runtime/browser-host.md`、`runtime/diagnostics.md`、`models/service.md` 的 owner 与实现合同随代码改到新包。
- 新包与应用两边都有架构测试：包不出现应用名、浏览器侧只用白名单里的依赖；应用按包的子路径区分只后端、只前端与两端可用。
- 不支持两个应用共用同一个状态根，写进 nb-host 的 README 作为已知限制。
- `nb-models` 用到 nb-harness 的 `kit/shapes`（w00032 t32 新建），它的迁移排在 t32 合入之后；nb-file-lock 与 nb-host 不碰 t32 的文件，可以先做。
- `monorepo-boundaries.md` 登记三个新包；以后第三个应用要用同一层宿主时直接依赖它们，不再从 NeuroBook 抄。
