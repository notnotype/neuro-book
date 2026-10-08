---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.plugin-api
owners:
  - runtime
---

# 插件公开 API（SDK）

## 目标与非目标

给插件作者一套稳定的公开 API：插件只经宿主注入的上下文访问宿主与其它插件，所有跨边界的接口都按远程调用的形态设计，使第一版同进程直接调用与以后的跨进程调用共用同一份接口定义，也使内核能完整记账并撤回引用。CPU 密集的工作有 worker 池可用，不必在主线程上长时间计算。

明确不承诺：

- 不承诺插件可以 import 宿主内部模块或其它插件的模块；这样写的插件不受兼容承诺保护，热插拔的撤回也不覆盖它们。
- 不提供权限模型与沙箱；第一版完全信任。
- 不定义各内置插件导出服务的具体方法；它们由各自的能力 Spec 定义，并同样遵守本文的形态约束。
- 不打断 worker 中的 WebAssembly 与原生阻塞调用（见“边界与兼容”）。

## 术语与参与者

- **SDK**：一个只含类型与少量纯函数的包，不依赖宿主内部模块。
- **激活上下文 `ctx`**：宿主在激活入口时注入的对象，按运行位置提供不同成员。
- **远程形态**：满足下文五条约束的接口形态。
- **结构化结果**：`{ok: true, value}` 或 `{ok: false, error: {code, message, ...}}`，调用不以抛出异常表达失败。
- **作用域登记**：经 `ctx` 建立的订阅、定时器、句柄都登记在入口的激活作用域上，入口停止时自动撤回。

## 输入与前置条件

- 作者用 SDK 的 `defineEntry({location, requires, provides, contributes, activate})` 声明入口；构建预设据此生成清单（[`runtime.plugin-manifest`](plugin-manifest.md)）。只提供组件、不需要初始化逻辑的浏览器入口可以省略 `activate`。
- `activate(ctx)` 在入口激活时调用一次，返回激活结果：本入口提供的服务实现、需要实现的贡献的实现，以及浏览器入口只交给本插件自己组件的 `local` 对象。
- 其它插件导出服务的类型来自提供方发布的类型包，只以 `import type` 使用，构建后不留运行时引用；内置插件服务的类型由 SDK 提供。

## 输出与可观察行为

### 远程形态约束

跨插件接口分三类，约束不同：

| 类别 | 例子 | 约束 |
|---|---|---|
| 数据面 | 导出服务的方法、命令、贡献实现被调用时的参数与结果、远程服务方法、宿主 API 的参数与结果 | 满足下面五条 |
| 宿主适配的对象 | 事件回调与订阅返回的可释放句柄、终止信号 `signal`、浏览器入口交给贡献点拥有者的视图组件 | 不受数据约束，由宿主专门传递与撤回；以后跨进程时由宿主换成等价的远程形式 |
| 内置插件之间的内部服务 | 内置插件之间同步调用、传对象引用的服务 | 不对第三方开放，不受约束 |

数据面的五条约束：

1. 方法全部返回 Promise；
2. 参数与结果可被结构化克隆，不传函数、类实例、DOM 或 Vue 对象；
3. 事件以“订阅返回可释放句柄”的形式提供（`onDidX(cb)`），句柄登记在订阅方的激活作用域上；
4. 失败以结构化结果返回，调用不 reject；
5. 每个处理函数都收到终止信号 `signal`，宿主 API 都接受 `signal`。

浏览器入口的 `local` 对象只给本插件自己的组件，可以是响应式对象，不受上述约束。

### 激活上下文

| 成员 | 位置 | 行为 |
|---|---|---|
| `ctx.plugin` | 两端 | 插件 id、当前版本、上一次成功激活的版本（首次为空，用于数据迁移） |
| `ctx.signal` | 两端 | 入口停止时触发 |
| `ctx.services.require(id)` | 两端 | 取得 `requires` 中声明的服务，返回转发器；未声明的 id 返回 `undeclared-service` 失败 |
| `ctx.remote` | 各位置 | `use(合同).at(目标)` 调用与订阅任意实例的远程服务；本入口的远程提供项经激活产出的 `remote` 交出（[远程服务与 RPC 协议](plugin-channel.md)） |
| `ctx.config` | 两端 | 读取本插件在清单中声明的设置项的有效值，订阅变化，更新本插件的设置项；读不到其它插件的设置 |
| `ctx.secrets` | 服务端 | 本插件私有密钥的读、写、删除；落盘加密，任何接口都不把密钥发给浏览器；无法解密时返回 `secret-unreadable`（见“失败与恢复”） |
| `ctx.workers.run(module, input, options)` | 两端 | 见下文 worker 池 |
| `ctx.setTimeout`、`ctx.setInterval`、`ctx.run(promise)` | 两端 | 作用域登记的定时器与异步包装：其中抛出的错误记入本插件诊断，入口停止时自动清理 |
| `ctx.diagnostics` | 两端 | 写本插件的诊断记录，按插件 id 归类并脱敏 |

各贡献点拥有者可以在 `ctx` 上注入命令式注册接口（例如向 `nbook.agent` 注册工具）；返回的句柄同样登记在调用方的激活作用域上，并记入内核账本。

持久化记录不在 `ctx` 上：插件在依赖中声明内置插件 `nbook.storage` 的服务，按记录读写（[`storage.persistence`](../storage/persistence.md)）；插件私有目录随资源寻址与文件服务另定。

命令不在 `ctx` 上：命令由内置插件 `nbook.commands` 提供，插件向它的贡献点登记命令，在 `requires` 中声明它的命令服务后按 id 执行（[`workbench.commands`](../workbench/commands.md)）。

插件状态不在 `ctx` 上：插件用 `defineStore` 在一处声明一个入口的内存、持久化、派生与公开状态，在 `activate` 里以 `ctx` 创建，随入口代次释放（[`state.store`](../state/store.md)）；公开键是向贡献点 `state.public` 的声明（[`state.public`](../state/public-state.md)）。

### 错误码

宿主合成的错误码：`plugin-unavailable`（提供方入口不可用或已停止）、`interrupted`（调用被中止或在三步停止中被放弃）、`invalid-input`（参数不符合 schema）、`undeclared-service`、`provider-error`（提供方抛出未预期的异常，信息脱敏）、`secret-unreadable`。提供方可以定义自己的错误码，以结构化结果返回。

### worker 池

`ctx.workers.run(module, input, {signal, transfer, onProgress})` 在 worker 中执行插件预构建的单文件 ESM 模块的默认导出（一个纯计算函数），返回结构化结果：

- 成功：`{ok: true, value}`；
- 失败：`interrupted`、`task-error`、`input-not-cloneable`、`output-not-cloneable`、`load-failed`、`worker-crashed` 之一。

行为：

- 输入与输出必须可结构化克隆，大块二进制用 `transfer` 移交；worker 中拿不到宿主 API。
- 每次调用归发起它的入口。中止、发起入口停止、宿主停止都以 `interrupted` 结算，调用方在 100 毫秒内得到结果；结算后到达的结果与进度一律丢弃。
- 按（插件，模块）复用空闲 worker；全局上限为逻辑 CPU 数减 1（至少 1），每个插件上限 2；满员时排队，排队中的调用同样响应中止。
- 入口停止时只拒绝该入口的新调用、结算该入口排队与在途的调用，并终止正在执行这些调用的 worker；同一插件其它入口的调用与 worker 不受影响。
- worker 被终止到真正停止之间仍占用名额：Bun 中执行 JS 的 worker 在 1 秒内停止；Chrome 中约 2 秒；执行 WebAssembly 或原生阻塞调用时要等其返回（见“边界与兼容”）。

## 状态与转换

- 转发器：有效 → 已撤销（提供方入口停止）；撤销后调用返回 `plugin-unavailable`，不再变回有效。
- 作用域登记的定时器与订阅：随入口激活建立，入口停止时撤回；撤回后回调不再触发。
- worker 调用：排队 → 执行中 → 已结算（成功或失败之一）；每个调用只结算一次。
- `nbook.storage` 的记录、`ctx.config`、`ctx.secrets` 的数据跨入口代次与插件版本保留。

## 副作用与数据

- `ctx.secrets` 的数据位于 `<State Root>/plugin-data/<插件 id>/`，禁用时保留，卸载时按用户选择删除（[`runtime.plugin-install`](plugin-install.md)）；目录内的文件格式不是公开接口。Storage 记录的落点见 [`storage.persistence`](../storage/persistence.md)。
- `ctx.config` 的值由 `nbook.settings` 持有与持久化；插件只能读写自己声明的设置项。
- `ctx.diagnostics` 与作用域定时器中的错误进入运行时诊断（[`runtime.diagnostics`](diagnostics.md)），按插件 id 归类。

## 失败与恢复

- 调用已停止插件的转发器或通道：立即得到 `plugin-unavailable`，不等待。
- 提供方抛出未预期异常：调用方得到 `provider-error`，异常详情记入提供方诊断；提供方入口不因单次异常停止。
- 参数不可克隆：开发模式下在调用时报告违规；生产模式下跨插件调用照常进行（同进程直接传递），worker 调用返回 `input-not-cloneable`。
- worker 崩溃：本次调用返回 `worker-crashed`，该 worker 被替换，其它调用不受影响。
- `ctx.secrets` 无法解密（例如 State Root 被移到另一台机器，而加密依赖原机器的密钥库）：读取返回 `secret-unreadable`，不返回部分数据；密文保留、不自动删除；插件的设置界面提示用户重新输入，重新输入的值覆盖原密文。密钥能否随 State Root 迁移、备份后能否恢复，由 `nbook.settings` 的凭据存储合同决定，本能力只保证不静默丢失、不返回空值。

## 边界与兼容

- **owner**：runtime（SDK 与宿主注入）；`ctx.config`、`ctx.secrets` 的存储归 `nbook.settings`。
- **不在运行时 import 宿主或其它插件。** 状态只在 `activate` 内建立并登记到激活作用域，不在模块顶层保存；这是热插拔撤回与代码回收的前提。
- **worker 的限制。** 调用方在中止后立即得到 `interrupted`，但 worker 中的 WebAssembly 与原生阻塞调用要等其返回 JS 才停止（Bun），死循环只能随进程重启回收；Chrome 中 worker 终止后约 2 秒才停。未停止的 worker 继续占用名额，并在诊断中按插件显示。开发者已确认不强制插件把 WebAssembly 计算切成小段，只在插件作者文档中写明。
- **兼容**：SDK 的公开面属于 `engines.neurobook` 的兼容范围；形态约束让以后把第三方插件移到共享插件宿主 worker 时公开 API 不变。
- **构建预设提示**：可以提示从未使用 `signal` 的异步处理函数，不作为构建失败条件。

## 验收与 Smoke

1. **转发器撤销。** 插件 A 取得 B 的服务后 B 被禁用，A 残留的转发器调用立即得到 `plugin-unavailable`。
2. **未声明服务。** `ctx.services.require` 取未在 `requires` 中声明的 id，得到 `undeclared-service`。
3. **提供方异常。** B 的方法抛错，A 得到 `provider-error`，B 仍然可用。
4. **worker 中止。** 在 worker 中运行 JS 死循环，调用方中止后 100 毫秒内得到 `interrupted`；Bun 中该 worker 在 1 秒内停止并释放名额，Chromium 中在 5 秒内释放名额；插件禁用时其排队与在途调用全部以 `interrupted` 结算。
5. **worker 结果形态。** 返回不可克隆的对象得到 `output-not-cloneable`；模块不存在得到 `load-failed`。
6. **作用域定时器。** `ctx.setInterval` 的回调抛错被记入插件诊断；插件禁用后回调不再触发。
7. **私有数据。** 插件写入 `nbook.storage` 的记录与 `ctx.secrets` 后禁用再启用，数据仍在；浏览器端没有 `ctx.secrets`，密钥不出现在任何发往浏览器的响应中。
8. **上一版本号。** 升级后首次激活时 `ctx.plugin` 给出上一次成功激活的版本。
9. **开发模式克隆检查。** 跨插件调用传函数时，开发模式报告违规。
10. **入口粒度。** 同一插件 `main` 与 `tts` 入口各有一个运行中的 worker 调用；`tts` 停止时只有它的调用被结算，`main` 的调用正常完成。
11. **密钥不可解密。** 用无法解密的密文替换插件密钥后读取，得到 `secret-unreadable`，密文仍在；重新写入后读取成功。

Smoke：示例外部插件在服务端与 Chromium 中各执行一次 worker 调用与中止，核对场景 1、4、6、7。

## 证据

- 批准依据：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P3、P4、P7（2026-09-30 确认 `ctx.config` 与 `ctx.secrets` 由 `nbook.settings` 提供、SDK 提供作用域定时器与异步包装、WebAssembly 不强制切分）；[ADR 0022](../../adr/0022-extensible-platform-and-plugin-trust.md) 第 3 条；跨插件调用一律返回结构化结果、跨插件接口的三类划分、宿主错误码、worker 池上限与结算时限、密钥不可解密时的行为由 [t28](../../../.agents/works/w00017-application-runtime-architecture/tasks/t28-platform-planned-specs/README.md) 选定，开发者 2026-09-30 确认（worker 池原型的实测见 [G2 报告](../../../.agents/works/w00017-application-runtime-architecture/tasks/t27-platform-risk-gates/evidences/g2/REPORT.md)）；2026-10-06 开发者撤回 `ctx.commands` 与错误码 `command-not-found`，命令改由内置插件 `nbook.commands` 提供（[t49](../../../.agents/works/w00017-application-runtime-architecture/tasks/t49-commands-quick-open/README.md)）；`ctx.storage` 2026-10-07 起由 `nbook.storage` 取代（[t55](../../../.agents/works/w00017-application-runtime-architecture/tasks/t55-plugin-storage/README.md)）；插件状态用 `defineStore` 由开发者 2026-10-08 确认（[t56 实施计划](../../../.agents/works/w00017-application-runtime-architecture/tasks/t56-plugin-state/plan.md)）。
