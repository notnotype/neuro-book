---
schema: nbook.adr/v1
status: accepted
decided: 2026-10-08
superseded-by: null
---

# ADR 0026：插件定义是常量，宿主的东西走宿主能力服务

- 日期：2026-10-08
- 决策者：开发者
- 关联工作：[w00017](../../.agents/works/w00017-application-runtime-architecture/README.md)
- 相关文档：[`runtime.plugins`](../specs/runtime/plugins.md)、[`runtime.plugin-manifest`](../specs/runtime/plugin-manifest.md)、[`runtime.application`](../specs/runtime/application.md)、[ADR 0025](0025-service-keys-by-id.md)
- 取代：[ADR 0025](0025-service-keys-by-id.md)

## 背景

ADR 0025 让插件入口的工厂只收宿主给的配置。落地之后签名仍各不相同：时钟、库文件路径、整页导航、运行位置各自作为工厂参数传入，其余插件没有参数。开发者 2026-10-08 问这些参数的作用，同意统一。

工厂参数只有内置插件能用。以后的第三方插件由宿主按清单的 `entries.<id>.main` 装载代码、只调用激活函数（[`runtime.plugin-manifest`](../specs/runtime/plugin-manifest.md)、[`runtime.plugin-code-loading`](../specs/runtime/plugin-code-loading.md)），中间没有工厂可以传参。内置插件与第三方插件拿宿主的东西应该走同一条路，这条路已经有了：宿主在应用清单的 `capabilities` 里给出本地能力服务（[`runtime.application`](../specs/runtime/application.md)），插件在 `dependencies` 里声明。

## 决策

1. 服务键按服务 id 识别，同一个 id 定义两次是同一个键；依赖一个没有任何入口或宿主能力提供的 id，按 `missing-service` 受阻。（沿用 ADR 0025 第 1 条。）
2. 服务 id 只在提供方插件的 `shared/contracts.ts` 定义一次；别的插件在运行时只引用这个文件。（沿用 ADR 0025 第 2 条。）
3. 普通插件的定义是常量，没有工厂参数。插件要宿主的东西（状态根、项目目录、整页导航、时钟），就依赖宿主提供的能力服务；对别的插件的依赖同样写在 `dependencies` 里。代码按所在的一侧导出：后端一个、浏览器一个，两侧共用的放 `shared/`。
4. 一个插件在不同运行位置的入口可以提供同一个服务 id：服务属于实例，一个实例里仍只有一个提供者。同一运行位置的两个入口提供同一 id 仍被拒绝。
5. 例外只有宿主适配器：`nbook.diagnostics` 与 `nbook.http`。它们整体作为宿主的一部分装配，配置随工厂传入：
   - diagnostics 的存储与紧急出口在内核启动之前就要能记录，覆盖启动期与停止期的诊断；
   - http 的准入与监听结果参与宿主就绪判断和停机前的排空。
   新增例外要说明同样的启动或停机依赖；只凭“用到文件或端口”“按实例不变”不构成例外。

## 后果

- 宿主装配分两张表：普通插件的定义表只能放 `PluginDefinition` 常量，宿主适配器另成一张工厂表。普通插件能不能带参数由表的类型挡住，不做源码形状检查。
- 宿主多出两项能力：服务端的状态根、浏览器窗口的整页导航；项目目录沿用项目宿主已有的当前项目能力。
- `nbook.commands` 一份定义含服务端与浏览器两个入口，`nbook.storage` 的后端定义含服务端与项目两个入口，宿主不再按运行位置挑工厂。
- 同一 id 在两处定义成不同类型时编译器查不出来，仍由第 2 条的约定与边界测试约束（同 ADR 0025）。
- 不改变的：唯一提供者、重复提供隔离、调用方身份与委托的签发记录（仍按身份对象登记）。
