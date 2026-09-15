# t23 实现中复核

以下基于 2026-09-16 02:46 的中间源码，尚未运行本模块测试；不是最终缺陷结论。
交接前请逐项用最终代码/回归测试闭合，不以当前中间文件已经落盘作为通过证据。

1. `access-context.ts` 按 claims 去重签发同一 contextId，但 release 删除整项：
   两标签共享同一客户端身份时会获得同一上下文，一个标签释放会撤销另一个的访问。
   客户端身份须收敛，不等于各工作台的访问生命周期要合并。应给每次访问独立 lease/上下文；
   不能以不加 owner 的共享释放减少 registry 数量。容量满不应静默逐出仍有操作的上下文。
2. `release` 文档承诺已不存在返回 false，但它直接调用 `lookup`，未知 ID 会抛异常，
   因而重复 DELETE 不幂等。需要以相同凭据释放两次的实际测试。
3. claims 只有 subject 字符串，没有 auth session 的代次/标识。若只比较 user ID，
   登出再登录同一用户可能复用旧 contextId，使“已撤销旧访问须重新初始化”失效。
   核对实际 host 当前 auth 校验是否捕获可信 session ID/sessionVersion，并测试旧上下文不能复活。
4. `server/api/storage/storage-host.ts` 与 `storage-http-error.ts` 是 helper 文件，
   不应落在 Nitro 的 API 路由扫描目录中形成意外路径。移到 server/storage 的宿主边界，
   api 目录只放明确路由和按仓库配置排除的测试。
5. IndexedDB `opened.onversionchange` 只 close 连接，未清 cachedDatabase：
   删除/升级后同页面下一次调用仍复用关闭连接，会一直 read-failed。onblocked 已返回失败后，
   原 open request 后续成功也需要关闭迟到连接，不能遗留未被当前缓存拥有的连接。
   出错/退出应有明确连接 owner；不能把已关闭或失败连接永久缓存。

补充核对：当前 API body 不应取得自由 root/subject/clientId；运行期 root 被替换后同路径/身份域的旧 context
不能重新解释到新物理根。若 t23 尚不拥有实际 Storage 操作，需明确 t24 的接纳/排空入口，而不是声称本层已排空磁盘写。

6. **真实 smoke 的隔离必须早于生产模块 import。** 新 smoke 顶层静态导入 storage-host，后者静态导入 auth，
   auth -> utils/prisma -> database/prisma 的 `export const prisma = usePrismaClient()` 会立即调用 resolveDatabaseConfig。
   在 `runStorageHostIdentitySmoke` 内才设置 NEURO_BOOK_STATE_ROOT 太晚；运行 smoke 前必须在外层进程环境
   注入隔离根，或先建隔离环境再动态导入宿主。不要直接运行当前脚本触达默认机器 data。
   启动失败也需在 finally 关闭已启动的 HTTP 宿主；当前 launchBrowser 在 try 外，失败会遗留 server。

## 浏览器环境证据

主 Agent 用新建独立 headless Chrome 152，在全部请求已拦截的 `http://storage.test` 测试 origin 运行：
`secureContext=false`、IndexedDB 真实读写成功、getRandomValues 可用、crypto.subtle 不可用。
这验证现有普通 HTTP 可用的原语，不证明生产身份模块已通过双标签验收；没有外网请求或真实产品 data。

## 真实浏览器模块探针（初版）

随后用 Bun 将实际 `app/utils/storage/client-identity.ts`（SHA-256：
`6EEC31C4AAE7F197BC7CF74603E8B9BDA2355D03EFD2E91B586B18AAF1F5B1BF`）打包到受控 Temp，
由 Playwright CLI 的隔离 Chrome 152 在同一 HTTP 测试 origin 加载，使用两个同 context 页面与另一个独立 context。
模块真实调用结果：

```json
{"initialized":true,"sameContextConverges":true,"separateContextIsolated":true,"pageReloadRestores":true,"unavailableIsExplicit":true,"explicitClearRotates":true,"databaseDeletionRecovers":false,"databaseDeletionStatus":"unrecoverable","databaseDeletionReason":"read-failed"}
```

第 5 项的关闭连接缓存问题由源码推断提升为已复现：执行真实 `indexedDB.deleteDatabase("nbook.storage-client")`
成功后，同页面再次调用实际模块仍返回 read-failed。修复后需重建 bundle 并复验，不能沿用上述初版哈希的结果。
这是身份模块验收，不是 HTTP 鉴权/完整产品验收；请求全部被 fixture 路由拦截，没有外网或真实 data。
