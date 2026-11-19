---
schema: nbook.task/v2
taskId: t17-files-primitives-editor-state
---

# Files 排他原语与编辑状态可行性

## 目标与范围

执行已批准首版 Files 计划第二单元：先用自建 Temp/隔离页面证明无覆盖创建、复制及目录递归失败的真实结果；分别验证 Monaco 模型与 Tiptap/ProseMirror 编辑状态在 A→B→A 切换时保留选区和撤销历史、无需为每个文档永久保留 DOM。第一单元的性能预算见 [t16](../t16-files-baseline/README.md)。本 Task 不提前交付完整 UI、API 或产品启动链。

## 当前状态与证据

风险实验已闭合。隔离 Temp 目录 `C:/Users/USER~1/AppData/Local/Temp/neuro-book/agent/files-v1-OfeVX1/` 内执行 `node primitive-experiment.mjs`、`node primitive-race.mjs`、`node primitive-source-change.mjs`：Windows 上 `link(temp,target)`、`open(target,'wx')`、非递归 `mkdir(target)` 在预检后目标被占用时均返回 `EEXIST`，外部目标字节未改变；目录中 `a-created` 成功、`b-blocked` 冲突时，源与占名者仍存在；源复制后被外部改写，源/副本均保留并判为 partial。仅验证当前 Windows 文件系统，不冒称所有支持文件系统，也不提供任意外部进程对抗沙箱。

`platform.files` 现在只新增排他 `createFile` 与 `createDirectory`，原 `writeFile`、`mkdir`、`rename` 行为不变；`already-exists` 是确定失败。真实根行为测试先红（缺失方法），实现后 `bun run test -- server/features/platform-files/platform-files.test.ts` 19/19 通过，`bun run typecheck:runtime-foundation` 通过。`docs/specs/platform/files.md` 已同步新增合同：`createFile` 可能在写入故障时残留半文件，不得直接充当“完整副本发布”；复制须在后续单元补临时文件 + no-replace 发布、源复核与逐项报告。Node 原语参见 https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags 与 https://nodejs.org/docs/latest-v24.x/api/fs.html#fspromiseslinkexistingpath-newpath 。

编辑状态实验在隔离 Chromium 页面执行 `node C:/Users/USER~1/AppData/Local/Temp/neuro-book/agent/files-v1-OfeVX1/editor-state-experiment-EditorStateExperiment.cjs`，输出 `RESULT PASS`：Tiptap 3 `Editor.unmount()` 销毁旧 ProseMirror View 与 DOM，保留 A 正文、选区、撤销；`mount()` 到新 DOM 后恢复，B 与第二组 A 的历史独立。Monaco 0.55 单控件 `setModel(A→B→A)` 配合 `saveViewState` / `restoreViewState`，保留 A 的撤销、选区、滚动，B/第二组的模型独立。依据 https://tiptap.dev/docs/editor/api/editor#mount 、https://prosemirror.net/docs/ref/#state.EditorState 、https://microsoft.github.io/monaco-editor/typedoc/interfaces/editor_editor_api.editor.IStandaloneCodeEditor.html 。本仓 Vue `useEditor` 在卸载时会 `destroy()`，未来组级 owner 不得让组件自动销毁仍需的状态。项目自定义 Markdown 方言、评论、node views、Vue 重挂和长期释放尚未通过实验，不能把公开 API 小实验写成完整产品验收。

## 授权与边界

开发者批准计划内本地开发和独立临时根验收；实验仅在系统 Temp 自建文件执行，不修改或删除用户作品、不使用真实模型；不进行提交或远端写入。隔离服务为本 run 自建服务，未触碰已有服务。共享运行状态及测试规范见 [`docs/testing/README.md`](../../../../../docs/testing/README.md)。

## 下一步

建立真实文件读写精确 Project binding 纵向链，基础排他原语只作为下游构件。临时实验脚本及目录位于用户已要求保留的本 run 根；仓库无实验脚手架。对平台公开方法与其它受支持文件系统的验证随服务实现继续。两项 Files 合同仍为 `planned`。
