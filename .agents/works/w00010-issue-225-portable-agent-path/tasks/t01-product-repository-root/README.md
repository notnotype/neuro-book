---
schema: nbook.task/v2
taskId: t01-product-repository-root
---

# 修复 Product Agent Import Repository Root

## 目标

修复 Issue #225 的真实根因：Windows Portable Product 启动后的 Agent Profile Import 在未设置 `NEURO_BOOK_REPOSITORY_ROOT` 时访问不存在的 `globalThis._importMeta_.dirname`，最终把 `undefined` 传给 `path.resolve`。Product/Portable 必须把 Installation Root 作为显式 Repository Root 传入；Profile Import 缺少必要根时必须返回明确、可诊断的错误。

## 修改范围

1. 更新 Product Runtime 环境输入与构造（优先复用 `packages/neuro-book-contracts/src/product-runtime/environment.ts`）以及 Product start/command 的调用边界，明确区分 Application Root、Product Runtime Image Root 和 Repository/Installation Root。
2. 更新 `packages/neuro-book/server/agent/profiles/profile-dsl.ts` 的 Repository Root Import 解析：使用显式环境合同；保留路径 containment；删除依赖 Product bundle 缺失 `import.meta.dirname` 的隐式 fallback；缺少 Product 根时 fail closed 并给出明确错误。
3. 增加或调整最小聚焦测试：
   - Product environment 会向 Product 子进程传递正确 Repository Root，并保留 State/Cache/Node Path 合同；
   - `Import path="AGENTS.md"` 在显式 Product/Portable root 下读取正确文件；
   - Product bundle 生成的 import-meta shim 不再暴露会导致 undefined path 的回退；
   - 缺失 root 的 Product 场景不会出现 `paths[0]` 原始错误。
4. 如行为合同确实发生变化，同步现有 Agent Asset/Import 或 Product Runtime Spec；不新建第二份近义 Spec。

## 验收

- 红灯证据：当前 Product bundle 在不设置 `NEURO_BOOK_REPOSITORY_ROOT` 时，`leader.default` 首轮 invocation 在 `pre_loop` 报 `The "paths[0]" property must be of type string, got undefined`；该证据已由 Issue 诊断记录，不要求在实现后重复制造错误。
- 绿灯：聚焦 Product environment、Profile DSL/Import 和 Product bundle 测试通过。
- 运行时：重建当前 Windows Product/Portable 载荷，使用真实浏览器/API 发送一条无敏感文本；Profile Import 不得在路径阶段失败。没有真实 Provider 时，允许后续在 `model` 阶段报告连接错误。
- 发行边界：测试运行不依赖仓库 `NODE_PATH`，Product 不回退读取开发机 checkout 的 `node_modules`；Portable Repository Root 指向 Installation Root，不指向 State Root 或 `.output`。
- 所有受影响调用方切换到同一环境合同；不保留 alias、静默 cwd fallback 或并行的旧 Repository Root 入口。

## 修改边界

不修复 Manager `yaml`/`semver` external 依赖发行闭包；不改变 Agent Import 允许路径集合、Profile DSL 公共 API、Reference/Install Root 所有权、Provider 配置或真实模型调用；不修改远端 Issue/Project/PR，不 push、合并、发布、部署或删除数据。浏览器人工验收属于独立受限动作，须另行明确授权后执行。

## 继续条件

- 如果实现需要改变 Portable Source archive、Manager manifest 或安装身份语义，停止并向 Leader/开发者报告选项，不在本 Task 内自行扩大。
- 如果要修复 Manager 缺包或 shadow workspace integrity 问题，另建 Task/Work，不混入本 Task。
