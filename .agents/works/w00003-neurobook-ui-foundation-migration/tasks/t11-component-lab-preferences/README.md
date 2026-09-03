---
schema: nbook.task/v2
taskId: t11-component-lab-preferences
role: tasker
---

# 持久化 Component Lab 界面偏好

## 目标

让 Component Lab 在刷新或重新进入后恢复开发者选择的主题与常用画布配置，同时保持 fixture 的确定性和产品数据隔离。

## 范围

- 使用版本化 localStorage 文档保存主题、配色、桌面背景、画布背景、缩放、画布宽高与桌面侧栏开合偏好。
- 自定义壁纸 Blob 继续使用现有 Lab 专属 IndexedDB，不复制到 localStorage。
- 增加恢复默认配置入口；小型偏好与壁纸分别清理。
- 损坏、旧版本、未知枚举或越界值按字段拒绝并回退默认，不阻止 Lab 打开。
- 窄屏自动收起只改变当前布局，不覆盖桌面侧栏偏好。

## 非目标

- 不持久化当前组件、场景、fixture 数据、搜索词、检查器 tab、选中元素或事件日志。
- 不写产品用户配置、Project Workspace、Session、Provider/Model、业务数据库或真实接口。
- 不执行 Application State 数据库迁移来绕过开发服务门禁。

## 验收

- 偏好存储与编排测试覆盖 round-trip、字段校验、未知 schema、存储异常、恢复时序和响应式侧栏边界。
- 真实 `/lab` 修改偏好后刷新可恢复，恢复默认后 localStorage 偏好键消失且界面回到当前默认值。
- typecheck、scripts typecheck、docs check 与 diff check 通过。
- 若真实 `/lab` 仍被运行时状态门禁阻断，walkthrough 保持 blocked 并记录原始失败阶段。
