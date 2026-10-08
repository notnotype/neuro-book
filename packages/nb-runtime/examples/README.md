# nb-runtime 示例插件

用最小的插件演示内核的典型用法。每个示例是一个可以直接运行的文件，配一个测试核对它演示的行为：

```text
bun packages/nb-runtime/examples/01-services.ts      # 运行一个示例，打印过程
bun run --cwd packages/nb-runtime test                # 连同示例的测试一起跑
```

| 示例 | 演示什么 | 行为合同 |
|---|---|---|
| [01-services](01-services.ts) | 插件提供共享服务、另一个插件依赖它；按依赖激活，停止时按依赖逆序释放；入口资源登记在作用域上 | [services](../../../docs/specs/runtime/services.md)、[plugins](../../../docs/specs/runtime/plugins.md)、[lifecycle](../../../docs/specs/runtime/lifecycle.md) |
| [02-per-consumer](02-per-consumer.ts) | 按调用方生成门面（`providePerConsumer`）：每个插件只看到自己的数据，门面随调用方释放 | [services](../../../docs/specs/runtime/services.md) 输出第 11–12 条 |
| [03-contribution-point](03-contribution-point.ts) | 拥有者定义贡献点并接收贡献；声明与实现分开，不合格的声明只拒绝那一条 | [plugins](../../../docs/specs/runtime/plugins.md) 输出第 15–18 条 |
| [04-remote-service](04-remote-service.ts) | 两个内核实例之间的远程服务：合同、首次调用时按需激活、调用方身份、订阅事件、输入校验 | [plugin-channel](../../../docs/specs/runtime/plugin-channel.md) |
| [05-delegating-proxy](05-delegating-proxy.ts) | 代理插件以调用方的身份转发到服务端（`remote.on`、`remoteDelegates`、代理允许清单），`nbook.storage` 的做法 | [services](../../../docs/specs/runtime/services.md) 输出第 13 条、[plugin-channel](../../../docs/specs/runtime/plugin-channel.md) 输出第 10 条 |

## 写法

- 只经包的公开入口（`@notnotype/nb-runtime/<机制>`）引用内核，和包外的插件一样；不深导入 `src/`。
- 一个示例只讲一件事，按编号由浅入深，后面的示例可以假定读过前面的。注释写这样做的原因与要遵守的约束，行为细节链接 Spec。
- 每个示例导出一个 `run…Example()`，返回能断言的结果；同名 `.test.ts` 只断言示例开头注释里说明的行为。测试与产品测试同样遵守 [测试写法](../../../docs/testing/README.md#测试写法)：真实内核实例，不用 mock、spy、假计时器与固定等待。
- 跨实例的示例用 `@notnotype/nb-runtime/remote/testing` 的进程内链路代替 WebSocket，帧照样经 JSON 编解码。

## 维护

内核的公开接口改动时，同一提交里更新受影响的示例；新增机制或出现新的典型用法时，补一个示例。示例的测试随 `bun run test` 运行，接口改了示例没跟上会直接失败。
