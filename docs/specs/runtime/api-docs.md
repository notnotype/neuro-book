---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: runtime.api-docs
owners:
  - nbook.http
  - nbook.api-docs
---

# 端点收集与 API 文档

## 目标与非目标

内核从全部插件的清单中收集 HTTP 端点声明，`nbook.http` 据此生成 OpenAPI 文档并用同一 schema 校验请求，`nbook.api-docs` 插件在界面中展示。端点声明是清单中的静态数据，未激活插件的端点也出现在文档中。

明确不承诺：

- 不为没有 schema 的现有 Nitro 文件路由补写 schema；迁移期只可以合并 Nitro 已生成的文档。
- 不提供在线调试以外的 API 管理功能（限流、密钥、计费）。
- 不对未登录用户公开文档。

## 术语与参与者

- **端点声明**：贡献点 `http.endpoints`（拥有者 `nbook.http`）的一项：方法名、输入与输出 schema、错误码与说明。由 SDK 构建预设从插件合同生成，作者不手写。
- **路由声明**：`http.routes` 贡献的方法、路径、鉴权方式与可选 schema（[`runtime.plugin-channel`](plugin-channel.md)）。
- **OpenAPI 文档**：由全部已登记端点与路由声明生成的 OpenAPI 3.1 JSON。

## 输入与前置条件

- 输入是有效插件集合中全部已登记插件的 `http.endpoints` 与 `http.routes` 声明（[`runtime.plugin-manifest`](plugin-manifest.md)）；受阻入口的声明同样收集。
- 导出与展示都要求已登录。

## 输出与可观察行为

1. **生成。** `GET /api/openapi.json` 返回当前有效插件集合的 OpenAPI 文档：只列显式对外的 HTTP 路由贡献，按声明的路径列出，未附 schema 的标注“无 schema”。插件之间的远程服务不生成 HTTP 端点（2026-10-07，[远程服务与 RPC 协议](plugin-channel.md)）；远程合同的列表由内核合同目录提供，是否在 `nbook.api-docs` 中展示随 K2 定。
2. **与校验同源。** `nbook.http` 校验请求所用的 schema 与文档中的 schema 来自同一份声明，二者不会不一致。
3. **未激活也可见。** 插件入口尚未激活时，其路由已在文档中；路由随入口激活可用。OpenAPI 文档只含静态声明，不含入口的运行状态；`nbook.api-docs` 视图另外读取插件状态，在受阻或失败入口的端点旁显示原因，并随状态变化刷新。
4. **随插件集合变化。** 插件安装、启用、禁用、卸载、升级后，下一次请求返回更新后的文档；`nbook.api-docs` 的界面随插件集合变化事件刷新。
5. **展示。** `nbook.api-docs` 提供一个视图：按插件浏览端点，查看输入、输出与错误码，并可以用当前登录会话发起调用。
6. **迁移期合并。** 开发模式下可以把 Nitro 为旧文件路由生成的文档合并进来，并标注来源“旧路由”；生产构建不依赖该合并。

## 状态与转换

本能力不引入持久状态。OpenAPI 文档是有效插件集合的纯函数，同一集合总是生成同一文档（端点按插件 id 与方法名排序），入口激活、失败或恢复不改变它；运行状态只出现在 `nbook.api-docs` 视图中。

## 副作用与数据

无副作用。生成结果可以在插件集合不变期间缓存，集合变化时失效。

## 失败与恢复

- 某个插件的端点声明无法转换为 OpenAPI（schema 不支持）：该端点在文档中标注“schema 无法表示”，其它端点照常；不影响请求校验。
- `nbook.api-docs` 未启用或受阻：`/api/openapi.json` 仍可用。

## 边界与兼容

- **owner**：`nbook.http`（收集、生成、校验）与 `nbook.api-docs`（展示）。内核只做通用的贡献收集。
- **安全**：文档与调试调用都经现有会话鉴权；调试调用与普通调用走同一入口，没有额外权限。
- **兼容**：`/api/openapi.json` 的存在与 OpenAPI 3.1 格式是公开接口；文档内容随插件集合变化，不承诺稳定。

## 验收与 Smoke

1. **未激活可见。** 启动后未使用 Files 时，文档已包含 Files 的合同端点；调用其中一个端点触发 Files 服务端入口激活。
2. **同源校验。** 文档中某端点输入 schema 要求字段 `path`，缺少该字段的调用返回 400。
3. **随集合变化。** 禁用示例插件后，文档中其端点消失；重新启用后出现。
4. **鉴权。** 未登录请求 `/api/openapi.json` 返回 401。
5. **展示。** 在 `nbook.api-docs` 视图中选中一个端点并发起调用，得到与直接调用一致的结果。
6. **运行状态只在视图中。** 插件集合不变、某个提供入口激活失败时，`/api/openapi.json` 内容不变，视图中依赖它的端点旁出现受阻原因。

Smoke：阶段 2 Files 竖切完成后，在真实服务端与 Chromium 上核对场景 1、2、5。

## 证据

- 批准目标：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P11“端点与 API 文档”与评审问题 2（2026-09-28 开发者批准：内核收集 SDK 端点声明生成 API 文档，并可由 API 文档插件展示）。
- 导出路径 `/api/openapi.json`、OpenAPI 3.1 版本与排序规则由 [w00017 t28](../../../.agents/works/w00017-application-runtime-architecture/tasks/t28-platform-planned-specs/README.md) 选定，2026-09-30 开发者确认；这些值尚无实现验证，实现中可按实测修订，修订时同步本文。
