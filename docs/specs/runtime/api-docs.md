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

内核从全部插件的清单中收集显式对外的 HTTP 路由声明，`nbook.http` 据此生成 OpenAPI 文档并用同一 schema 校验请求，`nbook.api-docs` 插件在界面中展示。路由声明是清单中的静态数据，未激活插件的路由也出现在文档中。插件之间的远程服务不经 HTTP，不生成 HTTP 端点，也不进入 OpenAPI 文档（[ADR 0024](../../adr/0024-multi-instance-runtime-topology.md)）。

明确不承诺：

- 不为没有 schema 的现有 Nitro 文件路由补写 schema；迁移期只可以合并 Nitro 已生成的文档。
- 不提供在线调试以外的 API 管理功能（限流、密钥、计费）。
- 不对未登录用户公开文档。
- 不列出远程服务合同：内部合同由内核的合同目录发现；`nbook.api-docs` 是否另行展示合同目录，随该插件实现时另定。

## 术语与参与者

- **路由声明**：`http.routes` 贡献的方法、路径、鉴权方式与可选的输入、输出 schema（合同暂在 [`runtime.plugin-channel`](plugin-channel.md) 末节，随 `nbook.http` 相关 Spec 移出）。外部调用方使用的接口（webhook、OAuth 回调、脚本）都以路由声明给出。
- **OpenAPI 文档**：由全部已登记路由声明生成的 OpenAPI 3.1 JSON。

## 输入与前置条件

- 输入是有效插件集合中全部已登记插件的 `http.routes` 声明（[`runtime.plugin-manifest`](plugin-manifest.md)）；受阻入口的声明同样收集。
- 导出与展示都要求已登录。

## 输出与可观察行为

1. **生成。** `GET /api/openapi.json` 返回当前有效插件集合的 OpenAPI 文档：只列显式对外的 HTTP 路由贡献，按声明的路径列出，未附 schema 的标注“无 schema”。
2. **与校验同源。** `nbook.http` 校验请求所用的 schema 与文档中的 schema 来自同一份声明，二者不会不一致。
3. **未激活也可见。** 插件入口尚未激活时，其路由已在文档中；路由随入口激活可用。OpenAPI 文档只含静态声明，不含入口的运行状态；`nbook.api-docs` 视图另外读取插件状态，在受阻或失败入口的路由旁显示原因，并随状态变化刷新。
4. **随插件集合变化。** 插件安装、启用、禁用、卸载、升级后，下一次请求返回更新后的文档；`nbook.api-docs` 的界面随插件集合变化事件刷新。
5. **展示。** `nbook.api-docs` 提供一个视图：按插件浏览路由，查看输入、输出与错误码，并可以用当前登录会话发起调用。
6. **迁移期合并。** 开发模式下可以把 Nitro 为旧文件路由生成的文档合并进来，并标注来源“旧路由”；生产构建不依赖该合并。

## 状态与转换

本能力不引入持久状态。OpenAPI 文档是有效插件集合的纯函数，同一集合总是生成同一文档（路由按插件 id、路径与方法排序），入口激活、失败或恢复不改变它；运行状态只出现在 `nbook.api-docs` 视图中。

## 副作用与数据

无副作用。生成结果可以在插件集合不变期间缓存，集合变化时失效。

## 失败与恢复

- 某个插件的路由声明无法转换为 OpenAPI（schema 不支持）：该路由在文档中标注“schema 无法表示”，其它路由照常；不影响请求校验。
- `nbook.api-docs` 未启用或受阻：`/api/openapi.json` 仍可用。

## 边界与兼容

- **owner**：`nbook.http`（收集、生成、校验）与 `nbook.api-docs`（展示）。内核只做通用的贡献收集。
- **安全**：文档与调试调用都经现有会话鉴权；调试调用与普通调用走同一入口，没有额外权限。
- **兼容**：`/api/openapi.json` 的存在与 OpenAPI 3.1 格式是公开接口；文档内容随插件集合变化，不承诺稳定。

## 验收与 Smoke

1. **未激活可见。** 示例插件声明了一条对外路由、入口尚未激活时，文档已包含该路由；调用它触发入口激活。
2. **同源校验。** 文档中某路由的输入 schema 要求字段 `path`，缺少该字段的调用返回 400。
3. **随集合变化。** 禁用示例插件后，文档中其路由消失；重新启用后出现。远程服务合同不出现在文档中。
4. **鉴权。** 未登录请求 `/api/openapi.json` 返回 401。
5. **展示。** 在 `nbook.api-docs` 视图中选中一个路由并发起调用，得到与直接调用一致的结果。
6. **运行状态只在视图中。** 插件集合不变、某个提供入口激活失败时，`/api/openapi.json` 内容不变，视图中它的路由旁出现受阻原因。

Smoke：有第一个对外路由的插件后，在真实服务端与 Chromium 上核对场景 1、2、5。

## 证据

- 批准目标：[可扩展应用平台设计](../../proposals/extensible-application-platform.md) P11“端点与 API 文档”与评审问题 2（2026-09-28 开发者批准：内核收集 SDK 端点声明生成 API 文档，并可由 API 文档插件展示）。
- 2026-10-07 按 [多实例运行时拓扑](../../proposals/multi-instance-runtime-topology.md) 第 3 节（`accepted`）修订：只覆盖显式对外的 HTTP 路由，去掉由插件合同生成的 `http.endpoints` 端点（[w00017 t53](../../../.agents/works/w00017-application-runtime-architecture/tasks/t53-rpc-port-browser-connection/README.md)）。
- 导出路径 `/api/openapi.json`、OpenAPI 3.1 版本与排序规则由 [w00017 t28](../../../.agents/works/w00017-application-runtime-architecture/tasks/t28-platform-planned-specs/README.md) 选定，2026-09-30 开发者确认；这些值尚无实现验证，实现中可按实测修订，修订时同步本文。
