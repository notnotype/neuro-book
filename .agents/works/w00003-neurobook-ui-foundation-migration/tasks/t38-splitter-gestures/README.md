---
schema: nbook.task/v2
taskId: t38-splitter-gestures
---

# Splitter 用户手势边界

**当前状态：** 补修已完成，[t39最终独立审查](../t39-splitter-review/walkthroughs/review-final.md) 建议合并。Leader独立复跑32聚焦用例通过；组件全包、正式typecheck、确定性CSS和真实浏览器门禁由Leader统一收口。旧裁定仅保留修复历史。

Work：[w00003](../../README.md)；[计划](../../storage-implementation-plan.md)切片3。
合同：[ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)的用户调整边界。

## 结果与独占范围

nb-ui Splitter 在保留既有 layout 事件的同时区分用户调整 start/update/end 与取消，供宿主一次保存最终意图。
拥有 `packages/nb-ui/src/components/layout/Splitter.vue`、新增同目录 splitter 手势helper/测试及同名文档；
必要的 barrel类型导出、SplitterFixture与聚焦浏览器用例、UI规范相关短节由本Task拥有。
并行 t37 拥有 grid.ts/快照/主应用消费者，不编辑这些文件。后续Task接 WorkbenchBranch，不在此接 Storage。
不开新代理、不联网、不提交/push，不操作真实用户数据。当前用户授权包含隔离自动化浏览器验收。
用户的 `http://localhost:3001/` 已运行，禁止占用、复用、重启或关闭该服务。
若启动验收，使用独立空闲端口；主应用必须在系统Temp显式分配独立State Root/Workspace Root和浏览器数据目录，不继承默认data。
纯nb-ui playground不应启动产品服务；配置若默认reuseExistingServer，须改用本次显式宿主，不借用不明服务。

## 实现与验收

1. 先读安装的 Reka Splitter 源码、实际 props/emits与键盘实现。复用它的拖动事实和布局计算，不实现第二套拖拽算法。
2. 事件带本次手势来源、稳定 panel ids、主动 sash/节点与最终 sizes；说明哪些字段为主动改变、哪些是兄弟空间补偿，避免把所有变化当偏好。
   baseline 在用户开始时捕获；一次mouse/pointer操作一次结束；键盘连发跨多个keydown只结束一次，keyup或blur结束。
   方向键/Home/End/Enter等只覆盖Reka实际支持的调整键；普通导航不开始手势。
3. 程序 mount/layout、default/min/max变化与viewport重算仍可发layout，但不能发用户提交。
   Escape、pointercancel、卸载、panel身份/方向/禁用变化取消当前手势，取消不产生保存意图；空操作无需提交。
   监听资源按实例清理，多个/嵌套Splitter不串手势。Reka autoSaveId现有公共能力可以保留，本工作台不用它。
4. 用实际组件+Reka测试鼠标、键盘repeat/keyup/blur、取消、外部layout、禁用、嵌套与卸载清理。
   DOM环境无法提供实际布局测量时记录限制，并用真实浏览器聚焦用例补齐；不可仅测假emit或helper冒充集成。
5. 文档写清事件合同与两个使用层次（既有layout渲染，新gesture提交）。不扩大视觉设计、不引入新依赖。

先在 `walkthroughs/implementation.md` 写进行中；15分钟内留下可核查代码/测试。报告真实命令、结果、未运行项和主Agent接线所需事件API。
只跑聚焦用例，统一 nb-ui/typecheck/build由主Agent在两Task结束后执行；CSS若变化在报告注明，主Agent负责连续两次构建的确定性验证。
