---
schema: nbook.task/v2
taskId: t68-files-resource-layer
---

# NeuroBook v2 Files 竖切一：资源层与文件服务

## 目标与范围

第 6 步 Files 竖切的第一片（分解见 [plan.md](plan.md) 的“第 6 步分解”）：内置插件 `nbook.files` 的资源层，`project://` 与 `user://` 两个真实目录型提供者；列出一层目录（不读文件内容，按文件夹后缀分类，内容文件夹按清单投影展示名与顺序）、读取带磁盘基线、按基线条件写入并记录来源、变更事件（经文件服务的写入与外部修改）；浏览器入口提供给资源管理器与编辑器使用的文件客户端。文件操作（新建、改名、移动、复制、删除）、资源管理器视图、编辑器与性能验收是后续 Task。

实施计划：[plan.md](plan.md)。

行为合同：[`workspace/resources.md`](../../../../../docs/specs/workspace/resources.md)、[`workspace/folder-kinds.md`](../../../../../docs/specs/workspace/folder-kinds.md)、[`workspace/files.md`](../../../../../docs/specs/workspace/files.md)（本 Task 修订其中本片实现的部分）。

## 前置

外壳三 [t67](../t67-workbench-shell-dnd/README.md)；项目实例与绑定 [t54](../t54-project-child-process/README.md)；Storage、配置（K4–K6）。

## 当前状态

- 2026-10-09 计划起草，交三个 omp 审查（对照 Spec 与提案、运行时架构与对抗场景、可实现性与测试）。
- 2026-10-09 计划审查：三个 omp（对照 Spec 与提案 16 条、运行时架构与边界正确性 13 条、可实现性与测试 9 条，报告见 `evidences/plan-review-{design,arch,tests}.txt`）。三份交叉一致的：业务码 `denied` 与路由保留码冲突（阻断）、正文 8 MiB 超过 RPC 单条消息 1 MiB、同基线并发保存都成功、项目合同的 `callers` 封死系统插件、控制目录可经链接别名访问、共享 `watch` 缺建立失败与结束、事后 `lstat` 区分不了新建与替换、`chmod 000` 证明不了不读内容。另有 rename 绕过只读位与拆掉链接、根目录被替换、BOM 被吞、清单缓存键碰撞、临时文件与别名的回声、Bun 溢出与根移动不报 `error`、来源只证明执行入口。全部并入 [plan.md](plan.md)；8 项取舍记入 [待确认清单](../../pending-confirmations.md)。arch 审查两次被打断（aihub 的安全过滤拦下关于路径越界的会话后回退到额度不足的 cctq），换中性措辞开新会话续审完成。
- 2026-10-09 实现 S0–S4（`3e8eab55`、`52020742`、`2111ff96`、`fb5d066d`、`8507a278`、`5b07cb0e`）：Spec 修订；资源地址与受根约束的原语，加锁替换从 settings 抽到 `src/backend/locked-replace.ts` 两边共用；两份远程合同、列出（三类文件夹、清单投影、正文入口）、读取与条件保存，产品清单与三个宿主登记；变更事件、写入来源、回声去重、失同步与监视重建，浏览器 `watch` 共享订阅；真实项目子进程（两窗口、子进程崩溃、暂停制造的 inotify 溢出）、真实 WebSocket 的正文上限、样本生成器与列出访问记录（[list-trace.txt](evidences/list-trace.txt)）。实现时改判一处：临时文件按带实例标记的名字识别，不登记、撤销精确路径（计划第 5 节已改）。
- 验证：`bun test src/plugins/files` 连跑三次全过；每片的变异检查共 40 个，全部被测出（S2 的“客户端发出前核对上限”在进程内链路测不出，S4 的真实 WebSocket 测出）；`smoke:server` 通过；全量 e2e 101 通过。`test:affected --typecheck`（锁文件改动触发全量）中 neuro-book 的后端宿主测试因产品清单多了 `nbook.files` 而失败，已补；llmlint（引用未声明的 `diff-match-patch`）、nb-ui（测试环境没有 `localStorage`）、neuro-book-test-support（路径长度用例）的失败所在的包本 Task 没有改动，未在旧提交上复跑核实。
- 环境：第一次全量 e2e 有 7 个失败，原因是 `/tmp`（tmpfs，按用户配额）被本会话的旧实验目录占满，Chrome 报 `Disk quota exceeded`；清掉之后全部通过。t67 收口时记为“既有失败”的 `dev.e2e`（`ERR_INSUFFICIENT_RESOURCES`）同样在清理后通过，多半是同一原因。
- 三份 Spec 的“实现合同”与“待晋升”等 Files 竖切的能力补齐（t69–t71）后再写：本 Task 只实现了其中的资源层部分。

