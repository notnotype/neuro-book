# ADR 0010：桌面存储、loopback 与关闭生命周期

- 状态：Accepted
- 日期：2026-07-29
- 更新：2026-08-05（Installation Mutation、Windows 自卸载、Candidate 验收、Session Store lease 失效关闭与 Desktop Envelope root 边界）
- 关联任务：[Task 130](../tasks/130-desktop-application-foundation/README.md)、[Task 105](../tasks/105-unified-installation-manager/README.md)、[Task 117](../tasks/117-windows-process-tree-lifecycle/README.md)、[ADR 0002](0002-bounded-rebuildable-runtime-artifacts.md)
- 取代范围：[ADR 0006](0006-image-variant-and-original-ownership.md) 中 Image Variant Cache 的物理 locator 由本 ADR 的 Cache Root 决定；其 512 MiB、10000 项等领域预算不变。

## 背景

桌面应用拥有安装、启动、窗口关闭、更新、重置和卸载的完整生命周期。只区分 Application Root 与 State Root 会把用户真相源、可重建缓存、WebView 本地状态和程序文件混在一起；Portable 又必须在整目录移动后保持 locator 有效。

Windows 不能依赖 JavaScript `SIGTERM` handler 完成应用级关闭。Owned Process 能在超时后收口进程树，但它不知道 HTTP drain、Agent、Session、SQLite 和日志的领域顺序。Desktop Product 还必须避免监听局域网，并需要一次启动一次有效的本地控制凭据。

## 决策

### 物理 root

Installed Windows 固定为：

```text
Installation Root  = %LOCALAPPDATA%\Programs\NeuroBook
State Root         = %LOCALAPPDATA%\NeuroBook\data
Cache Root         = %LOCALAPPDATA%\NeuroBook\cache
Desktop Local Root = %LOCALAPPDATA%\NeuroBook\desktop
WebView Root       = %LOCALAPPDATA%\NeuroBook\desktop\webview
```

Portable 固定为：

```text
State Root         = <Installation Root>/data
Cache Root         = <Installation Root>/.cache
Desktop Local Root = <Installation Root>/data/.desktop
WebView Root       = <Installation Root>/data/.desktop/webview
```

1. Installation manifest 保存有类型的 `{base: "installation-root" | "local-app-data", path}` locator，不保存不可迁移的绝对路径。相对路径必须是非空子路径，拒绝绝对路径、`.`、空 segment 和 `..`。
2. Product `RuntimePaths` 只消费 Application、State、Cache 三个 root。Desktop Local/WebView locator 由 Manager 和未来 Desktop Envelope 拥有，不暴露给 Product 领域代码。
3. `NEURO_BOOK_CACHE_ROOT` 是 Product Cache Root Adapter。未显式设置时仅为 Source dev/隔离测试回退到 `State Root/cache`；受管启动总是由 Manager 注入明确值。
4. 不覆盖 `HOME` 或 `USERPROFILE`。
5. Manager、容器和独立 Product 启动器共用同一个环境 Adapter。继承环境先合入、State Root `.env` 可覆盖普通应用配置，最后由 Adapter 固定 Application/State/Cache Root、`State Root/logs`、llmlint state/cache、Bun install cache 和受管监听地址；用户配置不能把这些 owner 重定向到未声明路径。

### 数据 owner 与回收

| 路径 | Owner 与合同 |
| --- | --- |
| `State Root/workspace`、`config.yaml`、`.env`、`secrets` | 用户真相源；更新永不覆盖，备份按各领域合同处理 |
| `State Root/logs` | 运行证据，不进入内容备份；最多 8 个文件、80 MiB、30 天，首次写入即回收；下载包 manifest 只记录逻辑文件名和运行时版本，不记录绝对日志目录或 `cwd` |
| `State Root/tool-state/llmlint` | 内嵌 llmlint durable settings；通过 `LLMLINT_HOME` 隔离，不读取或迁移用户独立 `~/.llmlint` |
| `Cache Root/llmlint` | llmlint detect cache；1000 项、128 MiB、30 天，通过 `LLMLINT_CACHE_DIR` 注入 |
| `Cache Root/image-variants` | 可删除、可重建；继承 ADR 0006 的 512 MiB、10000 项、每 source 32 项预算；旧 State Root 副本删除 |
| `Cache Root/bun/install` | 托管 Bun 的专属 install cache；通过 `BUN_INSTALL_CACHE_DIR` 隔离 |
| `Cache Root/authoring/<kind>/<lease>` | Profile preview、Profile variable typecheck、Profile/Variable authoring check 的短期工作目录；带 owner marker 与活跃锁，正常完成或初始化失败都立即删除；24 小时失活回收；创建前以 128 个 lease / 256 MiB 做准入，准备完成后在消费前复核，超限时关闭当前 lease 并拒绝消费 |
| `Cache Root/agent/bash-output/<lease>` | 带 owner marker 的逻辑 locator；7 天、128 个文件、256 MiB，每次最多 16 MiB；过期读取明确返回“已回收” |
| `Workspace Root/.nbook/agent/composer-drafts.json` | Agent Draft Store；单条 256 KiB、最多 10 条、30 天，发送成功删除；首次加载迁移旧 WebView 草稿 |
| Skill root 内 `node_modules` | 对应 Skill owner；按 Task 120 合同失效，内容备份排除 |
| Desktop Local/WebView Root | 设备本地 UI state；更新保留、内容备份排除，仅显式 desktop reset 或卸载删除 |

Bun cache 的递归硬预算不在普通 Product 启动时执行。当前没有受管 `bun install` 消费者；未来 Developer Build 安装命令必须在 install 完成后执行预算检查与超限清空，并在引入该命令的同一任务中锁定数值。为了一个尚不存在的命令在每次启动扫描整个 cache 不构成有效生命周期实现。

Authoring Cache 的 128 个 lease / 256 MiB 是创建前与消费前的离散门禁，不是操作系统级实时磁盘配额。活跃 lease 写入期间可能短暂超过门禁；写入停止后必须在任何消费者读取前复核 owner 总量，超限的当前 lease 会被关闭，内容不能进入运行时消费。

### loopback 与关闭

1. Desktop Product 强制设置 `HOST=NITRO_HOST=127.0.0.1`。Boot Config 中的外部监听值不能覆盖 Desktop 启动 Adapter。
2. Manager 每次原生 Product 启动生成 256-bit 随机 token，只通过进程环境传递，不写入 manifest、State Root 或日志。
3. shutdown endpoint 只接受 loopback 请求和 Bearer token，使用常量时间比较；错误 token 返回 401，非 loopback 返回 403，不泄漏内部关闭状态。
4. Nitro signal close 与认证控制请求共享一个进程级、幂等的 shutdown Promise。控制请求先返回 202，再异步关闭并退出；响应 `finish` 或客户端提前断连产生的 `close` 都只能触发一次退出请求。
5. 关闭顺序固定为：进入 draining 并拒绝新业务请求；等待在途 HTTP lease；停止 Agent 新任务并关闭 harness；关闭全部 Project、Workspace File Index 和 Session Store；App SQLite checkpoint；Prisma disconnect 并清除单例；flush 应用日志。
6. 每一步失败都继续执行后续步骤，最后返回带步骤身份的 `AggregateError`。并发关闭共享同一个结果。
7. Manager 最多等待合同规定的 30 秒。只有退出码为 0 且没有 signal 才算 graceful；HTTP 失败、超时、非零退出、signal 或 Product crash 时调用 Owned Process 收口完整进程树，并明确记录 forced shutdown。
8. Windows 不依赖 `SIGTERM`；POSIX Ctrl+C/SIGTERM 继续进入同一个 Nitro close hook 和 shutdown controller。
9. Session Store runtime lease 的 heartbeat 失效或所有权被其他进程接管时，`proper-lockfile` 的 `ECOMPROMISED` 通过一次性 typed signal 进入同一 shutdown controller：立即 draining、记录完整诊断、按既有顺序关闭，并以退出码 75 结束。旧 owner 不自动抢锁、杀进程或删除 `.lock`；Manager 根据退出码提示用户关闭其他 NeuroBook/迁移程序或处理长时间暂停后重试。旧 HMR registry 无法恢复历史 callback 时必须 fail closed，保留失效终态并要求重启，不得重新取得同一 runtime lease。

#### Source Dev 入口

1. 公开 `bun run dev` 必须进入 Source Dev launcher，由 `Owned Process` 在任何 Nuxt、生成器或迁移检查后代启动前建立完整进程树所有权。原开发准备链只作为内部 `dev:runtime` 存在；只有已经持有外层 owner 的 Manager Source Dev Adapter 可以直接调用它。
2. launcher 与 Manager 复用同一 `shutdownNativeProduct()`：首次 Ctrl+C/SIGTERM 请求认证 loopback shutdown，第二次信号立即强制收口；graceful 与 force 同时失败必须聚合报告。launcher 自身异常退出时由监督 IPC 断连收口后代树。
3. Source Dev 未显式声明监听 host 时固定使用 `127.0.0.1`。显式 `localhost` 或 IPv6 loopback 时，shutdown client 必须请求同一 loopback 地址；不得因地址族不一致把正常数据 flush 静默降级为强杀。
4. Agent Session Store 的 `runtime.lease` owner metadata 只用于竞争错误诊断。互斥、15 秒 heartbeat、30 秒 stale 接管仍由 `proper-lockfile` 决定；禁止按 metadata PID 自动杀进程、提前抢锁或删除 `.lock`。普通 `ELOCKED` 表示获取时已有 owner；`ECOMPROMISED` 表示当前 owner 已失去所有权，两者都不得被解释为普通正文文件占用。

### Secret 传递

1. 管理员自动创建的密码只能通过 `create-admin --password-stdin` 的 stdin pipe 传入；Manager、Release smoke 与容器编排不得把明文放入 argv、子进程环境或日志。
2. Manager 读取自身 `AUTH_ADMIN_PASSWORD` 后必须从子进程环境删除该键，再写入原始 UTF-8 bytes 并关闭 stdin。输入不 trim，最大 4096 bytes；交互调用继续使用 TTY 隐藏输入。

### Installation Mutation

1. install、update、start、migration、admin、desktop reset 与 uninstall 的物理修改都必须进入同一个 `InstallationMutation` 边界。边界在锁内先恢复未完成 Operation，再重读磁盘 Manifest；调用前读到的 Manifest 只能定位 Installation Root，不能参与后续执行判断。
2. lease 使用 `proper-lockfile` heartbeat，`stale=60s`、`update=20s`。Installed v1 固定使用用户级 `installed-v1` lease；Portable/Source 对 canonical Installation Root 做 SHA-256。lease 位于 `%LOCALAPPDATA%\NeuroBook\manager-leases`，不随卸载删除，也不受 Manager 配置文件位置影响。
3. Windows Installed v1 只允许 `%LOCALAPPDATA%\Programs\NeuroBook`。同一用户不支持多个 Installed 实例；多实例需求由 Portable/Source Profile 承担。
4. ZIP/Gzip 解压必须使用异步 API，避免长时间阻塞事件循环导致仍活跃的 lease owner 被误判 stale。业务失败与 lease release 失败都必须保留在 `AggregateError` 中。
5. Native、Container 与 Source Dev 执行使用显式判别联合。Native 在 spawn 前验证完整 Runtime Image、Bun 与工具；Container 验证 Compose、OCI digest、Engine image/container identity、版本与健康；Source Dev 使用明确 Adapter，不猜测 Product identity。

### 卸载与重置

1. 默认卸载删除 Installation Root、Cache Root、Desktop Local/WebView Root 和 State Root 内有界日志，保留 State Root 用户数据。
2. Portable 的 State Root 位于 Installation Root 内，默认卸载只保留承载 `data` 的目录链；显式“同时删除数据”才删除整个目录。
3. desktop reset 只删除 Desktop Local Root；WebView Root 是其子目录。
4. 卸载和 desktop reset 必须在对应 Installation Root 的外置 lease 内完成 Operation 恢复、Manifest 重读、execution identity 验证和 stop gate，再开始 owner 删除；底层删除 API 不接受绕过该顺序的调用。原生实例仍运行时拒绝卸载，容器先 stop/down。外部 Project Workspace 永远不属于卸载器。
5. Windows 由 Installation Root 内的受管 Bun 执行卸载时，不在当前进程递归删除自身。Manager 先写入带随机 token、owner roots、`deleteData` 决定和 SHA-256 的 durable intent，再启动 Installation Root 外的 PowerShell Host；Host 等待精确父 PID 退出，重新校验 intent 与固定 owner 布局后删除，并把结果写到外置 result 文件。
6. pending uninstall intent 阻止所有非卸载 mutation。重试只能继续完全相同的删除范围；intent、token、摘要或 owner root 被修改时零删除。Host 脚本保持 ASCII，以兼容 Windows PowerShell 5 的无 BOM 脚本解析。

## 原因

四类 root 对应四种不同恢复语义：程序可重装，用户状态必须保留，cache 可重建，WebView profile 是设备本地混合状态。typed locator 让 Portable 可以移动，也让卸载器只删除 manifest 声明的 owner。Portable 的 immutable Application/Product payload 与可写 State/Cache/Desktop owner 必须分开计量；运行后不能声称整个 Portable 根保持只读。

应用级关闭必须发生在进程级强制终止之前。认证 loopback 控制面给 Windows 一个可等待的正常关闭路径，Owned Process 保留最终兜底，两者职责不重叠。

Session Store lease 的 mtime heartbeat 是跨进程所有权协议，不是正文文件句柄锁。系统睡眠、事件循环长时间阻塞或其他 owner 接管都可能触发 `ECOMPROMISED`；继续写入会让两个 owner 同时操作同一份 Session Store，因此必须终止当前 Product，而不是通过重试或删除锁目录掩盖失效。

## 后果

- Installation Manifest 升级为 schema v5；Manager、Docker、Portable 脚本和运行环境统一解析四类 locator。
- Composer 草稿迁出后，WebView profile 才能被显式整体重置而不丢失未发送正文。
- Bash 完整输出不再持久化 `%TEMP%` 绝对路径；cache 被回收是正式可见状态。
- llmlint 的 sibling source 与 NeuroBook vendored snapshot 必须同步维护两个环境变量和缓存预算。
- Windows 仓库外 Product smoke 已证明错误 token 不结束进程、正确 token 完成应用级关闭，随后端口关闭且 State Root 可移动和删除；Owned Process 仍只保留超时后的最终兜底职责。
- Windows 自卸载有独立外置 Host，因此 Portable 可以删除正在承载 Manager/Bun 的程序目录；默认卸载和 `--delete-data` 必须分别通过最终 Portable Candidate 验收。
- Session Store runtime lease 失效现在会留下 fatal 诊断、执行有序关闭并以退出码 75 交给 Manager；用户不需要也不应该手动删除 `runtime.lease.lock`。
- Detached Container 的启动合同只负责发布 ready；其 ready 后的 Product 进程终态不进入 Manager 的 `null/null` ready-only completion，因此 Manager 不能从这条已脱离宿主的生命周期映射退出码 75。容器状态检查、下一次受管操作和日志仍是该边界外的诊断入口；这不改变 Native、Source Dev 和 Portable 前台路径必须传播具体退出码的合同。
- 浏览器与 Tauri/Electron UI 尚未验收；本 ADR 只冻结共享 Product/Manager 生命周期，不提前冻结 Desktop Envelope 框架。

## 未采用方案

- 把所有数据留在 Installation Root：Installed 更新、Portable 移动和卸载保留语义互相冲突。
- 把 WebView profile 当普通 cache 定期整目录删除：cookie、IndexedDB 和旧 Composer 草稿可能是有效状态。
- 用 Windows signal 代替控制通道：无法证明 JavaScript close handler、SQLite checkpoint 和日志 flush 已完成。
- 让 Owned Process 承担应用级 flush：进程 owner 不应依赖 Product 领域资源。
- 将用户独立 `~/.llmlint` 迁入 NeuroBook：会越过应用所有权边界。
