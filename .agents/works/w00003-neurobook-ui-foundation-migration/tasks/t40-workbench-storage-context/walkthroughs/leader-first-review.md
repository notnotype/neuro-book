# 上下文初稿复核

源码仍在实现中，以下不作为最终审查结论，但必须在交付前验证。

## 实测P1：迟到的enterProject复活旧目标

过程：进入A并借用句柄，让A.release等待gate → 调enterProject(B)，它等A释放 → enterUserSurface(user-assets)完成 → 放行gate。
结果：target仍为user-assets，但旧B返回`available=true`，并成为实际projectOwner来源。
原因：enterProject在第一次await后才增加generation，没有捕获本次切换序号并复核；离开与并发进入均可被迟到操作覆盖。

真实命令：`bun run test app/utils/workbench/leader-storage-context-probe.test.ts`，cwd主应用worktree包，exit1，1用例失败。
失败断言`expect(b.available).toBe(false)`实为true。探针已从app移出，保留在本Task evidences，可复制回同目录复跑。
修复应覆盖A→B→C、A→B→user-assets、初始化中release、失败收口后的切换，保证最新明确目标胜出且迟到资源被回收。

## 其它需核对的边界

- 借用结果返回共享原始StorageOwnerHandle，暴露release：某一个消费者释放会使同owner其它消费者拿到已关闭的缓存句柄。
  将释放归工作台owner，公开借用接口移除生命周期操作，或明确提供有引用计数的lease；不依赖调用方口头不调用release。
- AbortSignal回调中`void invalidateProject(...)`若closeContext拒绝，会有未处理Promise拒绝；必须提供明确故障通道。
- releaseScope的allSettled结果不能完全忽略。每项都尝试清理，但释放失败需返回可观察错误；project.released在失败时不能永远挂起。
- ensureSession抛异常后的sessionOpening需清除，否则后续显式重试重用同一拒绝Promise。
- 选择共享目前只有get/set，真实两个Vue视图如何得知另一视图更新，需提供一个可消费的订阅/响应式边界；不要依靠轮询或全局store。
- 保持代码类型清晰：单个判别联合统一open结果，不靠`as`假称scope；测试桩亦不要用`as unknown as`掩盖签名不符。

这是原合同内的缺陷，直接修复，不新增产品决策或请求开发者批准。只改本Task文件，保护并行grid/Splitter。
