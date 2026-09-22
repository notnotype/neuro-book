---
schema: nbook.task/v2
taskId: t43-project-storage-browser-smoke
---

# Project Storage真实浏览器与HTTP验证

**当前交付状态：第二稿完成并已按 R1–R9 真实运行通过（未提交）。** 证据：[返工证据](walkthroughs/rework-evidence.md)（命令/cwd/退出码/场景/隔离根/端口/未运行项）；
以 [Leader交接裁定](walkthroughs/leader-handoff-status.md) 与 [返工要求](walkthroughs/leader-rework-requirements.md) 为准，作者早期 implementation 记录已被返工证据取代。

收口前读取 [Leader首稿复核](walkthroughs/leader-first-review.md) 与 [Leader返工要求](walkthroughs/leader-rework-requirements.md)（R1–R9 逐项闭合，含 profile 内置于隔离根、同客户端跨 Project 隔离、shared 定义、精确磁盘断言、PageApi 生命周期、根归属校验与可读性）。
证据写入 `walkthroughs/rework-evidence.md`。

Work：[w00003](../../README.md)；依赖已提交t30与[t35](../t35-storage-project-browser/README.md)，不依赖并行t37/t38/t40。
补齐切片2尚缺的浏览器→HTTP→Project Storage磁盘证据，不能用旧user smoke冒充Project链路。
合同：[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)。

## 范围

- 新增 packages/neuro-book/scripts/smoke/storage-project-adapter.ts 及必要的同目录小helper/测试；在packages/neuro-book/package.json登记独立smoke入口。
- 参考 storage-value-adapter.ts / storage-host-identity.ts 的真实Chromium + esbuild产品浏览器模块 + ofetch + Node/H3宿主模式。
  不复制产品adapter、Storage服务或Project生命周期，不从头复制整个user smoke；若必须抽共享纯脚本helper，保持旧user入口行为，并聚焦验证。
- 服务端入口复用 server/storage/host.ts 的Project接口、project-storage-module和精确ready owner；参考 server/storage/project-scope.test.ts 的合法隔离Project fixture。
- 只读产品实现，发现产品缺陷给出复现留同Task报告，Leader分派修复；不扩大至主页面、命令系统、迁移或整页重构。
- 不编辑 app/utils/storage/README.md（t40 owner）、grid/Splitter及其文件、用户descriptors、Spec与Work。

## 隔离与执行

1. 禁止访问、复用、停止、重启或占用用户的3001服务。最小HTTP服务listen(0,127.0.0.1)，输出实际端口，不启动完整Nuxt或消费用户服务。
2. 用仓库test-support在系统Temp分配新的专用root，State Root、Workspace Root、Application Root、浏览器profile全部在该root内；动态import产品模块必须晚于环境注入。
3. Chrome已有可执行文件 C:/Program Files/Google/Chrome/Application/chrome.exe；Node运行Playwright，使用本次独立浏览器数据目录，不读取已有浏览器登录态。
4. 清理只针对本次创建、已经核验绝对路径位于专用临时root内的资源；报告使用过的根、端口与关闭结果。禁止删除任何旧临时根，尤其此前审批拒绝的storage-browser-MxfyHy。不创建仓库.tmp、不做宽泛递归删除。
5. 所有命令用当前worktree的绝对cwd。不要全包typecheck/build，Leader统一执行；脚本自身可用现有scripts类型配置核对并区分既有失败。

## 必须验证

- 有效精确ready A/B；无ready/错误publicId不签发，也不fallback到user。
- 真实浏览器Project context→bind→read/save/reopen，磁盘文件位于对应Project/.nbook/storage。相同owner/resource在A/B隔离。
- 同一浏览器两个标签共享客户端但独立访问生命周期；一个释放不撤销另一个。订阅观察确认值，陈旧CAS明确冲突。
- 关闭/撤销A后旧session与旧ready均拒绝新写；同路径重新打开新ready后显式重建能读回已提交值。不能在测试中手写generation绕过Project owner。
- 独立浏览器profile的local分区隔离；同data范围shared行为沿用已定合同，不宣称跨data同步。
- 明确区分最小HTTP宿主验证与完整Nuxt/Project UI验收，后者本Task不覆盖。

## 产物

先留walkthroughs/implementation.md进行中；完成后写真实命令、cwd、退出码、场景、隔离根/端口、浏览器异常/失败结果、未运行项。必要证据归Task/evidences。
不联网搜索、不开代理、不提交/push、不操作真实用户数据。退出提供明确结果，不能只句点。
