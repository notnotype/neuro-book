# nb-runtime 示例插件

一组按生产格式写的示例插件，演示内核的典型用法，也可以当写新插件的样板。插件放在 `plugins/`，把它们装进运行实例、核对行为的场景放在 `scenarios/`。

```text
bun test packages/nb-runtime/examples                 # 只跑示例的场景
bun run --cwd packages/nb-runtime test                # 连同内核测试一起跑
```

## 插件

目录格式与应用包的内置插件相同（[`packages/neuro-book/AGENTS.md`](../../neuro-book/AGENTS.md) 的“目录约定”）：

```text
plugins/<插件>/
├── plugin.ts            # 插件描述 PluginDescriptor：id、版本、有入口的运行位置
├── shared/contracts.ts  # 两端共用、对其它插件公开的合同：服务接口与键、远程服务合同、贡献点
├── server/plugin.ts     # 服务端入口的工厂，返回 PluginDefinition
└── web/plugin.ts        # 浏览器入口的工厂
```

- 入口是工厂函数，宿主能力（例如时钟）与别的插件的服务键作为参数交进来：服务键按对象身份比较，插件之间只 `import type` 对方的合同。
- `web/` 与 `server/` 互不引用，只经 `shared/` 交换类型与 schema；`plugins/` 下的代码也过浏览器那份类型检查，不用 Bun 与 Node 的接口。
- 插件清单文件（`package.json`，[`runtime.plugin-manifest`](../../../docs/specs/runtime/plugin-manifest.md)）实现后，示例随之改成清单格式。

| 插件 | 运行位置 | 演示什么 |
|---|---|---|
| [clock](plugins/clock/) | server | 把宿主注入的时钟包成共享服务（`provide`）；不声明激活事件，有入口依赖它时才激活 |
| [greeter](plugins/greeter/) | server | 依赖另一个插件的服务：服务键由宿主交给工厂，激活前内核先解析依赖 |
| [notes](plugins/notes/) | server | 按调用方生成门面（`providePerConsumer`）：每个插件只看到自己的数据，门面随调用方释放 |
| [menu](plugins/menu/) | server | 定义贡献点：逐条校验声明、接收者维护表、每次执行经 `implementation()` 取实现 |
| [file-menu](plugins/file-menu/) | server | 向贡献点提交声明与实现，与拥有者之间没有服务依赖 |
| [counter](plugins/counter/) | server、browser | 一个插件两端之间的远程服务：合同、首次调用时按需激活、订阅；浏览器入口把它包成本地服务 |
| [cloud-notes](plugins/cloud-notes/) | server、browser | 浏览器入口以调用方身份代理（`remote.on`、`remoteDelegates`、代理允许清单），`nbook.storage` 的同款结构 |

## 场景

| 场景 | 用到的插件 | 行为合同 |
|---|---|---|
| [01-services](scenarios/01-services.test.ts) | clock、greeter | [services](../../../docs/specs/runtime/services.md)、[plugins](../../../docs/specs/runtime/plugins.md)、[application](../../../docs/specs/runtime/application.md) |
| [02-per-consumer](scenarios/02-per-consumer.test.ts) | notes | [services](../../../docs/specs/runtime/services.md) 输出第 11–12 条 |
| [03-contribution-point](scenarios/03-contribution-point.test.ts) | menu、file-menu | [plugins](../../../docs/specs/runtime/plugins.md) 输出第 15–18 条 |
| [04-remote-service](scenarios/04-remote-service.test.ts) | counter | [plugin-channel](../../../docs/specs/runtime/plugin-channel.md) |
| [05-delegating-proxy](scenarios/05-delegating-proxy.test.ts) | cloud-notes | [services](../../../docs/specs/runtime/services.md) 输出第 13 条、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md) 输出第 10 条 |

- [`hosts.ts`](scenarios/hosts.ts) 像应用包的宿主那样把插件装进运行实例；跨实例时服务端带路由，窗口经 `@notnotype/nb-runtime/remote/testing` 的进程内链路连上它（产品里是 WebSocket，帧同样经 JSON 编解码）。每个场景在 `afterEach` 里停止全部实例并核对正常关闭。
- [`probes.ts`](scenarios/probes.ts) 的探针站在“使用这些服务的插件”的位置上，把拿到的服务交给场景；产品里没有这样的插件。
- 场景遵守 [测试写法](../../../docs/testing/README.md#测试写法)：真实内核实例，不用 mock、spy、假计时器与固定等待，时间由注入的时钟推进。

## 写法与维护

- 示例只经包的公开入口（`@notnotype/nb-runtime/<机制>`）引用内核，和包外的插件一样，不深导入 `src/`。
- 注释写这样做的原因与要遵守的约束，行为细节链接 Spec；一个插件只演示一两件事。
- 内核的公开接口改动时，同一提交里更新受影响的示例；新增机制或出现新的典型用法时，补插件与场景。场景随 `bun run test` 运行，接口改了示例没跟上会直接失败。
