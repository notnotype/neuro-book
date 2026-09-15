# Storage 底座与浏览器标题栏实施计划

- 状态：Spec 与治理已提交 `44710392`；服务核心已提交 `dfc5df82`；实现 goal active，切片 1 继续宿主身份增量
- Work：w00003-neurobook-ui-foundation-migration；文档 Task：[t21](tasks/t21-storage-design-review/README.md)；已完成核心 Task：[t22](tasks/t22-storage-core/README.md)；当前实现 Task：[t23](tasks/t23-storage-host-identity/README.md)
- 工作区：`.worktree/w00003-neurobook-ui-foundation-migration`；分支：`refactor/w00003-nb-ui-adoption`
- 2026-09-16：开发者同意补齐审查缺口，包含最小嵌套验证与必要原语修复；不提前迁移 World Engine 整页
- 随后开发者明确授权：Spec 与文档治理完成并单独提交后，直接进入 goal 模式实现本计划。

## 合同与交付顺序

行为真相源为 [storage.persistence](../../../docs/specs/storage/persistence.md)、
[ui.nested-grid](../../../docs/specs/ui/nested-grid.md) 与 [ui.workbench-shell](../../../docs/specs/ui/workbench-shell.md)。
职责见 [storage.boundaries](../../../docs/specs/storage/boundaries.md)，取舍见
[ADR 0021](../../../packages/neuro-book/docs/adr/0021-local-storage-persistence.md)，旧数据步骤见
[迁移合同](../../../packages/neuro-book/docs/migrations/storage-state.md)。本文件只安排实现与检查点。

顺序：接口与隔离读写 → 生命周期与磁盘集成 → 插件样例与嵌套 grid → 迁移及主工作台 → 浏览器标题栏 → 视图迁移清单。
以下是依赖已知的实施切片，未预建 Task 链；Leader 在上一切片证据闭合后创建下一 Task，由 tasker 实现、omp reviewer 独立复核。

## 切片 1：一个状态从宿主到磁盘再恢复

**结果：** 隔离测试宿主中的 user/local 小状态可条件保存、订阅并在后端重启后恢复；相同接口可由前端和后端消费。

- 在主应用 shared 边界定义有限 JSON、状态定义、记录快照、条件写结果、失效与订阅接口；仅确需跨包消费的合同进入 contracts。
  服务端核心与 HTTP adapter 分开，前端保持纯 adapter 与投影，避免公共服务依赖 Nuxt 页面或 Pinia。
- 状态定义登记 owner/key、scope/locality、schemaVersion、默认、校验、迁移与容量；同一键重复登记不兼容定义时拒绝启动该 owner。
  容量使用 storage.persistence 的默认值和硬上限；墓碑计入条数，备份独立登记容量，超限保留原数据。
- 磁盘 adapter 逐逻辑记录存文件，封装版本、schemaVersion、不可复用 revision、值/删除状态同文件提交。
  临时文件与目标同目录，唯一临时名；锁内读校验、比较 revision、写临时文件、原子替换，确认后发布事件。
  对 Windows 可恢复的占用错误做有界重试；异常不删除有效旧文件，临时文件按 owner 清理。
- 身份域由 data 内持久元数据建立，初始化受锁保护。用户取验证 session 的 ID，auth-off 使用独立本地主体。
  客户端凭证由宿主接口提供，不作为存储 API 的可自由改写字段；浏览器适配器须通过同源首次双标签、重开与清标识用例。
  浏览器载体是实现细节，必须支持仓库已有 HTTP/HTTPS 部署；无法保证稳定身份时明确降级为不可恢复，不能借共享桶兜底。
- user mutation 使用独立 Storage 文件锁，避免长期占用 Project 创建/删除的 workspace mutation 锁。
  quota 检查与 mutation 共同受 owner 分区锁保护，避免不同键并发绕过总容量；同键订阅快照与更新使用同一顺序边界。
  提供显式墓碑维护：同一锁内先持久化新分区代次使旧句柄及条件凭据失效，再回收选定墓碑；覆盖 quota 满和中断恢复。
  锁适配器沿用现有 Project 的心跳/过期协议，使用独立路径；验证崩溃残留、活动占用、有界等待与锁失效停写。

**验收：** 两主体、两身份域、两客户端隔离；CAS 与删除；读取分类、重启、超时未确认、磁盘满/替换失败；
两进程竞争 user 键只有一个旧 revision 写成功；不同键并发不能绕过分区 quota；回收释放容量且旧缺失凭据不可复活记录。
客户端用两个独立浏览器存储上下文，双标签并发用同一上下文；身份域使用独立后端根。服务核心测试不得依赖浏览器或 Vue。

## 切片 2：Project 生命周期与文件消费接线

**依赖：** 切片 1。

- 扩展 Project 控制面/presence 的上下文发布，让浏览器持有绑定精确服务端 ready 引用、运行期、主体与客户端的标识。
  禁止 Storage 请求只传 projectRoot 后重新取得当前 generation。句柄捕获目标，Project 重启、换用户/服务后重新初始化。
  descriptor 的 stateScope 只声明归属；修正现有 `resolveViewStateLayer` 按残留 projectRoot 推导访问的路径，由宿主有效上下文提供句柄。
- Project Storage 采用生命周期托管的 lazy handle，使用现有 `runReadyProjectOperation` 登记已接纳保存；
  不把所有状态文件解析变成 Project 打开的 required 门禁。普通离开释放本窗口资源；全局关闭/删除/根替换沿用 Project owner。
- user Storage 接入应用 shutdown，Project Storage 在 occupancy 释放前完成收口。
  有效目标的已接纳 mutation 可完成；锁失效/根替换/授权失效明确失败，不能用忽略 AbortSignal 强行写失效目录。
- 把 Storage 路径加入项目与 user-assets 的 scan/watch/history/普通文件 mutation 策略，受管资产同步和种子同样排除。
  复用归属明确的路径策略，不能把所有名字为 `storage` 的用户目录一律屏蔽。
- 项目 ZIP 强制保留 Storage 正式记录、删除标记、迁移原件；完整 data 备份保留 user 身份域信息。
  两者排除锁和临时文件；按单记录取得一致文件，明确无跨键/领域整体快照。

**验收：** A/B/用户资产切换、已接纳写排空、旧代次迟到、删除后同名新建、多标签 presence、root replacement；
用户资产树无 Storage、写入无内容事件；忽略 `.nbook` 的项目 ZIP 和整 data 备份实际解包验证。

## 切片 3：插件消费样例与最小嵌套 grid

**依赖：** 前两片；达到本检查点后才固定嵌套 grid 的新版快照格式。

- 提供无真实业务数据的内置测试插件：project/local 布局、project 对象记忆、user/local 偏好及 Project 内存选择。
  每工作台注入独立上下文；同一插件的两个 grid 用不同稳定资源标识，也验证两个窗口明确共享同一恢复地址的情况。
- 完成 `ui.nested-grid` 的两轴几何、叶/分支之间空间吸收与约束传播。
  用宽高模型区分分支外部分配和内部布局；修正现有分支总量只求和、兄弟补偿跳过分支的问题，不在宿主补像素例外。
- 扩展 nb-ui Splitter 的用户调整开始/更新/结束边界，复用 Reka 拖动事实并覆盖键盘连发、keyup、blur 与取消。
  WorkbenchBranch 转发主动改变字段，程序 layout 不触发保存；不用 autoSaveId。
- 快照校验在发布前完成，限制节点数量/深度，拒绝非法方向、重复身份和非有限尺寸；
  宿主保留原记录并合成已知修改，恢复使用当前约束。只把渲染树序列化回磁盘的做法不能通过审查。
- 在 Lab 提供静态确定性 fixture；另用隔离持久化适配器验证保存/重启/双标签，不让 Lab 操作真实产品存储。

**验收：** 外层左右/内层上下的总量与轴独立；主/插件同名叶不串记录；未知节点暂缺后再出现仍可恢复；
畸形快照无异常、拖动期间外来确认不重挂、键盘结束只提交一次；四主题组合与桌面/390×844。

**检查点 A：** omp 独立审查公共类型、身份、生命周期与插件消费；主 Agent 按测试和真实 fixture 复核。
没有第二消费者与嵌套证据，不开始大量主页面接线。World Engine 整页和任意跨分支移动继续单列。

## 切片 4：迁移与主工作台恢复闭环

**依赖：** 检查点 A。

- 实现迁移合同的启动门禁、临时浏览器原件暂存、data 备份与逐项进度。原件按原始字节保存，不要求损坏旧值先解析成功。
  原件暂存须早于旧持久化插件写入；暂存成功后仅冻结三个源字段，未迁字段继续保存，不受后端不可达影响。
  不可持久恢复的客户端不开始导入、不清源；完成标记独立于目标与墓碑保留。仅原件无法暂存时冻结整桶并明确提示。
- 在工作台宿主建立已确认值、当前显示和本地意图；以 Project ready 或显式 user 工作面选择句柄。
  初始读取完成才开放持久化提交；订阅只更新确认基线，不将另一个标签的几何直接应用到当前窗口。
- 同一批次处理 `WorkbenchShell`、主页面旧 resize 回调与样式读取，以及书架显示模式入口。
  迁移字段退出旧 `novel.ide.local` writer；旧消费者最多读新 authority 的投影，所有写都经宿主提交。
- 正常切换收口旧目标队列，失败提供重试/放弃；Project 删除与断线不能延迟使用旧上下文。
  将错误与原工作面绑定，不让迟到失败在新项目显示错误的“未保存”状态。

**验收：** 两项目分别记忆尺寸，用户资产/书架独立；窄视口夹取不改变保存值；
同项目两标签并发分别改左右栏不丢另一字段，二次冲突可见；所有旧入口操作后刷新两次仍只有一个 writer；
迁移中断/重试、目标已有值/墓碑/高版本、旧桶其他字段保留。

## 切片 5：浏览器标题栏与真实主页面

**依赖：** 切片 4。

- 解除主页面与 DesktopTitleBar 的 bridge 可见性限制，保留受控 Chrome 零件与宿主分工。
  应用动作注入宿主回调；桌面 bridge 保留窗口/系统能力。沿用既有菜单动作类型，不建立命令 registry 或 Ctrl+P。
- 以宿主能力映射生成菜单 enabled/visible；未接入的演示占位不算可用能力。
  浏览器隐藏退出应用、窗口控制及桌面缩放；编辑动作以真实焦点/编辑器能力判断，不能把 studio undo 冒充所有输入框 undo。
- 项目列表提供本标签打开与新标签打开。前者走原有未保存领域内容守卫和 Storage 收口；
  后者生成标准 Project URL，在用户点击时打开，当前标签与未保存内容不变；新标签独立执行 open/presence。
- 菜单使用 nb-ui 现有 portal 能力，消除祖先裁剪；同时处理 outside、Escape、方向键、焦点归还与紧凑菜单。
  标题栏高度由 TS 产品几何常量提供 CSS 变量，包含窄屏叶包装，不新增主题几何 token。
  搜索入口保持未实现，不显示已经可搜索的假状态。

**验收：** 无 bridge 的主页面显示可用标题栏；本页/新页项目打开、书架、设置及实际可用动作闭环；
四组合、桌面与390×844、长项目名、菜单不裁剪、键盘/焦点、Storage失败仍可理解。
桌面仅做既有窗口与桥接回归，不声称桌面多窗口已实现。

**检查点 B：** 主页面浏览器真实验收，独立审查后逐 capability 核对成熟度。
Storage 或标题栏局部完成不能将整个 `ui.workbench-shell` 晋升 implemented；其余入口等价和迁移门禁仍需证据。

## 切片 6：后续视图迁移清单

**依赖：** 标题栏真实接入完成后再调查，避免按过时 UI 推测优先级。

从源码调用、组件同名文档、Lab fixture、主页面入口与真实运行证据核对：文件树/工具面板、Markdown Studio、
Agent 列表与 Chat Flow、World Engine、Plot、角色、设置、历史和相关弹窗。
每项记录：owner、未重构/Lab-ready待接入/部分接入/已闭环、依赖、状态归属、真实功能缺口、独立切片与旧实现删除条件。
按依赖、组件成熟度和真实功能恢复价值排序。命令系统设计、桌面多窗口分别列任务，不混入视图搬迁。

## 验证与交接

- 文档：`bun run docs:check`、本地链接、跨文档语义和 `git diff --check`；当前 Task 不运行无关业务全量测试。
- 实现：按包 `package.json` 运行受影响聚焦测试与 typecheck；nb-ui 自身测试/build、Component Lab smoke 与 Product 排除门禁保持绿色。
  主应用采用 `bun run --cwd packages/neuro-book test <目标>` 与 `bun run --cwd packages/neuro-book typecheck`。
- 真实浏览器验收分别覆盖 Lab 和主页面；记录主题、视口、交互、控制台与失败恢复，不能用 bridge 桩代替真实桌面回归。
- 原红分支保留原始错误与来源；新失败必须定位，不能统一归为“主页尚未接入”。
- 每片记录实际文件、命令、结果和未运行项，优先 omp 独立复核；保护现有 dirty 文件，只提交授权 Task 范围。
  文档修订与验证后先单独本地提交，再创建 goal 和实际 Task 开始实现；不 push、创建 PR 或改变远端状态。
  迁移实现和验证使用隔离 fixture，不以实现授权执行真实用户数据恢复或破坏性迁移。
