# 2026-09-16：Storage 计划审查补全

## 范围与基线

- Work/Task：w00003-neurobook-ui-foundation-migration / t21-storage-design-review，role=leader。
- HEAD：`8406964de94f3aecd309d9deacc8cafd8e909384`；分支 `refactor/w00003-nb-ui-adoption`。
- 开发者要求检查计划遗漏，随后同意“可以，优化补充”。本轮只改文档，不实现服务、grid 或标题栏，不执行产品数据迁移。
- 保留原 dirty 文档与 `descriptors.ts` / 测试变更；后者不混入文档提交。
- 开发者随后授权：文档治理完成后先单独提交，再进入 goal 模式开始实现；不访问远端。

## 审查发现与处理

上轮通过两次外部 omp 只读审查（均退出 0）与主 Agent 源码核对发现以下缺口。
除下述 grid 内存探针外均为源码推断，没有新服务的运行证据。

| 发现 | 补充结果与正文 |
|---|---|
| 现有 grid 不能完成横纵嵌套的空间吸收，畸形快照可能抛异常 | 新 ui.nested-grid；实施切片 3 先验证并修复必要原语，不提前重构 World Engine 整页 |
| user Storage 位于 user-assets 根内，项目 ZIP 可能忽略内部目录 | storage.persistence 规定 scan/watch/history、普通文件 mutation、种子与归档各自策略；切片 2 接线 |
| 主体、客户端与 Project 代次缺少可消费的访问合同 | 固定服务端主体、data 身份域、客户端分区、签发上下文及失效；切片 1/2 验证 |
| 订阅、显示与尚未保存的意图混用 | 固定三类状态、冲突后的字段重放、二次失败、切换前收口与强制退出的保证范围 |
| 未知引用过滤后整树保存会丢原状态 | 宿主保留原件与未涉及部分，校验在发布前完成；schemaVersion 与 revision 分离 |
| 只迁新外壳会留下旧 resize 和 Pinia writer | 首批同切片覆盖全部主尺寸入口与书架，原件备份早于旧桶重写，逐项恢复迁移进度 |
| 缺少插件多个实例和内存共享的完整示例 | 最小插件同时消费 user/project/内存；稳定资源标识表达独立或明确共享，按工作台/Project 释放内存 |
| user 队列、跨进程锁与应用关闭未闭合 | ADR 0021 与实施切片 1/2 固定文件锁、原子替换、quota 临界区与 shutdown 排空 |

主 Agent 未采纳独立审查中的过强推断：

- 备份携带 local 文件与新设备自动采用它是两个结果；保留客户端隔离，不为恢复布局改变“不跨端”的决定。
- owner/key 本身并不必然冲突；不同 grid 可以用不同逻辑键或稳定资源标识，无需给每次挂载生成持久化随机 ID。
- user 最近项目列表可以保存受校验的弱引用；不能把“项目恢复状态归 project”扩大成“user 键禁止出现任何项目 locator”。
- 全局 Project 删除与普通离开本就具有不同领域语义；补齐 Storage 失效与收口，不自行修改整个项目删除权限产品。
- 保留未知内容由宿主维护原记录实现，不要求把存储 owner、opaque 记录或应用组件塞进 nb-ui grid 原语。

## 已复现的最小探针

在本 worktree 使用 `bun -e` 导入 `packages/nb-ui/src/components/layout/grid.ts`，仅创建内存对象，无文件写入。
布局为左右分栏：left=300，center 为上下分栏（top=400、bottom=200）。结果：

```json
{"before":{"root":900,"left":300,"center":600,"top":400,"bottom":200},"branchResize":{"ok":false,"reason":"只支持调整叶子节点：center"},"leafResize":{"ok":true},"after":{"root":950,"left":350,"center":600,"top":400,"bottom":200}}
```

含 `children: {}` 的版本 1 快照还抛出 `TypeError: (candidate.children ?? []).map is not a function`。
这些证明旧原语限制和新验收的必要性，不证明新能力已经实现；本轮未修改原语。

## 文档产物

- 新行为规范：storage.persistence、ui.nested-grid；新增 ADR 0021、Storage 首批迁移合同、Work 内实施计划。
- 修订架构边界、Workbench Spec、前端规范及提案/规范索引，消除旧 user 尺寸与“全部服务行为待定”的表述。
- ADR 0020 与 t20 保留历史依据并增加当前入口；同步提案继续 draft，仅承载跨独立 data 在线同步。
- Work/t21 更新当前状态；命令提案仅更新 Storage 依赖，不借此批准命令系统。

## 验证与独立复核

首轮两次 omp 只读文档复核中，一次正常完成，一次超时退出且没有报告；超时不作为通过证据。
正常报告的五项意见经主 Agent 核对后均处理：

- 迁移门禁改为先保存浏览器原件暂存，再只冻结三个源字段；后端不可达不影响未迁字段保存。
- 墓碑容量增加 owner 显式维护，持久化分区新代次后回收；旧条件凭据不能重新创建被回收的记录。
- 不可持久恢复的客户端不开始导入、不清理源。
- 验收明确独立浏览器上下文和同上下文双标签的区别，身份域使用独立后端根。
- ADR 的 project 进程内锁改为 owner 实际分区，统一覆盖 quota 与 mutation。

缩小范围后的 omp 复核正常退出，确认五项修订闭合，未发现阻断性矛盾或具体数据丢失路径。
其非阻断建议继续补入：跨键并发 quota 验收、专用迁移 owner/分区/容量、data 原件与浏览器暂存的术语，以及残留锁恢复合同。
UI/grid 文档由主 Agent 按已有探针和当前合同复核；超时的 UI 独立复核未作为通过证据。

- `bun run docs:check`：退出 0，5564 文件，failures 为空。
- 本批 26 份文档的本地路径链接：196 个，missing 为空。
- `git -c core.safecrlf=false diff --check`：退出 0。
- `bun run governance:context -- --work w00003-neurobook-ui-foundation-migration --task t21-storage-design-review --role leader`：工作区、分支与 role 符合，failures 为空。
- 本轮无运行时代码变更，不运行无关业务全量测试；这些结果仅验证文档与治理，不代表持久化或浏览器验收通过。

## 未实施与后续

运行时、HTTP/磁盘故障注入、浏览器双标签与嵌套 fixture、备份解包和主页面验收均待各实现切片执行。
当前文档完成后按实施计划创建下一实际 Task，不以本记录晋升任何运行时 capability。
