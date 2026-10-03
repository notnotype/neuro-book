# Tauri 与 Rust 桌面规范

适用：`desktop/tauri/**/*.rs`、`Cargo.toml`、`tauri.conf.json` 和 capability 配置。读取 [`../common.md`](../common.md)；本分支不需要 TypeScript 语言规范，除非同时修改 `desktop/tauri/frontend/**`。

- 遵循现有 Tauri、serde 和平台 `cfg` 组织。可恢复的文件、网络、IPC 和用户输入错误通过 `Result` 返回并保留上下文。
- `unsafe` 只包围无法避免的平台调用；在调用附近记录句柄有效性、所有权、线程和释放不变量。
- 进程、线程、channel、Windows handle 与临时资源必须有唯一 owner、超时和 Drop/关闭路径；避免无必要的 `clone`、字符串分配和大值跨线程复制。
- Tauri command、事件和注入 bridge 的 payload 使用 `desktop/shared` 与 `shared/` 定义的 schema；Rust 侧不复制独立产品模型。
- capability 和远端 URL 采用最小权限与显式 allowlist；外部内容不能形成任意 command、shell 或文件访问。
- 基本门禁：`cargo fmt --manifest-path desktop/tauri/Cargo.toml --check` 和 `cargo check --manifest-path desktop/tauri/Cargo.toml`。平台生命周期变化追加真实 Tauri 宿主验收。

完成标准：Rust 编译与格式门禁通过，所有 unsafe/handle/线程有可证明生命周期，Tauri bridge 与共享 schema 一致，目标平台的启动和关闭路径已实际验证。