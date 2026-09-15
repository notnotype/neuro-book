# t24 实现中复核（未交付）

基于 2026-09-16 03:37 中间源码，只读取证。下列点必须以最终代码/测试闭合，不能当作最后缺陷结论。

1. `handle-pool.ts` 当前 `release(): void` 发起异步 handle.release 但不让调用方等待。
   `close()` 只收集 entry.handle 非 null 的句柄，未等待 entry.released；若最后租约释放后立刻 close，
   已开始排空的句柄可能被忘掉。需真实 gate 控制释放完成顺序的回归。
2. entryFor 在容量检查之前创建 Map 条目，容量拒绝路径未清除空条目；不断请求新的 context/owner
   可能积累未计入 maxHandles 的条目。容量与缓存条目本身都需有界，拒绝不留下持久资源。
3. acquire 的关闭竞态分支先 users--，随后 throw 进入 catch 再 users--。避免同一次占用减两次。
4. mutation guard 在 assertMutationHealthy 的异步 assertContained 之前执行；路径检查等待期间发生撤销后，
   不能只检查 lock 就继续副作用，至少在异步检查完成后再核验授权。还应核对首次 open 的 mkdir 与元数据副作用。
5. runStorageAction 目前原样返回 read/reclaim 的 diagnosis；这些不是 HTTP error，可能携带原始路径，
   需要公开投影或明确保证内容不含内部诊断。输入字节限制有 raw-body，不可只依赖 Content-Length。
6. 当前核心仅在 lock error 时附 committed，回收新代次已写后发生授权失败等其它错误仍需带真实提交事实。

尚未实跑此增量；宿主动作与路由当时仍未落盘，不能把它们当缺失交付项提前判定。

## 03:44 首轮独立验证（续修前快照）

- `bun run --cwd packages/neuro-book test shared/storage server/storage server/api/storage`：18 文件，149 通过、1 失败。
  失败为替换重试期间撤销期望 403 却得到 200。
- 主应用 typecheck：6 处错误，均在 `storage-action-lifecycle.test.ts`；`vi` 未导入，
  `fileOptions.replace` 错把 adapter 对象写成函数，两个参数因此缺类型。故上述失败不能直接证明生产重试行为，
  必须修正故障注入后重跑真实边界。
- 续修中新增核对点：若根在 resolve 与 open 之间被移走但没有新建同名目录，
  `canonicalStorageRoot` 的 mkdir 不应让普通动作重新建立新根；当前 guard 只检验访问存活。
  根身份应在可能创建目录的边界生效，补“移走且不补建”用例，不仅验证空的新根没有记录。

## 03:52 新增独立复现

1. 复用 `createStorageActionHost` 与真实磁盘，将 `openHandle` 接缝设为先 rename 根到同测试临时目录内的
   `storage-moved`，不建立同名目录，再调用 service.openHandle；普通 read 最后 403/claims-mismatch，
   但 `access(host.root)` 证实原地址被重新创建（`rootRecreated=true`）。fixture.close 已清理该独立临时根。
   因此这是实际副作用缺口，不能用“没有写记录”作为通过；应让受信宿主以根身份约束已有根的打开，
   仍保留核心独立初始化根的合法调用。
2. pool 上限必须包含正在释放的句柄。当前 assertCapacity 只数 handle/opening，
   已存在 released 的条目不计入，可在慢释放期间不断换 owner/context 取得新句柄。
   这与 Map 空条目泄漏不同，需独立 gate 回归：maxHandles=1，第一次 release 未结束时取得不同 owner 应拒绝。
