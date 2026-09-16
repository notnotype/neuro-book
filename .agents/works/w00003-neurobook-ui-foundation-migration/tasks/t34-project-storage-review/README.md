---
schema: nbook.task/v2
taskId: t34-project-storage-review
role: reviewer
---

# Project Storage 宿主与生命周期独立审查

## 最终增量复核

首轮报告保留，本次追加 `walkthroughs/final-review.md`。t30代码补修已落，当前Tasker只在跑验证/写报告；不再审先前形状。
先读t30的 `walkthroughs/leader-shutdown-findings.md` 与 `walkthroughs/final-validation.md`（后者可能仍写进行中，主Agent会收真实输出）。
前一增量真实28文件351通过/1跳过（主Agent已核omp原始tool output），目前两项修复已有2文件38通过。
只审下列新增边界与对应测试，并核原t30接口仍自洽，勿重复整个旧审查表：

1. StorageMutationGuard可异步：所有真实副作用await；最后await之后的锁健康同步检查未漏，授权同步核验在物理复核后。
2. project action每副作用复核data物理根（相同identity.json不能挽回旧访问）、Project物理根（watcher前窗口），普通close允许排空。
3. Project整体shutdown：Service guard不再要求running；Lifecycle已close后仍可只读复核原workspace；新操作仍被拒，替换/锁失效仍拒。检查不是只用stub掩盖真实Lifecycle断言。
4. Project Facade V4槽：按真实V3排空（新增module snapshot/能力不原地复用）、继承previousClose链，关闭失败新owner fail closed，同版reuse。
5. 最后新测试使用真实I/O或明确门控，锁失效保持旧值字节不变，没有将坏行为改成测试预期。

本次只读、仅写自己的报告。可独立跑上述直接测试（project-scope、storage-core-regression、project-session-hmr/service/lifecycle），
不要再跑完整28文件集或typecheck。主Agent统一typecheck；无需浏览器。8分钟内清楚结论；如无缺陷明确建议合并及证据限制。
t31/t32文件与归档已提交 `6d644059`，不纳入本次增量；t35前端已获t36复核，同样排除。

Work：[w00003](../../README.md)；实现 [t30](../t30-project-storage-host/README.md)。
只审 t30 相对 `0d66064b` 的改动：`server/storage`、`shared/storage`、`api/storage/project`、
Project module/lifecycle/session/runtime/service 与对应测试。t31/t32 普通文件与归档由 t33 另审，完全排除；
两个 descriptors 是用户既有 dirty，不碰。

先写 `walkthroughs/review.md` 标进行中，再只读审源码。读取 [followup](../t30-project-storage-host/walkthroughs/followup.md) 和
[leader-findings](../t30-project-storage-host/walkthroughs/leader-findings.md)。首轮 HMR 用错误旧对象 fixture 被主 Agent 真实探针推翻，
追加已改真实形状，并称 28文件347通过/1跳过、主应用typecheck通过。请按 diff 与实际代码独立判断，不采信自述。
不 sleep/等待、不再派代理、不联网、不提交、不动真实 data，只写审查报告。约8分钟；必要时隔离小探针，勿重复业务全集。

## 核对点

1. 精确 ready/publicId 与请求身份、scope、Project/data物理根绑定；Project 不建自己的 identity domain。
   每次 action/release 不因同主体或同路径而拿到新代次。user/project release 不互相接受。
2. lazy module 按生产 composition root 注册，普通open不建Storage；close主动撤销访问、释放容量，操作排空在Occupancy前。
   共享host服务与句柄池是否可靠纳入Project lifecycle，或仅看起来多了一个Module名。
3. 新 `assertTarget` callback：普通close的已接纳操作允许收口；锁失效、root-replaced及Service terminal gate不能继续副作用。
   特别核对它依赖watcher失效标记与实际物理根检查之间的窗口；不能以“测试直接close(root-replaced)”替代所有物理根证据。
4. 首次mkdir前在所有鉴权、模块、身份I/O后重新核验Project；不递归创建已经删除的Project。
   在途data根更换是否仍保留原绑定；上下文guard与核心文件根guard组合完整。
5. V2/V3→V4 HMR旧形状真实、排空失败阻止新owner、同版重载可复用；服务/池/访问registry没有关错字段。
   新storage module加入时，旧Project Service已捕获的registry快照如何处理，也需明确升级边界。
6. 公开接口类型、依赖环、错误/committed语义、所有HTTP body校验及auth-on/off/session撤销复用。

结论写 `建议合并`、`需要修复`、`未完成验证` 或 `无法判断`，缺陷必须有触发场景、影响与位置。
不把前端Project adapter、grid、迁移或命令系统当本次缺陷；空final/exit0不是完成。
