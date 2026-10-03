# Workspace 包规范

适用：`packages/**`。通用与 TypeScript 规则由 [`README.md`](README.md) 路由；当前包清单和迁移事实由最近的 `packages/AGENTS.md` 补充。

- 每个包定义 owner、公开 exports、依赖方向、包内验证和产品集成验证；实现通过包公开入口消费。
- 包不得反向依赖应用页面、应用特例、root-only runtime 或未声明的 sibling 源码。跨包依赖使用 workspace package 名与声明版本。
- 公开类型和运行期行为保持一致；Node/Bun、ESM/CJS 和平台假设写入包合同并由真实消费测试覆盖。
- 版本、许可证、包名和 exports 变化属于公开合同变更，先确认全部消费者与发布流程，再完整切换。
- 可复用逻辑留在包内，产品特有编排留在根应用；不要为单一根调用把应用职责下沉成伪通用包。

完成标准：包可用自身 typecheck/test/build 验证，依赖图无反向边，公开 exports 覆盖真实消费者且不泄露内部文件。