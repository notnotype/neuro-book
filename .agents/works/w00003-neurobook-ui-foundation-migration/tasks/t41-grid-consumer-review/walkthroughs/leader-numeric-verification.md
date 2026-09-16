# Leader数值复核

2026-09-16 12:37—12:38，使用当前worktree根绝对cwd、真实grid导出执行两个独立纯内存探针（无产品服务/浏览器/文件副作用），均exit0。

- `evidences/leader-grid-invariants.ts`：固定种子10000组可满足布局，横/纵轴、上下界、零权重、sash占用、兄弟反序结果一致、layout不改序列化意图均通过。
- `evidences/leader-grid-gesture-invariants.ts`：固定种子3000组合法分支手势，在有约束兄弟和不同容器尺度下完整目标可重现，横/纵轴均通过。

原执行为 `bun -e`；探针归档只改成与本文件位置相配的相对import，恢复时从worktree根运行 `bun <上述相对脚本路径>`。
这证明分配器与手势反解的数值不变量，不代替Vue消费者、嵌套结构、完整插件宿主或真实主页面验收。
