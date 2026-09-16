# 工作台 Storage 核心本地收口

本Task按用户缩小后的核心范围交付工作台访问生命周期和第二消费者样例，不代表插件grid宿主、旧键迁移或主页面已接线。

Leader于2026-09-16 12:18在本worktree的packages/neuro-book绝对路径独立执行：
`bun run test app/utils/workbench/storage-context.test.ts app/utils/workbench/storage-plugin-sample.test.ts app/utils/storage`
退出码0，6文件94用例通过。
[t42最终复核](../../t42-storage-context-review/walkthroughs/review-final.md) 独立复跑一致，另有9个探针通过，未发现阻断。
Leader随后仅补充消费README的切换等待、target可用性区别及释放聚合错误说明，未更改被审源码。

同一工作台复用owner句柄，跨工作台隔离；Project切换同步拒绝旧引用新操作，已接纳操作和迟到初始化收口；Project清理失败仍释放user；样例保存保留未知字段，内存选择按Project代次共享并失效。
主应用正式typecheck留在t37几何消费者稳定后统一执行，最终结果由本Work的核心验证记录补充。本提交不声称全产品浏览器验收通过。
用户descriptors两文件SHA256未变，未暂存；本轮未访问3001或真实用户数据，无远端操作。
