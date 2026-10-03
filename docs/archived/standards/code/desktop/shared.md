# 桌面共享与打包规范

适用：`desktop/shared/**`、`desktop/packaging/**`。同时读取 [`../common.md`](../common.md) 与 [`../languages/typescript.md`](../languages/typescript.md)。

- `desktop/shared` 只承载 Electron、Tauri、Manager 和产品运行时共同消费的可序列化合同，不依赖任一宿主实现。
- `desktop/packaging` 以构建身份、闭包、文件模式、hash 和确定性目录树为合同；输入缺失或身份不匹配时明确失败。
- 路径处理覆盖 Windows 长路径、大小写、分隔符和 archive traversal；所有解包与复制目标先做 containment。
- 中间 staging 使用测试临时根；用户发布资产进入发布合同指定位置并记录 revision、image identity 与 SHA-256。
- 改动共享 DTO 后运行各桌面宿主合同；改动 packaging 后运行相应 tree digest、安全审计和 portable package 验证。

完成标准：共享合同无宿主依赖，打包结果身份可追溯且目录树确定，路径越界被拒绝，Electron 与 Tauri 消费方同步验证。