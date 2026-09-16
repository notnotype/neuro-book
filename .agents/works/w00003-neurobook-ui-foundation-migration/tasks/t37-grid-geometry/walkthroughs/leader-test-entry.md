# 消费者测试入口接线

Leader核对t37把临时spike用例移到`app/components/workbench-spike/layout.test.ts`后，发现主应用Vitest include未覆盖该目录。
已机械加入workbench与workbench-spike两个组件目录测试入口，避免命令同时带另一个已包含文件时只跑部分用例而exit0。
最终验证须显式看到spike测试文件被执行；t37报告中的迁移前21用例不能替代迁移后的验证。

接线后独立执行`bun run test app/utils/workbench/layout.test.ts app/components/workbench-spike/layout.test.ts`，主应用worktree包cwd，exit0，2文件21用例通过（2026-09-16 11:35）。

当前其它消费者行为仍待t41独立审查，本接线不表示grid或主页面已经验收通过。
