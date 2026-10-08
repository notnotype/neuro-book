---
schema: nbook.spec/v1
kind: glossary
status: implemented
capability: runtime.glossary
owners:
  - runtime
---

# 运行时术语表

运行时 Spec 共用的词。每个词以“出处”列的 Spec 为准，这里只用一两句帮助定位，成熟度跟随出处；各 Spec 只定义自己新引入的词，用到这里的词时链接本表。新词被第二份 Spec 用到时移入本表。

## 实例与位置

| 术语 | 含义 | 出处 |
|---|---|---|
| 运行位置 | 执行代码的宿主，由宿主以字符串声明（例如 `server`、`project`、`browser`、`tui`）；内核不列举运行位置。 | [`runtime.lifecycle`](lifecycle.md#术语与参与者) |
| 运行实例 | 某次启动的具体环境实例，拥有自己的作用域树，身份在存活期间固定；刷新、重启或再次启动产生新的运行实例。 | [`runtime.lifecycle`](lifecycle.md#术语与参与者)、[`runtime.application`](application.md#术语与参与者) |
| 子实例 | 父运行实例按键创建、停止并计数使用者的另一个运行实例，可以在另一个进程里；同一键的代次单调递增、不复用。 | [`runtime.application`](application.md#术语与参与者) |
| 租约 | 使用者对某个子实例代次的使用登记；最后一个租约释放后子实例进入宽限期。 | [`runtime.application`](application.md#术语与参与者)、[`runtime.projects`](projects.md#术语与参与者) |
| 项目实例、项目代次 | 项目实例是某个项目的一次运行，即以项目 id 为键的子实例的一个代次，运行在项目子进程里；项目代次指这个代次。 | [`runtime.projects`](projects.md#术语与参与者) |
| 客户端实例 | 浏览器窗口、TUI 这类只连服务端的运行实例（拓扑角色 `client`）。 | [远程服务与 RPC 协议](plugin-channel.md#术语与参与者) |
| 客户端的绑定 | 客户端实例一生绑定的那个项目代次（或不绑定），握手时由服务端决定，之后不变；绑定持有该代次的一份租约。与 [`runtime.services`](services.md#术语与参与者) 的“运行期绑定”不是一回事。 | [远程服务与 RPC 协议](plugin-channel.md#术语与参与者)、[`runtime.projects`](projects.md#术语与参与者) |
| 客户端身份 | 客户端实例跨重新加载稳定的标识，同一浏览器配置的窗口共用一个，与每次启动都换新的实例 id 区分；服务端与项目实例没有。 | [`runtime.browser-host`](browser-host.md#术语与参与者)、[`runtime.services`](services.md#术语与参与者) |

## 作用域与收口

| 术语 | 含义 | 出处 |
|---|---|---|
| 作用域 | 拥有运行资源的边界，也是资源登记与关闭发生的单位；创建它的参与者是唯一 owner。不建立跨运行实例的父子作用域。 | [`runtime.lifecycle`](lifecycle.md#术语与参与者) |
| 收口 | 失败或停止时释放本轮已登记资源并记录结果；不是回滚，不撤销已发生的对外副作用；收口未完成时作用域保持停止中。 | [`runtime.lifecycle`](lifecycle.md#术语与参与者) |
| 结算 | 一次在途操作或请求得到最终结果（成功、失败、取消，或随链路断开结束），只结算一次；结算后不再计入关闭门禁。 | [`runtime.lifecycle`](lifecycle.md#状态与转换)、[远程服务与 RPC 协议](plugin-channel.md) |

## 插件与服务

| 术语 | 含义 | 出处 |
|---|---|---|
| 插件 | 发布、安装、启用与版本的单位，一个目录；本身不运行，代码按运行位置分成入口。插件拥有它的入口、贡献点、激活事件前缀，以及以插件 id 为前缀的服务 id 与合同 id。插件和插件之间没有依赖关系。 | [`runtime.plugins`](plugins.md#术语与参与者)、[`runtime.plugin-manifest`](plugin-manifest.md#术语与参与者) |
| 入口 | 插件在某个运行位置的运行入口；激活、依赖与受阻都以入口为单位。每个运行实例只激活本位置的入口，每个实例里各有一份；同一位置可以有多个入口，各自激活、各自受阻。 | [`runtime.plugins`](plugins.md#术语与参与者) |
| 激活代次 | 入口一次激活的身份；重新激活产生新代次，旧代次的句柄与门面一律失效。 | [`runtime.plugins`](plugins.md#术语与参与者) |
| 激活事件 | 决定入口什么时候激活的信号：`onStartup`，或 `<前缀>:<参数>`，前缀归声明它的插件，内核保留 `onRemote`。不写激活事件的入口等到有人依赖它的服务、或调用它的远程服务时才激活。 | [`runtime.plugins`](plugins.md#术语与参与者) |
| 服务、服务键 | 服务是入口激活时交给**同一运行实例**里其它入口用的对象；服务键（服务 id，形如 `<插件 id>/<名>`）稳定标识它的合同。id 归插件命名，服务对象属于某个实例里某个入口的某一代，不跨实例。解析以“服务键 + 解析作用域”为单位。 | [`runtime.services`](services.md#术语与参与者) |
| 依赖 | **入口**声明的“我需要服务键为 S 的服务”，写在入口的 `dependencies` 里，只在入口所在的运行实例里由提供 S 的入口或宿主能力满足。必需依赖缺了，只有这个入口受阻；提供方先于它激活，停止前先停它。远程调用与贡献都不是依赖。 | [`runtime.services`](services.md#术语与参与者)、[`runtime.plugins`](plugins.md#输出与可观察行为) |
| 宿主能力 | 宿主（而不是插件）在应用清单的 `capabilities` 里给出的本地服务，例如状态根、整页导航、当前项目；插件像依赖普通服务一样在 `dependencies` 里声明。 | [`runtime.application`](application.md#实现合同) |
| 调用方身份 | 运行实例、运行位置、插件、入口、入口激活代次与客户端身份，委托时另附代理身份；只由内核填写，调用方不能改写。同一入口停止后再激活是另一个调用方。 | [`runtime.services`](services.md#术语与参与者)、[远程服务与 RPC 协议](plugin-channel.md#术语与参与者) |
| 门面（按调用方门面） | 提供者为每个调用方单独生成的服务对象；寿命跟随调用方的这次激活，作废后访问抛 `ServiceRevokedError`。 | [`runtime.services`](services.md#术语与参与者) |
| 委托 | 内置的代理插件在处理调用方的请求时，以内核签发给它的调用方身份发出远程调用，目标看到的是原调用方、另附代理身份；代理不能自报身份。例如 `nbook.storage` 的浏览器入口替窗口里的插件读写服务端的记录。 | [`runtime.services`](services.md#术语与参与者)、[远程服务与 RPC 协议](plugin-channel.md#输出与可观察行为) |
| 远程服务 | 插件之间跨运行实例的唯一通信方式：插件用合同声明方法与事件，内核负责路由、标记调用方、按需激活与结算。同一实例里的调用方也可以直接用合同。不是依赖：不使调用方受阻，调用时找不到提供方即失败。 | [远程服务与 RPC 协议](plugin-channel.md) |
| 贡献点、贡献 | 贡献点是拥有者插件定义的扩展点（命令、页面、公开状态键）；贡献是别的插件向它交的“声明 + 实现”，声明在入口激活前就在目录里。贡献方与拥有者之间没有依赖：拥有者不在时贡献等待。 | [`runtime.plugins`](plugins.md#术语与参与者) |
| 可选功能 | 插件的一部分功能要另一个插件在场才能用，对方不在时只有这部分不可用（原称“联动项”）。写法有单独的入口加依赖、可选依赖、贡献、远程调用与公开状态，见出处。 | [`runtime.plugin-api`](plugin-api.md#可选功能) |
