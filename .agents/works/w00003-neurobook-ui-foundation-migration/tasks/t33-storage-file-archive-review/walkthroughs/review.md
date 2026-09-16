# t31 / t32 独立审查

结论：**未完成验证**。

被审范围：工作区未提交的 t31（普通文件消费与资产同步边界）与 t32（归档与备份）两组改动，相对基线 `0d66064b`。
排除：t30 的 `server/storage/**`、`server/api/storage/**`、`shared/storage/**`、Project lifecycle/session/module；
两个 `app/utils/workbench/descriptors{,.test}.ts`（用户既有 dirty）。
审查方式：只读源码、测试与 diff；未执行测试或 typecheck（t33 Task 约定由主 Agent 统一跑），
因此凡涉及运行结果的判断在下面标明来源。

## 结论理由

代码侧未发现阻断缺陷：六个重点逐条核对后，生产边界、消费侧排除与归档/备份证据在实现上自洽。
但 **t31 在 current revision 没有任何已执行的聚焦测试证据**：

- `t31/walkthroughs/implementation.md` 的「命令与结果」一节写「见本轮最终报告」，而
  `t31-storage-file-boundary/` 下只有 `README.md`、`walkthroughs/implementation.md`、`walkthroughs/leader-findings.md`，
  没有最终报告，也没有 `evidences/`。该目录内没有任何命令、退出码或用例计数。
- t33 Task 明示「t31 首轮跑到无关 Project identity alias lock 测试失败，仍在独立归因，不把本审查视作其已通过」，
  且主 Agent 正在跑统一聚焦测试；即当前 revision 的 t31 通过性尚未被任何人声明。

按 Reviewer 合同，这属于「实现可能正确，但目标要求的证据缺失」。t32 不在此列：
`t32/walkthroughs/implementation.md` 记录了具体命令与 3 文件 14 用例通过，证据可核。

补齐后即可复核通过：主 Agent 的统一聚焦测试需给出 **t31 新增/修改测试文件在 current revision 的通过结果**
（`workspace-storage-boundary.test.ts`、`workspace-upload.test.ts`、`workspace-files.test.ts`、
`project-workspace-path-policy.test.ts`）与两项合并后的主应用 typecheck 结果。

## 逐项核对（重点 1–6）

1. **生产入口是否真调用保护** — 覆盖成立。
   mutation 路由 `create-file.post.ts`、`create-directory.post.ts`、`convert-file-to-directory.post.ts`、
   `rename.patch.ts`、`delete.delete.ts` 全部经 `tracked-workspace-files.ts`，六个包装函数在真实 fs 调用前调用 guard
   （`writeWorkspaceTextFileTracked:60`、`createWorkspaceFileTracked:80`、`createWorkspaceDirectoryTracked:96`、
   `convertWorkspaceFileToDirectoryTracked:126`、`renameWorkspacePathTracked:151-152`（from/to 双向）、
   `deleteWorkspacePathTracked:184`）；`write.put.ts:84` 在冲突检测读盘前；上传三个入口在 `writeWorkspaceUploads` 写盘前整批校验
   （`workspace-upload.ts:102-104`）。祖先、跨入受管位置、workspace-root 上层、内部链接、缺失目标均有判定路径。
   普通 `notes/storage` 不误屏蔽（`workspace-storage-boundary.test.ts:57,78,115`）。
   两条残留面见「残余风险」。
2. **file-index / watch / History 不消费 Storage** — 成立。`project-file-index.ts:439,547` 对 plain 目标改用
   `isWorkspaceStoragePath`；project 目标经 policy `consumer: "file-index" | "history"` 得 `ignore`；
   policy 仅被 `project-file-index.ts`、`project-history.ts:136` 与 `workspace-archive.ts:138` 三处消费，无遗漏消费者。
3. **资产同步不碰 Storage** — 成立且有真实证据。源枚举 + copy 循环 + 三个清理函数共 5 处提前 `continue`
   （`novel-workspace.ts:547,710,748,795` 与 `isManagedAssetBlacklisted:1202`）；
   `workspace-files.test.ts` 新增用例用真实目录 + 「旧 sync state 声称 `storage/records/shelf.json` 受管」的 fixture，
   断言记录字节不变、上游 `installed.json` 未安装、普通受管资产照常同步。这足以支撑结论。
4. **Project path policy** — 成立。新增 `storage` / `storage-runtime` 两类；正式记录、墓碑、原件、身份域元数据 archive 为
   `preserve`，file-index/history 为 `ignore`；`.locks`（`storage-address.ts` 常量）与 `isStorageTempFileName`（`record-codec.ts:62`）
   在三个消费者都是 `ignore`。Windows 大小写由 `comparable` 归一（`project-workspace-path-policy.ts:69`），
   与 `workspace-archive.ts` 的 `.nbook` 穿透比较同口径；`notes/storage` 仍为 `content/consume`。
5. **归档 preserve 快照** — 成立。`stagingRoot` 由 `mkdtemp(os.tmpdir())` 建立，不在归档根内，递归不会自吞；
   preserve 文件先 `copyFile` 到 `stagingRoot/preserved/<archivePath>` 再 `addFile`（`workspace-archive.ts:170-176`），
   规避 yazl 先 stat 后开流；异常路径 `removeArchiveStaging` + rethrow，流结束 `attachStagingCleanup`。
   测试用真实 ZIP、原子替换为不同大小值、断言 ZIP 内为完整旧版且源文件为新版（`workspace-archive.test.ts:206-228`），
   原件字节（含二进制）与墓碑 JSON 均有断言。未发现对原数据的写入。
6. **完整 data 备份** — 成立。`backup-archive-rules.ts` 只对两个正式 Storage 根排除 `.locks` 首段与模块临时名，其余一律保留
   （含 `quarantine/*.tmp` 这类未知原件）；`shouldExcludeFromBackup` 只被打包侧 `collectFiles` 消费，不改变恢复侧语义。
   `collectFiles` 仅对全新 Workspace 的根放行 ENOENT，子目录失败上抛；顶层可选文件同样只在 ENOENT 时跳过。
   证据为真实加密 envelope → 解密 → 解包断言条目集与内容（`backup-archive-service.test.ts` 新增用例），
   另有 EACCES 不得伪装缺失的用例。**已从安装副本核对 403 语义**：`node_modules/h3/dist/index.mjs:64-70`
   的 `createError` 对已存在的 Error 原样返回，`nitropack/dist/runtime/internal/error/prod.mjs:19` 读 `error.statusCode || 500`，
   而 `withProjectHttpError` 只映射已知 Project 领域错误、未知错误保持原对象（`project-http-error.ts:230-239`），
   所以 `WorkspaceStorageBoundaryError.statusCode = 403` 不会被降级为 500（源码读取，未运行）。

## 残余风险（不阻断本次合并判断，需 Leader/开发者决定）

1. **`workspace node new / state` CLI 未经 guard**。`workspace-command.ts:240` 直接调用低层 `createWorkspaceDirectory`，
   而 `resolveSingleWorkspaceTarget`（`workspace-command.ts:470,626`）不限制内容作用域，因此
   `workspace node new .nbook/storage/foo` 会在 Storage 根内创建 `foo/index.md`。
   触发场景：本机 CLI 显式把 Storage 路径当内容节点；影响：Storage 目录内混入非记录文件（不破坏记录读取，
   但违反「保留 Storage 服务的写入边界」）。t31 报告已披露该排除项，Task 也允许低层能力暂不引入运行期全局路径；
   建议后续给该 CLI 的 target 解析补同源判定，或在 Task 收口时登记为已知缺口。
2. **workspace-root 目标下对真实顶层目录的 mutation 一律 403，且文案是 Storage 独占**。
   `storageVerdict` 对单段地址返回 `ambiguous-project-dir`，`isMutationReachableStorage` 只按「是真实目录」判定
   （`workspace-storage-boundary.ts:83-104`），所以删除/改名任何 `<project>` 顶层目录都会抛
   `Storage 数据由 Storage 服务独占…`。若产品存在经 workspace-root 入口操作 Project 目录的路径，这是行为回归；
   若不存在（UI 删除项目走 Project lifecycle），仅是错误文案不准。我未追完全部调用方，需 Leader 确认；
   testcase 层面已用 `proj` 固定该预期（`workspace-storage-boundary.test.ts:103-105`）。
   另：workspace-root 上传单段文件名与已存在目录同名时，由原来的 `skipped` 变为 403，错误文案同样提到 Storage。
3. **user-assets 打包下载仍包含 user Storage**。`download.get.ts` 的 user-assets 分支走
   `createWorkspaceZipStream(target.root)`，该函数不带 policy，且 `.nbook` 下无 `.gitignore`
   （`readWorkspaceIgnoreRules` 只读 `<root>/.gitignore`，asset 目录未发现该文件），
   所以 `storage/records/**`、`identity.json`、`quarantine/**`，以及 `.locks` 与在途 `.tmp` 都会进入 zip。
   合同当前只规定「完整 data 备份」与「完整项目 ZIP」两行，未覆盖该下载；t31/t32 都明确将其排除在本轮之外。
   影响：用户下载的资产包会夹带锁文件与半成品临时名，并与「不把临时文件当正式记录」的口径不一致。
   需开发者决定是保持现状还是给该分支加 Storage 排除。

## 未运行

- 未执行任何测试、typecheck、浏览器或真实 data 操作；上述运行结论仅来自源码/测试文本与安装依赖副本。
- 未审查 t30 文件与两个 workbench descriptors；未核 t31 首轮 Project identity alias lock 失败归因。
