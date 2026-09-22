# 工作台 Storage 消费上下文实现

## 结果

- `packages/neuro-book/app/utils/workbench/storage-context.ts` 建立每工作台独立的 user / Project Storage 消费宿主。
- 切换操作在首次 `await` 前取得单调序号；A→B→用户资产或 A→B→C 时只有最后明确目标可发布，迟到 Project 返回不可用上下文。
- 同 scope/owner 在单工作台内复用句柄；公开借用句柄移除 `release()`，底层句柄、session 与 Project 内存生命周期归工作台。
- `release()` 先停止接纳并立即停止已有句柄，再并行等待 Project 与 user 的在途初始化、句柄排空和 session 关闭；任一侧失败不会跳过另一侧，重复 release 共同等待同一结果。
- 已借用 facade 在 Project 切换、AbortSignal 失效或工作台 release 的同步入口后拒绝新操作；此前已接纳动作仍由真实 owner adapter 排空，活动订阅停止。
- Project 选择内存支持同代次消费者订阅；切换、失效或释放后旧引用不可用，监听器清空。单个监听器异常不会中断其它消费者，已提交内存值保持有效。user 上下文跨 Project 保留，整个工作台释放时关闭。
- `packages/neuro-book/app/utils/workbench/storage-plugin-sample.ts` 提供未注册进产品全局 registry 的第二消费者：
  - `nbook.storage-sample/preference`：user/local 单例偏好；
  - `nbook.storage-sample/object-memory/<resource>`：project/local 对象记忆；
  - `selection`：Project 代次内存选择。
  对象存在性由样例 owner 回调验证；保存已知字段时由 owner 合入已确认投影并保留未来字段。相同 resource 共享恢复地址，但实例分别持有投影和生命周期。

## API 用法

1. 每个宿主调用 `createWorkbenchStorageContext()`，不要建立可变 singleton。
2. user 消费调用 `userOwner(owner)`；Project 消费必须先把 Project owner 发布的精确 ready 交给 `enterProject(ready, {invalidation})`。
3. 消费者使用返回句柄读写，不释放底层句柄；工作面切换调用 `enterProject` / `enterUserSurface`，应用关闭调用 `release()` 并展示其失败。
4. 两个视图通过 `project.memory.selection(owner)` 的 `get/set/subscribe` 共享同一 Project 代次内存；不要持久化焦点或选择。

## 验证

- `bun run test app/utils/workbench/storage-context.test.ts app/utils/workbench/storage-plugin-sample.test.ts app/utils/storage`
  - cwd：当前 worktree 的 `packages/neuro-book` 绝对路径。
  - 首次返工运行 exit 1：既有测试发现 `release()` 漏 return，修复后通过。
  - 新增真实 adapter 回归首次运行 exit 1：测试订阅退避参数非法，修正 fixture 后通过。
  - 最终运行 exit 0；6 个文件、94 个用例通过。
  - 新增覆盖 Project 清理失败仍收口 user、重复 release、已借用 facade 即时失效、真实 owner adapter 下迟到初始化与已接纳 save 排空、订阅停止、user facade 失效、监听器异常隔离、样例未知字段保留。

Leader 指定本轮不运行全包 typecheck/build；未运行 `git diff --check`。此前 89 用例通过记录已由本轮 94 用例取代。

## 文件

- `packages/neuro-book/app/utils/workbench/storage-context.ts`
- `packages/neuro-book/app/utils/workbench/storage-context.test.ts`
- `packages/neuro-book/app/utils/workbench/storage-plugin-sample.ts`
- `packages/neuro-book/app/utils/workbench/storage-plugin-sample.test.ts`
- `packages/neuro-book/app/utils/storage/README.md`
- 本记录

## 未运行与排除

- 未启动产品宿主、未访问 `3001`、未做浏览器人工验收：本 Task 无 UI，聚焦纯消费宿主和注入传输。
- 未运行全量主应用测试；已运行受影响 Storage 聚焦集。
- 未改并行 t37/t38 grid、Splitter、descriptor 文件；按 Leader 本轮裁定未重跑全包 typecheck/build。
- 未提交、push、创建 PR 或操作真实用户数据。
