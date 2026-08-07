# Task 144 - Electron Desktop 启动与 Workbench UI 优化

## 目标

在不改变 Product、Manager、State Root、Cache Root 和 shutdown 所有权的前提下，改善 Electron 的启动感知速度和桌面工作区信息层级。

## 当前实现

- 主窗口启动后先加载 Envelope 自带的本地启动页，不再等待 Product ready 才创建窗口。
- 启动页显示固定阶段和恢复动作：重试、修复后重试、打开日志、退出。
- 正式页面仍必须通过 Manager Supervisor、动态端口、startup nonce 和 Desktop Bridge v2 验证。
- Dialog/ DialogWindow 使用紧凑 Full/XL 尺寸、暗色遮罩、无 blur 和统一 surface 标记。
- Agent 面板保持右侧可调整布局，小窗口改为覆盖式面板。
- Markdown Studio 欢迎页压缩为主操作、快速操作和最近文件三层，不再显示 Agent 模式入口或重复项目入口。

## 验证

- Electron bundle：通过。
- Desktop Contract：8 files / 31 tests passed。
- 根 typecheck：通过。
- 相关前端测试：3 files / 10 tests passed。
- 仓库外 Electron Headless：通过，Product migration、动态端口、graceful shutdown 均未回归。
- 真实 Electron CDP（既有 verified Product fixture）：
  - 启动页可见：599.60 ms；
  - Product ready：7,491.39 ms；
  - Desktop Bridge ready：7,700.73 ms；
  - 标题栏：y=0、height=35.9976 px；
  - 内容起点：y=35.9976 px；
  - File → Quit：进程与 CDP 端口收口。
- Source Dev Workbench browser smoke 已进入书架页并保存截图；在复用既有 Portable State Root 的 Project 页面等待 `Files` 解锁时超时，未把该次运行记为完整通过。原因和当前 Product/State fixture 不匹配有关，尚未用本轮 UI 修改后的 clean Product 重跑。

上述 CDP 运行使用既有 Product image `sha256:abeaf860cc54ef39a46861414ba31a4124ae902016842f3ba74ff64a6f3add2c`，不能替代本轮 UI 修改后的 clean Product Build A/B 或正式 Portable 基线。

## 未完成

- 本轮 UI 修改后的 clean Product Build A/B 和新 Electron Portable 组包。
- 使用隔离、当前合同匹配的 State Root 重跑完整 Workbench browser smoke。
- 五次冷启动与五次 warm start 的稳定统计。
- Agent Jobs/Session、WebSocket、Monaco、TipTap、剪贴板、下载和文件对话框的真实包验收。
- 签名安装器、updater、WebView2 分发和 Tauri 可见 UI。
