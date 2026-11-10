# @notnotype/nb-host

建在 nb-runtime 上的应用共用的两端宿主：只监听回环、`Host` 与 `Origin` 核对、状态根认领、内核 RPC 端口、启动与停止、诊断出口，以及浏览器一侧的连接与重连。应用只做装配，给出自己的名字、插件与配置。

- `./socket`：内核 RPC 端口的 WebSocket 链路（`createSocketLink`、`RPC_PATH`、`RPC_MAX_MESSAGE_BYTES`），服务端与浏览器共用。
- `./testing`：宿主测试用的工具。

不发 npm（`private`），只在本仓库的工作区里用。边界与验证见 [`AGENTS.md`](AGENTS.md)。
