# t30 实现中独立核对

2026-09-16；当前是实现中代码取证，不把未稳定代码问题算作最终交付结论。

## 必须补核对

1. **V3 HMR 真实形状不匹配。** 基线 `0d66064b:server/storage/host.ts` 的 V3 有 `accessContexts: StorageAccessContextRegistry`
   和 `registry: StorageStateRegistry`。后者没有 `close()`。当前 `createState(previous)` 调 `previous.registry.close()`，
   V3 fixture 却把 access registry 填在 registry 字段，掩盖真实升级启动 TypeError。
   V2 与 V3 必须按各自真实形状交接；测试须使用旧代码的实际字段。关闭失败保留，不以 allSettled 掩盖失败接纳新 owner。
   主 Agent 在独立 Bun 进程注入真实 V3 字段后 import 当前 host，实际得到 `TypeError: previous.registry.close is not a function`；未访问真实 data。
2. **Project 在途副作用 guard 缺生命周期检查。** `performLeasedAction` guard 只有 accessContexts.assertLive；
   Project lock compromise/根替换先 abort，Module.close 却在 dataOperations 排空后才 revoke。
   因而等待 Storage 锁的操作有窗口在 Project 失效后写入。应捕获已接纳操作的精确物理/Occupancy guard，
   区分普通关闭排空和不再有效的目标；不能只在请求最开始检查一次。
3. **首次 mkdir 的检查太早。** revalidate 后还等待 lazy module、鉴权与身份域 I/O，`createProjectStorageRoot`
   的 assertActive 只检查 Storage host。应在实际创建前再次核验原 Project 身份和锁；不能先递归 mkdir 再发现 root replaced。
4. **data 物理身份未进 Project claims。** resolveDataIdentity 捕获了 user 根 rootIdentity，但 Project claims 只保留 Project Storage 根。
   用相同 identity.json 替换 user Storage 根后旧 Project context 仍可能可用。按合同绑定签发时 data 根身份并在每次请求核验。

请用确定性门控测试证明这些边界；主 Agent 会在首轮完成后统一收口。
