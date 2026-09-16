---
schema: nbook.task/v2
taskId: t33-storage-file-archive-review
role: reviewer
---

# Storage 文件边界与归档独立审查

## 本次追加复核

t31 最后三项已补修，首轮 reviewer 列出的 CLI、普通顶层目录、用户资产 ZIP 均有代码和真实测试。
请读 t31 的 `walkthroughs/final-validation.md` 与 `walkthroughs/leader-baseline.md`，复核最终 diff。
追加写 `walkthroughs/followup.md`，保留首轮报告，不把旧的缺证据结论当当前状态。
主 Agent实跑旧改动 13文件131通过、随后typecheck exit0；新增补修 Tasker 实跑4文件28、1文件8、8文件29通过。
本次可独立重跑前三个新增边界重点（guard、CLI、archive/download）核实数字，不跑大型 workspace-files；主 Agent会跑最终统一typecheck。
alias 用例已用 git-show 对照相关两份旧依赖，提交前后同一 ELOCKED 失败，见 leader-baseline；不要扩大修锁。
检查 CLI helper 从已有 File Scope 确定 target 是否可靠（普通 root/Project root/alias），普通 read/parse 路径是否有明确遗漏；
但不扩成任意本地CLI沙箱。若无阻断直接明确结论，最终typecheck由主 Agent补证后提交。

Work：[w00003](../../README.md)；实现 [t31](../t31-storage-file-boundary/README.md) 与 [t32](../t32-storage-archive/README.md)。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md) 的普通文件消费、资产同步和备份。
审查相对 `0d66064b` 的这两项 diff；t30 的 host/Project lifecycle/shared/storage 正由另一代理补修，完全排除，
两个 workbench descriptors 为用户已有 dirty，同样排除。

本轮只读源码与测试，只写本 Task 的 `walkthroughs/review.md`。第一步写进行中报告，最后给明确结论；
不要 sleep/等待，不再派代理、不联网、不提交或远端操作、不操作真实 data。约 8 分钟，尽早落发现。
允许必要的隔离小探针；不要跑全 Workspace/业务全集或重复 typecheck。主 Agent 正跑这两项的统一聚焦测试。

## 最新证据

- t32：真实 Project ZIP、完整 data 加密/解密/解包，3 文件14用例通过；原子替换后 ZIP 完整快照通过。
- t31 首轮代理留下代码和8用例边界测试，但最后 sleep 超时、没有最终报告。主 Agent 接管，
  修真实路径解析被 catch 放行、根 mutation 的明确拒绝、Windows Project path policy 大小写，并补回归。
- `docs:check` 5672文件 failures=[]；governance failures=[] / warnings=[]。
- t31 首轮跑到无关 Project identity alias lock 测试失败，仍在独立归因，不把本审查视作其已通过。

## 重点

1. 生产入口是否真调用保护：写/读/统计、新建/上传、rename/delete/文件转目录；祖先操作、跨入受管目录、
   workspace-root 上层访问、内部链接与缺失目标是否遗漏。普通 `notes/storage` 不误屏蔽。
2. user-assets/Project file-index、watch 事件、History 不消费 Storage；正常文件流程无不必要回归。
3. 资产同步的源枚举和旧 state 清理都不碰 Storage；现有真实同步 fixture 是否足以支持结论。
4. Project path policy 强制保留 Storage 正式文件/墓碑/原件，锁和模块临时文件忽略；
   根 `.nbook` 被 ignore 时仍穿透。Windows 大小写与普通同名目录区分。
5. `workspace-archive.ts` 对 preserve 文件逐条复制到现有 staging 再交 yazl，避免预先 stat 与稍后打开期间替换。
   资源清理、错误传播、原件字节、无跨键快照承诺；不修改外部原数据。
6. 完整 data 备份只按明确 user/project Storage 根排除 `.locks`，复用模块临时名，未知原件保留；
   目录与顶层可选文件 I/O 错误不会伪装成缺失。加密解包证据是否真实。

结论用 `建议合并` / `需要修复` / `未完成验证` / `无法判断`；缺陷写触发场景、影响与文件位置。
不要把未实现的前端 Project adapter、grid 或命令系统当本轮缺陷。空 final/exit0不是审查完成。
