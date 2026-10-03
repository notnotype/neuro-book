# 项目与组件

NeuroBook 是主应用，文档站根目录的快速开始、教程、核心能力、Agent 和 Profile 页面都面向它。Monorepo 还包含六个自治项目；每个项目独立拥有源码、测试和工程文档，这里只提供稳定的用户入口。

| 项目 | 用途 | 入口 |
| --- | --- | --- |
| NeuroAgentHarness | 多宿主 Agent 运行内核 | [安装与公开合同](./neuro-agent-harness.md) |
| llmlint | 中文 LLM 文本检测与修复 | [安装与 CLI](./llmlint.md) |
| nb-history | Workspace 操作日志与文件历史 | [快速上手](./nb-history.md) |
| nb-workflow | 可重放的脚本式 Workflow | [Core 与宿主扩展](./nb-workflow.md) |
| nb-memory | 双时间轴叙事记忆框架 | [公开 API](./nb-memory.md) |
| nb-ui | Vue/Nuxt UI 组件与主题合同 | [使用方式](./nb-ui.md) |

安装和运行 NeuroBook 本身请从[快速开始](/quick-start)进入；仓库所有权和开发命令见 [Monorepo 布局](/monorepo)。
