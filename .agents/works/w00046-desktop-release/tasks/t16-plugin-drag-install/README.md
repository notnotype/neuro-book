---
schema: nbook.task/v2
taskId: t16-plugin-drag-install
status: active
updated: 2026-11-16
---

# 拖拽安装插件

## 目标与范围

把插件的构建目录拖到插件页安装：上传到暂存区、预览、确认安装；修改 runtime/plugin-install

合同：[`runtime.plugin-install`](../../../../../docs/specs/runtime/plugin-install.md) 加第二种安装输入“上传的文件夹”与上传暂存区（条目级 planned）。计划见 [plan.md](plan.md)。

## 当前状态

2026-11-15 经 nbdev 新建。2026-11-16 写好计划，设计审查三轮（Opus）：第 1 轮 17 条、第 2 轮 14 条（r3 改成一个请求传整个文件夹）、第 3 轮 11 条仍有 2 条高级，都在 nb-host（Bun 请求体缺省上限 128 MiB；nb-host 转交请求会把整个请求体收进内存）。按 autonomous-delivery 停下等开发者，建议见 [design-review-r3-proposal](evidences/design-review-r3-proposal.md)；开发者 2026-11-17 同意。

## 实施进度（2026-11-17，分支 `feat/w00046-t16-plugin-drag-install`，worktree `.worktree/w00046-t16`）

| 切片 | 提交 | 内容 |
|---|---|---|
| 0 nb-host 转交改流式 | 076c94753 | `forwardedRequest` 显式传 `body`、`duplex: "half"`、`signal`；测试：160 MiB 量级的慢读上传内存增长（改前约 116 MiB，改后约 35 MiB）、流式读、中途断开 |
| 1 Spec | 1f8737fb2（master） | `runtime.plugin-install` 输出 11、上传接口、`upload-*` 失败码、场景 18（planned） |
| 2 共用分帧与路径规则 | 1b8649eea、01c6ac60e | `src/shared/plugin-upload.ts`（流式读取带背压、限额、路径规则、撞名检查） |
| 3 服务端 | 79f5dde6e | `uploads.ts` 暂存区、上传路由、合同 6（`inspect`、`install` 收 `path` 或 `upload`）、宿主能力；真实服务端冒烟（96 MiB 超限得 JSON 413，客户端只发出 70 的 93 块） |
| 4 页面 | d06df0394 | 插件页拖入与“选择文件夹”、`src/ui/dropped-folder.ts`（t15 复用）、上传客户端（XMLHttpRequest，有进度）、Lab 夹具、文档、10 条页面测试 |

与计划 r4 的出入：合同的输入是带可选 `path`、`upload` 的对象（远程合同要求输入是对象 schema，不能用联合），二者给一个，否则 `path-rejected`；上传进度按字节百分比显示（XHR 的上传进度），不是文件数；`src/shared/collected-folder.ts` 放文件夹的形状与限额（后端类型检查没有 DOM 库，浏览器入口模块也被它编译）。

| 5 e2e | e396e2b96（变基后提交号会变） | `plugins.e2e`：真实 Chrome、生产构建，“选择文件夹”传带 `node_modules` 的目录，预览写文件数、安装目录没有 `node_modules`、暂存目录清空、取消预览也清空；拖入单个文件与落在页面以外的提示 |
| 架构 | 5e1080339 | 上传分帧移到 `plugin-platform/shared`（`architecture.test` 规定通用插件管理不引用应用的代码） |

验证（2026-11-17，负载 4 到 6）：`bun run test:affected --since master` 的 bun 与 vitest 项通过（vitest 94 个文件 706 项），唯一失败是 `sdk.test.ts` 的两条（组件子路径漏列 DateInput 的类型），在最新 master 上同样失败（w00025 t10 的提交 d5eb7b6a3 引入），不是本分支；`plugins.e2e` 3 项通过。e2e 里原有的“其它分区没有示例插件的配置项”辅助函数在 master 上已经不对（Agent 的工具绑定归到了 Profile 分区，“其它”分区空了、导航被停用），改成分区停用时直接通过。

实现审查（2026-11-17）：页面 Sonnet 13 条（[处理](evidences/impl-review-r1-sonnet-disposition.txt)）；后端（nb-host、暂存区、路由、合同）omp 默认模型有效发现 10 条，中 5、低 5（[报告](evidences/impl-review-r1-omp.txt)、[处理](evidences/impl-review-r1-omp-disposition.txt)），都已修并补测试。收口验证：类型检查、相关 bun 测试、`plugins.e2e` 3 项通过，`test:affected --since master` 只有 master 上已有的 `sdk.test.ts` 两项失败。

## 下一步

已合入 master（不 push）。切片 6（Windows 拖放真机手测）等 pc-notype 能构建。
