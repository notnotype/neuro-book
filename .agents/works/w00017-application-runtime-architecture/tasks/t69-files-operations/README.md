---
schema: nbook.task/v2
taskId: t69-files-operations
---

# NeuroBook v2 Files 竖切二：文件操作

## 目标与范围

第 6 步 Files 竖切的第二片（分解见 [t68 的计划](../t68-files-resource-layer/plan.md#第-6-步分解)）：在 `nbook.files` 的两份远程合同上加文件操作：新建文件与文件夹、创建内容（排他创建空白 `index.md`）、改名、移动、复制、删除；批量的逐项结果、无覆盖冲突、父子去重、取消与停止条件；内容文件夹内的操作同步清单，调整顺序、改展示名与普通文件夹和内容文件夹的转换只改清单与后缀；经文件服务的操作发出精确的新建、改名、删除事件。资源管理器视图（t70）调用这些操作，本 Task 没有界面。

实施计划：[plan.md](plan.md)。

行为合同：[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)（本 Task 修订其中本片实现的部分）。

## 前置

Files 竖切一 [t68](../t68-files-resource-layer/README.md)。

## 当前状态

- 2026-10-09 计划起草，交三个 omp 审查（[设计与旧行为](evidences/plan-review-design.txt)、[运行时与边界](evidences/plan-review-runtime.txt)、[可实现性与测试](evidences/plan-review-tests.txt)，共 31 条），全部并入计划：源身份令牌、批量停止接内核信号、RPC 字节预算、内容树操作锁、部分完成的结果形状、复制与删除的失败政策、回声按目录项身份。取舍记入待确认清单。
- 2026-10-09 S0–S4 完成并逐片提交：Spec 修订；目录项写原语（排他改名经 `bun:ffi`）；单项操作与清单维护、内容树操作锁、回声的预期状态；批量（预处理、逐项结果、取消、停止、字节预算）；真实项目子进程与真实 WebSocket 的组合用例。每片自跑测试并做变异检查（S1 20 个、S2 19 个、S3 19 个、S4 3 个；未拦住的只有回声身份里的创建时间比较：测试所在的 tmpfs 删掉重建后不复用 inode，造不出这个场景，保留这项比较，记为未验证）。收口验证：`neuro-book` 全量 634 通过、typecheck 通过、`smoke:server` 通过、e2e 101 通过。
- 2026-10-09 S5：三个 omp 实现审查（[正确性与边界](evidences/impl-review-correctness.txt)、[测试与验收覆盖](evidences/impl-review-tests.txt)、[代码质量与架构](evidences/impl-review-quality.txt)）共 21 条，逐条在代码里核实后全部修正：
  - 大小：客户端按要发出的完整请求核对预算（原先只算地址数组，带身份令牌的合法批量会断线）；结果按清单去重成表，超预算时依次省略范围、按编码字节截短说明、省略清单表，每步重新核对。
  - 锁：整根一把操作锁（改名内容根本身、搬动含内容根的目录时按内容根分的锁锁不全），锁内重新解析目标；复制在锁内读源条目；`holdLock` 核对锁目录身份，不释放已被接管的锁，提交前核对仍持有。
  - 清单：源条目在提交前独立读取，源清单只读时目标照样带走展示名与子树；清单写不进时保留底层失败码与诊断。
  - 回声：每个副作用落盘后立即登记（删除在删之前逐项登记），事件在锁内发出；监视在清单等锁期间处理一批也不再报外部回声。
  - 其它：同目标移动也先核对令牌，冻结的源不在了为 `source-changed`；系统库加载不了时报 `unsupported`；复制与移动共用一份排他改名的失败映射；合同升到版本 2（加了 `renamed` 事件）；单项与批量的每一项都经 `backend/commit.ts` 提交。
  - 测试：补交错改名、内容根改名、复制读源条目、同目标复制竞争、等锁期间目标被换、清单等锁时的回声、真实的大范围部分删除、按完整请求的预算、锁的接管；测试持有的锁与窗口在失败时也收口。
  - 修正的变异检查 18 个，拦住 15 个；未拦住的 3 个中两个是等价变异（锁内只重新解析时根外链接已被拒；删除不取锁时结果相同，已去掉这把锁），一个记为未验证：等锁期间目标被换的时序没有不加产品钩子的屏障，测试只验两种先后都不会提交到根外。
  - 收口：`neuro-book` 全量 646 通过、typecheck、`smoke:server`、e2e 101 通过，`docs:check`、`governance:check` 通过。t69 完成。
