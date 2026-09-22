# t23 宿主身份交付复核

## 结果与边界

当前交付浏览器客户端身份、user 访问上下文签发/释放、逐请求核验与产品退出接线。
没有挂到主页面启动；值读写 HTTP、订阅、授权撤销后的实际句柄关闭、Project 和 UI 消费由下一增量继续。
这是切片 1 的前置增量，不把整个 storage.persistence 标成 implemented。

浏览器凭证使用 32 字节随机值，在同一个 IndexedDB readwrite 事务内读取/创建，事务完成才报告可恢复。
同源标签页共享凭证、独立访问标识；连接每次操作后关闭，删除数据库后同页面可恢复，迟到打开也有明确 owner。
HTTP 普通部署使用 getRandomValues，不依赖 secure-context-only API；无法持久化时明确不可恢复，不降级到公共桶。

宿主按已验证用户或本地主体签发，绑定 session 摘要、客户端摘要、data 身份域、真实目录身份和当前内存 registry。
登录替换和退出主动撤销；在途请求按 session 定向失效，包括尚在解析 cookie 的请求。
关闭共用一个 promise，拒绝新身份操作并排空在途初始化，测试换代也先排空旧 owner。
访问全局最多 256、每主体客户端最多 32，30 分钟空闲过期；容量满不静默淘汰仍有效访问。

## 独立 omp 审查与处理

初版两轮 deadline 退出不算通过；浏览器专项和核心测试类型收窄的后续轮次均正常退出并交付。
主 Agent 检查实际 diff，重新运行下列检查，不以子代理自述替代证据。

首次只读审查正常结束，未发现 P0/P1，提出四项：

| Finding | 处理与证据 |
| --- | --- |
| 全局 authBarrier 使匿名退出影响其它主体 | 改成按 session 在途 AuthCheck，匿名无用户不撤销；真实 h3 匿名 logout、cookie/user 核验阶段的对应/无关 session 回归通过 |
| 全局访问容量易被一个客户端占满，关闭页面文案未接线 | 增加每主体客户端 32 上限，改为稍后重试文案；下一 adapter 必须闭合卸载、初始化取消与失效访问释放，当前没有产品启动消费者 |
| 前端丢弃服务端稳定错误码 | unavailable 结果带 code/statusCode，复用已有 API 错误解析器，调用方无需分析中文文本 |
| 整个根缺失作为 I/O 失败，建议当成重新初始化 | 不接受该改法：冻结合同区分真实 I/O 故障和缺失记录；卷不可达不能自动当空数据恢复。显式初始化仍由调用方授权发起 |

最终只读 omp 复核正常结束，结论为“不阻断”，逐项确认 F1–F4 闭合且没有新的明确缺陷。
该轮只读代码、未运行测试；测试证据仍由主 Agent 上表的实际命令提供。
其非阻断提醒已列入下一增量：卸载释放、自然过期占用有界槽位、退出后释放的 401 应作为已撤销容忍。

## 主 Agent 实跑验证

cwd 均为本 Work worktree，Windows；最终值来自 2026-09-16 03:24 之后的命令。

| 命令 | 结果 |
| --- | --- |
| `bun run --cwd packages/neuro-book test shared/storage server/storage app/utils/storage server/utils/auth.test.ts server/api/auth/login.post.test.ts server/runtime/shutdown/product-shutdown.test.ts` | exit 0，19 文件、149 用例通过；包括 t22 核心回归、真实跨进程、真实 h3 cookie session |
| `bun run --cwd packages/neuro-book typecheck` | exit 0；server/storage 的源码和测试全部进入检查，补齐 t22 测试的联合类型收窄，没有排除测试 |
| `bun run --cwd packages/neuro-book smoke:storage-host-identity --browser-executable 'C:/Program Files/Google/Chrome/Application/chrome.exe'` | exit 0，status=passed，findings=[] |
| `bun run --cwd packages/neuro-book scripts:typecheck` | exit 1，仅既有 `scripts/deploy/product-agent-state-root-smoke.ts:318` 缺 colorwayId/userColorways；该文件与 HEAD 无 diff，未把脚本全集称为通过 |
| `bun run docs:check` | exit 0，5615 文件、failures=[]（最终证据文档追加前） |
| `bun run governance:context --work w00003-neurobook-ui-foundation-migration --task t23-storage-host-identity --role tasker` | exit 0，工作树、分支、Task role 正确，failures=[] |
| `git diff --check` | exit 0 |

Chrome 152 使用独立浏览器上下文、普通 HTTP `storage.test` 仅映射本机隔离宿主，无外网请求和真实产品 data。
实际断言包括 secureContext=false、getRandomValues 可用且 SubtleCrypto 不可用，首次双标签竞争 10 轮，
独立浏览器隔离、清标识、删除 IndexedDB 后同页面恢复、重新加载、存储不可用、真实事务 put 抛错、
独立标签释放、修改凭证拒绝、重复释放、模拟后端重启后旧标识拒绝与重签发。
最终客户端模块 SHA-256：`F8D49C1B0632CA400BDA690CF0400172C65A9D83E0D0C1507F39E43038940C9C`。

未跑其他 OS、整套产品、真实账号数据库、用户旧键迁移；不宣称它们通过。
新的 smoke 临时根均已在 finally 清理；早期 CLI 探针的 Temp 子目录 `storage-browser-MxfyHy`
清理被自动审批拒绝（仅返回 blocked by policy），未绕过，仍保留在测试支持包 acceptance/product-runtime 下。

## 下一增量必须闭合

1. 请求通过 host 核验后才能操作注册定义；不能接受 body 的 owner 之外自由身份、根、clientId。
2. 值读写/订阅 adapter 持有实际 StorageHandle，授权失效、释放、空闲与停机时拒绝新接纳并排空；
   本增量的请求身份结果不是长期授权凭据。
3. 初始化取消、页面卸载/重复挂载、订阅断连必须释放对应访问；超时和未确认提交保留 committed 事实，不能盲目重试。
4. 使用真实隔离宿主闭合 user/local 值保存、订阅和后端重启恢复后，再进入 Project 接线。
5. 保护原有两个 descriptors dirty 文件；本 Task 不暂存它们，不 push/PR/部署。
