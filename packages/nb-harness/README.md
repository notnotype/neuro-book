# @notnotype/nb-harness

NeuroBook 的 Agent harness：只经 Profile 运行的 Agent。按 Profile 与工具登记算出生效工具集、渲染交给模型的上下文、跑一次带工具的循环或一次不带工具的请求，交出停止原因、错误、用量与收尾工具的结果，并写进可以恢复的会话日志（`@notnotype/nb-session`）。模型目录、认证与请求经 [OMP](https://www.npmjs.com/package/@oh-my-pi/pi-ai)（`@oh-my-pi/*`）。

行为合同见 [`agent.harness`](../../docs/specs/agent/harness.md)；OMP 能力的调研见 [docs/omp-capabilities.md](docs/omp-capabilities.md)。

- `@notnotype/nb-harness`：`createHarness`、`complete`、模型目录与解析（`listCatalog`、`resolveModel`、`discoverModels`）、工具登记与内置工具、SSE 序列化、进程中断与终止信号的收口。
- `@notnotype/nb-harness/testing`：给宿主测试用的替身。

新内核在开发中（[提案](../../docs/proposals/agent-harness-event-model.md)、[ADR 0035](../../docs/adr/0035-harness-log-driven-kernel.md)、[`harness/session.md`](../../docs/specs/harness/session.md)）：harness 是一台由会话日志驱动的状态机，Profile 与插件都是扩展。完成迁移之前，上面的入口仍是旧实现。

- `@notnotype/nb-harness/kernel`：新内核。
- `@notnotype/nb-harness/kernel/contracts`：公开类型、码表与定义用的构造函数（`defineExtension`、`defineContract`、`defineProfile`、`slice`、`conv`、`ext`），不拖实现。
- `@notnotype/nb-harness/prompt`：提示词模板的节点与 JSX 运行时（`jsxImportSource: "@notnotype/nb-harness/prompt"`）。

## 宿主套件

把新内核装成一个产品时用的通用件，与具体应用无关：应用专有的地址、说明文字、提示词、扩展 id、原因串与诊断消息都由宿主传入，套件不给缺省值。宿主要给的文件访问接口见 [`harness/host-kit.md`](../../docs/specs/harness/host-kit.md)；各块的行为见 `docs/specs/agent/` 下对应的 Spec。

| 子路径 | 内容 |
| --- | --- |
| `./kit/shapes` | 审批规则的 schema、工具交给审批的判定对象、写入预览的形状 |
| `./kit/files` | 宿主实现的文件访问接口 `SessionFiles` 与会话布局 `SessionLayout`、失败码、文本解码 |
| `./kit/files/local` | `localFiles`：直接读写本机目录的参考实现，给没有自己文件服务的宿主与测试用 |
| `./kit/commands` | 把 shell 命令拆成可判定的简单命令（bash 方言） |
| `./kit/tools` | 读、写、编辑、搜索、shell、提问与表单这些内置工具的声明与实现，写入预览 |
| `./kit/approval` | 规则判定、审批钩子 `createApprovalHook`、审批模型 `modelReviewer`；审批者与转问由宿主给 |
| `./kit/compaction` | 三种压缩方法与压缩后的放回 |
| `./kit/guards` | 费用与循环两个运行守卫 |
| `./kit/sessions` | 会话句柄表（空闲关闭、停止）与标题生成 |
| `./kit/testing` | `sessionFilesContract`：宿主用它检查自己的 `SessionFiles` 实现 |

浏览器只能加载 `./kit/shapes` 与 `./kit/files`：这两条导入链只值导入 `typebox`，不拖进 OMP 与 Node 内置模块。提问工具的表单用 `@notnotype/nb-form` 的核心入口检查与校验，不依赖 nb-ui 与 vue；表单怎么画由宿主定。

## 安装

```bash
bun add @notnotype/nb-harness
```

只支持 Bun 运行：包里是 TypeScript 源码，不带编译产物（[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。 OMP 的原生模块按平台安装。

## 许可证

AGPL-3.0-only，见 [LICENSE](LICENSE)。
