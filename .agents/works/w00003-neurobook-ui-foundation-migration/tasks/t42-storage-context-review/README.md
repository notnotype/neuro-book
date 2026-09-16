---
schema: nbook.task/v2
taskId: t42-storage-context-review
role: reviewer
---

# 工作台 Storage 消费上下文独立复核

**当前入口：** [最终追加复核](walkthroughs/leader-final-followup.md)。本轮产物为 review-final.md。

Work：[w00003](../../README.md)；被审实现：[t40](../t40-workbench-storage-context/README.md)。
合同：[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)、[storage.persistence](../../../../../docs/specs/storage/persistence.md)。

## 目标与范围

独立审查 packages/neuro-book/app/utils/workbench/storage-context.ts、storage-plugin-sample.ts、同名测试及app/utils/storage/README.md。
只读被审源码。t40正收口类型与报告，先核当前hash，若期间变化，结论固定到实际hash并留追加复核。
检查公共API的身份、生命周期、排空、显式错误、内存共享与插件真实适配器消费。不以通过自写stub测试代替真实适配器测试。

## 优先复核

1. release()中Project释放失败是否仍清理user句柄/session；所有错误是否可观察、重复release是否共同等待。
2. AbortSignal触发invalidate的全部Promise链是否被观察；用真实unhandledRejection探针，不能只看released的catch注释。
3. A释放等待时进入B再切user-assets、release或abort，B不能迟到复活；旧借用接口和内存引用立刻失效。
4. 已借用的owner facade是否在切换后仍可接纳写入（与已接纳排空区分）。打开session/owner过程与释放交错时不得漏清理。
5. 释放失败后新切换是否吞掉旧错误；内存订阅某个listener抛异常是否破坏其它消费者，按当前合同评估。
6. 样例保存是否保留原记录未涉及的未知字段，损坏/高版本不能当缺失覆盖；稳定owner/key/resource及对象存在性边界。

## 执行规则

只使用当前worktree绝对cwd：
C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/.worktree/w00003-neurobook-ui-foundation-migration
聚焦测试的cwd也必须是其下 packages/neuro-book 的绝对路径，先核Get-Location/pwd。
可将临时探针短暂放入测试include运行，结束用单文件移动回本Task/evidences；不改被审实现/测试，不提交、不联网、不启动产品服务、不访问3001、不动真实用户数据。
临时根遵守docs/testing；禁止在仓库创建.tmp，也禁止递归删除任何目录。只清理自己确切创建的单文件。
不运行全包typecheck/build，避免并行写入生成物；Leader统一验证。

## 产物

walkthroughs/review.md：结论、按严重度排序的确定缺陷、具体位置、真实复现与正确cwd/退出码、hash、未运行项。
不把假设写成确定缺陷，不扩大到命令系统或新插件框架。最终回复具体结果。
