---
schema: nbook.task/v2
taskId: t03-ui-planned-specs
---

# UI 组件合同与 Component Lab 计划规范

## 目标

依据开发者对 Issue #191 当前目标的明确批准和`t01-migration-design`静态证据，创建并登记`ui.component-contracts`与`ui.component-lab`两份`status: planned`行为规范，使后续实现Task无需自行发明组件分层、catalog状态或Source Dev Lab边界。

## 允许改动

- `docs/specs/ui/component-contracts.md`：定义组件合同、catalog状态、证据与迁移关闭边界。
- `docs/specs/ui/component-lab.md`：定义Source Dev-only Lab、deterministic fixture、responsive容器与Product排除边界。
- `docs/specs/README.md`：在待实现规范注册两项capability。
- 本Task直属walkthrough：记录机器门禁、语义核对、未运行项和授权边界。
- `t01-migration-design`直属最终Leader walkthrough：记录t01已由开发者批准闭合。

## 规范边界

- 两份Spec只写黑盒行为、状态、副作用、失败、兼容与可观察验收，不写逐文件实现方案。
- `owners`固定为`ui`，capability固定为`ui.component-contracts`和`ui.component-lab`。
- `planned`只表示已批准目标，不表示当前产品已有catalog、Lab、nb-ui接入或preview清退。
- 旧`.worktree/t162-*`、`.worktree/t163-*`与历史Task状态只作参考，不作为current实现证据。

## 验证

1. `bun run docs:check`验证frontmatter、九章行为合同、capability唯一性和注册表成熟度。
2. `bun run governance:check`验证Work/Task身份与role。
3. Leader逐章核对两份Spec在输入、输出、状态、副作用、失败、owner、兼容和smoke上无矛盾，不泄漏实现步骤。
4. `git diff --check`验证当前Task允许路径无格式错误。

## 继续条件

本Task闭合后停止并向开发者报告。未经新的明确批准，不创建A实现Task，不修改产品源码、依赖、lockfile、主题Spec，不执行push、PR、Issue/Project写入、合并、发布或部署。
