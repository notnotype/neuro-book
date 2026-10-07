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
| 入口 | 插件在某个运行位置的运行入口；每个入口分别装配与激活，拥有独立身份。 | [`runtime.plugins`](plugins.md#术语与参与者) |
| 激活代次 | 入口一次激活的身份；重新激活产生新代次，旧代次的句柄与门面一律失效。 | [`runtime.plugins`](plugins.md#术语与参与者) |
| 服务键 | 稳定标识一项能力合同的键；解析以“服务键 + 解析作用域”为单位。 | [`runtime.services`](services.md#术语与参与者) |
| 调用方身份 | 运行实例、运行位置、插件、入口、入口激活代次与客户端身份，委托时另附代理身份；只由内核填写，调用方不能改写。同一入口停止后再激活是另一个调用方。 | [`runtime.services`](services.md#术语与参与者)、[远程服务与 RPC 协议](plugin-channel.md#术语与参与者) |
| 门面（按调用方门面） | 提供者为每个调用方单独生成的服务对象；寿命跟随调用方的这次激活，作废后访问抛 `ServiceRevokedError`。 | [`runtime.services`](services.md#术语与参与者) |
| 委托 | 声明了代理能力的入口在处理调用方的请求时，以内核签发给它的调用方身份取得另一项服务的门面，或发出跨实例的远程调用；代理不能自报身份。 | [`runtime.services`](services.md#术语与参与者)、[`runtime.plugins`](plugins.md#术语与参与者) |
| 远程服务 | 插件之间跨运行实例的唯一通信方式：插件用合同声明方法与事件，内核负责路由、标记调用方、按需激活与结算。 | [远程服务与 RPC 协议](plugin-channel.md) |
