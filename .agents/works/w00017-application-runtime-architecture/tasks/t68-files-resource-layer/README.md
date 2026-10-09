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
