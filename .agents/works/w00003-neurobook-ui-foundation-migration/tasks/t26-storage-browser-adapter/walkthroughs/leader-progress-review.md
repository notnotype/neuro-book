# t26 实现中复核

尚未交付；下列以 2026-09-16 04:20 中间源码为准，须在最终代码与用例核对，不提前判为最终缺陷。

1. 新 Binding 已进入 `StorageHandleInput`，但池当前只按 contextId+owner 复用。
   若新代次句柄还被同上下文的另一个请求持有，带旧 binding 的 read 可能直接借用它，跳过新 open 的代次校验；
   反之，新 bind 也可能返回回收前仍在用的旧句柄代次。需要在复用边界区分/核验 binding，
   并用“同 context+owner，不同 binding 的并发请求”确定性回归，不能只测完全串行的一问一答。
2. Service 在 async open 前应捕获 binding 的标量值，不能保留调用方对象引用跨 await；
   浏览器 value/credential 的捕获同理。绑定不是认证 token，注释不要写成服务端能够证明它由 bind 签发。
3. 每次动作仍需 expectedRootIdentity 与授权 guard；新增绑定不能绕过 t24 对根消失不重建、在途撤销停写、committed 的处理。

最终审查继续核对 adapter 的初始快照顺序、网络未确认、close 排空与轮询资源界限。

## 04:24 独立探针

- 真实 HTTP + 隔离磁盘已证实串行主路径：bind `{local:1,shared:1}` → 保存 → 删除 → 回收成功；
  旧 binding 读取此前从未读过的资源返回 409/STORAGE_CREDENTIAL_STALE；新 bind 返回 local=2，
  新读取得到 missing 且 credential.partitionGeneration=2。fixture.close 已清理本次根。
- 当前 host 新增 `assertLeaseBinding` 会检查复用句柄的绑定，前述“旧 read 借新句柄”的中间风险已有检查。
  最终仍需并发用例证明，而不是要求一定按 binding 新增池 key。
- Core input 捕获探针：调用 `service.openHandle({binding})` 后立刻把原 binding.local 从 1 改为 2，
  尚未返回的 open 被改写为 STORAGE_CREDENTIAL_STALE（expected=2/current=1）。说明仍持有调用方对象跨 await，
  应在 openHandle 接纳处复制并校验绑定标量，而不是依赖调用方遵守 readonly。

## 04:27 前端中间代码新增核对项

1. `value-transport.ts:projectStorageAdapterFailure` 把任何带 HTTP 状态的未知结果映射成 committed=false，
   但代理 502/503 不证明后端没写入。`committedField` 在外层不含 committed 时直接返回，
   常见 `{data:{data:{committed:true}}}` 的内层永远走不到；会把真实 committed=true 丢成 false。
   应支持实际 ofetch/H3 包装，并把未携带明确证据的结果保留 null。已用独立调用复现这两种错误输出。
2. `owner-handle.ts` 的 dirty 在 notify 置 true 后没有清零，schedule.finally 永远选择 0ms，
   一次本地保存后会变成持续紧密轮询。请在开始读取时消耗 dirty，读取期间的新通知另行保留。
3. 401（包括 code=AUTH_REQUIRED 或无 Storage code）未判永久失效，将继续自动轮询；需要看 status 而非只看 Storage code。
4. standalone read 不在 release 的等待集合；重复 release 在首个尚未排空时直接返回。
   需要统一接纳操作集合与共享 close promise，并验证慢 read/订阅初始化期间的释放；HTTP 无 timeout/signal 时还可能永不排空。
5. interval/maxBackoff 未校验；input.owner 跨 open 的 await 仍从调用方对象读取；公开 binding 直接返回可变对象。
   在接纳处捕获/冻结标量绑定，不能用 readonly 假定运行期对象不会被修改。
6. 跨版本语义需核对：read 的网络结果直接 cast 为 T，前端定义的 schemaVersion/validate 未参与判断。
   若旧标签仍用 v1 而后端部署了 v2，服务端返回它自己的当前 value(v2)，前端不能按 v1 解释或用 v1 意图覆盖它。
   在 owning boundary 固定 schema 不匹配的公开失败/只读行为，必要时 DTO 携带客户端支持版本做保存前置条件；
   不要只通过 `value: z.unknown()` 宣称值内容已经验证。此项先以最终实现/测试判断，不默认为必须新增一个协议层。

04:28 独立 gate 探针确认第 4 项：standalone read 已进入 transport.send 并等待未决 gate，
调用并 await handle.release() 却已经返回；输出 `releaseReturnedBeforeAcceptedRead=true`。
finally 放开 gate 后读取完成，探针没有留下请求或文件。
