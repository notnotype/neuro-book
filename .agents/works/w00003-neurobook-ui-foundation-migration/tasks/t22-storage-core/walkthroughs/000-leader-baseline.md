# 实现前基线与后续宿主接线取证

## 已运行

- 2026-09-16，文档基线 `44710392`，role=leader；t22 通过外部 omp Tasker 执行。
- `bun run --cwd packages/neuro-book typecheck`：退出 0。
- 完整输出在系统 Temp 的 `neuro-book/acceptance/storage-t22-dd257ac8/baseline-typecheck.txt`；日志不是产品数据。
- 本次基线运行开始时尚无 shared/storage 或 server/storage 代码，不能用该结果验证随后新增代码。
- `descriptors.ts` 与对应测试为先前未提交变更，本次文档提交未包含，t22 不修改。

## 源码已确认的接线位置

以下是从代码推断的实现入口，不是新能力已运行证据。

| 边界 | 当前事实 | 后续接线条件 |
|---|---|---|
| 浏览器 Project ready | `app/composables/useProjectSession.ts` 的 ProjectSessionReady 只有路径和本地 revision；presence DTO 只有路径 | 从服务端精确 ready 引用签发上下文，不能把本地编号或新请求按路径查到的当前代次充当原代次 |
| 服务端 open/presence | `server/api/projects/open.post.ts` 返回 publication；presence 路由先 send 再 push，避免首帧背压死锁 | 保持 publication 与 presence 合同；上下文签发绑定主体、客户端、运行期及 ready，并在断开/撤销时释放 |
| Project 数据面 | `ProjectSessionService.runReadyProjectOperation` 同时检查运行态、entry.ready 对象身份与 terminal gate；lazy module 可从已捕获 ready 激活 | Storage 操作完整 Promise 纳入该 owner，关闭前排空；不得忽略 root replacement/锁失效 |
| 退出 | `server/runtime/shutdown/product-shutdown.ts` 已有顺序关闭 controller | 加入 user Storage 关门与排空，Project Storage 在 occupancy 释放前关闭 |
| Project 路径消费 | `project-workspace-path-policy.ts` 区分 file-index/history/archive，已有 recovery preserve 与 runtime ignore | 为 Storage 加准确路径类别；用户真实名为 storage 的普通目录仍可访问 |
| ZIP | `workspace-archive.ts` 对被忽略的 `.nbook` 下保留目录继续遍历；文件使用延迟读取 addFile | 保留正式 Storage 文件和墓碑、排除锁/临时项；需要读取稳定完整记录，不能依赖延迟文件读取自然形成快照 |
| 普通文件权限 | `authorized-file-operation.ts` 已有 Project 精确代次和真实路径 containment | 新增内部 Storage 写入保留边界，同时检查产品普通文件 API，不能只隐藏树节点 |
| 资产安装 | `system-asset-installation.ts` 的 managed roots 是 agent/reference | 验证不会把同级 Storage 纳入安装/清理，避免无必要地扩大 managed roots |
| 鉴权 | `server/utils/auth.ts` 的 getCurrentUser 校验 User 状态和 sessionVersion；HTTP/HTTPS cookie 配置已有协议分支 | Storage 复用鉴权主体；长连接需持续处理权限撤销，客户端标识不代替用户身份 |

## 尚未选择的等价实现细节

浏览器首次双标签收敛需要真正的跨标签互斥；普通 localStorage 的 get/set 多步操作和单次 Set-Cookie 响应都不能单独证明收敛。
后续评估可在已有 HTTP 部署使用的 IndexedDB 事务式初始化；此处只记调查方向，不提前冻结 API 或引入新状态 scope。
服务端核心完成后再确定实际宿主增量与测试，不能根据本文件预称切片 1 或 2 完成。
