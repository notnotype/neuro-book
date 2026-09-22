---
schema: nbook.work/v1
workId: w00017-application-runtime-architecture
issueId: null
---

# 应用运行时与内置插件架构

## 当前结论与授权

2026-09-20 开发者接受基础架构与分段推进方向，并要求先完成规范与实施规划：

1. 第一实现切片止于**环境适配入口 + 小内核**，必须可验证、代码规范、能适配不同宿主与作用域。
2. 第二切片以内置服务插件检验地基；当前最小真实集合为**诊断、平台文件、SQLite**。其它应用服务随首次真实功能消费接入，不先搬完所有后台。
3. 后续按**外部插件开发者视角**推进 Lab → Files → Settings → World/Plot，不把第三方市场/SDK/沙箱引入当前范围。
4. **开发者最新决定：等待 w00003 完成并合并到 master，再考虑从 master 创建 w00017 worktree。**不继续共享w00003，不从其中途检查点分叉，也不提前实现纯内核。

本轮只写 Spec、Work、整体路径、Task 与审查证据。未执行产品实现、worktree 创建、提交、push、合并、迁移或浏览器/真实模型验收。计划批准不等于这些动作已经授权或完成。

## 规范与实施入口

- [总体提案](../../../packages/neuro-book/docs/proposals/application-runtime-and-plugins.md)：`accepted` 为基础架构与分段方向；任意热卸载/代码升级仍仅评估，未纳入当前实施。
- 第一片 `planned`：[runtime.lifecycle](../../../docs/specs/runtime/lifecycle.md)、[runtime.services](../../../docs/specs/runtime/services.md)、[runtime.plugins](../../../docs/specs/runtime/plugins.md)、[runtime.application](../../../docs/specs/runtime/application.md)。
- 第二片 `planned`：[runtime.diagnostics](../../../docs/specs/runtime/diagnostics.md)、[platform.files](../../../docs/specs/platform/files.md)、[platform.sqlite](../../../docs/specs/platform/sqlite.md)。
- [整体实施路径](implementation-plan.md)：各切片模块、文件边界、依赖、实际smoke、旧入口退出与worktree前提；是工程计划，不复制行为合同。
- 既有命令、Storage、Lab、Workbench等能力沿同一Spec修订，不建“插件版”副本。w00003尚未合并的实现/规范不能冒称master现状。

## 当前 Task 与继续条件

| Task | 当前范围 |
|---|---|
| [t01](tasks/t01-architecture-proposal/README.md) | 已完成架构提案与 B/S 追加设计的历史交付 |
| [t02](tasks/t02-runtime-contract-review/README.md) | 独立运行时／资源合同复核；各轮报告分开 |
| [t03](tasks/t03-document-governance-review/README.md) | 独立读者／治理与计划可执行性复核 |
| [t04](tasks/t04-foundation-spec-plan/README.md) | 当前规范、整体实施方案与治理集成 |
| [t05](tasks/t05-runtime-lifecycle/README.md) | 已制定的首个实现单元：资源生命周期及独立验证入口；**等待 w00003 合并 master，尚未执行** |

后续单元在整体路径中规划，但不预建依赖未知实现结果的Task链。t05闭合后按实际API与证据创建services单元；再推进plugins、环境适配与首片验收。第二片可在公共合同稳定、文件owner独立后并行。Task completed不等于整个切片或产品完成。

## 执行位置与版本

当前纯治理文档在主工作区 `master` 维护；本轮 `governance:context` 核实 HEAD `45906272915ff43e83318653af62afa9ce668206`，w00017/t04/leader正确。所有本Work文档尚无独立提交revision；存在其他Work/user改动，本轮不暂存、不覆盖。

w00003只作调查参考：`.worktree/w00003-neurobook-ui-foundation-migration` / `refactor/w00003-nb-ui-adoption` / HEAD `26479d48604d3882b8d42b9f4447c6e3f4ac69c4`。本轮status观察为7 staged、196 unstaged、166 untracked，是快照而非未来基线。实施等待该Work完成合并，不接管它的收尾。

未来默认路径 `.worktree/w00017-application-runtime-architecture`，分支 `refactor/w00017-runtime-foundation`，起点只能是包含 w00003 合并结果的 master。登记按 [编号合同](../README.md#编号分配与记录位置) 本地协调，不要求登记共同祖先或先进入远端 master；**等待 w00003 合并的开发者条件不变**，当前不创建实现 worktree。基线完成后核对代码／Spec，进度随实现分支维护，不双份回填。

## 不变的产品边界

- 必需服务可插件化，首批随产品发布，不支持任意在线卸载/替换。
- 显式关闭先协商dirty/在途工作；强制退出不保证保存；窗口离开不关闭共享后台Project/Job。
- 服务实例寿命不等于持久记录寿命；不改变现有用户格式、数据库布局或迁移策略。
- 小内核不依赖具体领域、框架、文件/数据库驱动；代理/服务发现不代替服务端授权。
- Lab只做组件展示与局部显式依赖，不形成第二产品宿主或通用插件Lab。
- 不修改产品/fixture/依赖/CI/发布，不执行远端Issue/Project/PR写入；`issueId: null`，未取得远端编号。

## 质量与证据

纯文档检查链接、结构、capability唯一性、成熟度与批准边界，并用独立Reviewer反证生命周期/资源/依赖合同和实施计划。最后统一运行 `bun run docs:check`、当前Task `governance:context`；产品测试、typecheck、build、浏览器、迁移和Provider不属于本轮已运行项。

最近一次 `governance:check` 两项既有失败见 [原始输出](tasks/t01-architecture-proposal/evidences/governance-check-tracer.txt)：w00003/t14缺README、根AGENTS固定标记不匹配。本轮不修改这些路径、不以重复运行掩盖失败，不宣称全仓治理通过。

历史交付（不作本轮新Spec验证）：
- 首轮 [审查处理](tasks/t01-architecture-proposal/walkthroughs/review-resolution.md)、[质量基线](tasks/t01-architecture-proposal/walkthroughs/quality-baseline.md)。
- B/S追加 [源码调查](tasks/t01-architecture-proposal/walkthroughs/tracer-design.md)、[审查处理](tasks/t01-architecture-proposal/walkthroughs/tracer-resolution.md)、[文档门禁](tasks/t01-architecture-proposal/evidences/docs-check-tracer.txt)。

本轮新审查分别写 t02/t03 的 `walkthroughs/foundation-review.md`；t04 记录处理与最终质量证据，不用旧报告为新Spec背书。

本轮规范规划的处理与验证入口：[t04交付记录](tasks/t04-foundation-spec-plan/walkthroughs/foundation-resolution.md)、[身份检查](tasks/t04-foundation-spec-plan/evidences/context-checks.txt)。t05未执行，当前等待w00003合并master的条件不变。
