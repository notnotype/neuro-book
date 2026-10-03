# Electron 桌面规范

适用：`desktop/electron/**`。同时读取 [`../common.md`](../common.md) 与 [`../languages/typescript.md`](../languages/typescript.md)。

- main、preload、renderer/startup 页面保持进程边界清晰；renderer 只通过窄 preload bridge 访问宿主能力，IPC channel 与 payload 使用共享合同验证。
- Manager、Product Runtime 和窗口各有唯一生命周期 owner。启动、重启、退出、单实例、进程树和异常清理必须覆盖 Windows 失败路径。
- 文件系统、shell、URL 和进程参数在主进程边界归一化并校验；renderer 内容不能直接形成命令、路径或任意 IPC 调用。
- `desktop/electron` 保持独立安装图和构建入口；宿主只消费打包产物与 `shared/`、`desktop/shared/` 合同，不导入 Nuxt 私有实现。
- 使用 `bun run --cwd desktop/electron typecheck` 检查类型；影响启动、窗口、IPC 或进程关闭时运行对应合同测试及实际宿主 smoke。

完成标准：renderer 无直接宿主权限，IPC 两端共享同一 schema，所有子进程和窗口有退出路径，独立 Electron typecheck 与受影响宿主场景通过。