# 共享合同规范

适用：新应用插件的 `shared/**` 合同与 `src/manifest.ts`。同时读取 [`common.md`](common.md) 与 [`languages/typescript.md`](languages/typescript.md)。

- 共享层只承载跨边界 DTO、schema、纯策略和稳定协议；不依赖页面组件、HTTP 请求对象、宿主实现或具体数据库 client；合同 schema 用 TypeBox 描述（[ADR 0023](../../adr/0023-v2-frontend-backend-stack.md)）。
- DTO 与运行期 schema 同源或由合同测试证明一致；版本字段、枚举、缺失语义和失败形态必须明确。
- 导出通过所属模块公开入口；消费者不能依赖未导出的内部文件。合同变更一次性迁移全部调用方，不维持两个可独立演进的模型。
- 数据结构保持可序列化、确定性和宿主无关。跨进程或持久化值不得携带 class instance、函数、平台 handle 或隐式全局状态。
- 测试覆盖序列化往返、合法边界、拒绝路径、版本兼容和每个宿主的实际消费入口。

完成标准：共享模块没有宿主反向依赖，schema 与类型一致，所有消费者完成切换，跨边界往返和拒绝行为有合同测试。