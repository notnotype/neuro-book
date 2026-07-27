# Task 112：ComfyUI 生图插画（小说 + RP 正文引用生图）

## 用户需求

参考开源项目 [comfyui-good-anima](https://github.com/ShiroEirin/comfyui-good-anima)，为小说系统与 RP 系统增加生图辅助：

1. 在文本阅读界面通过「引用」（选中文字）发起生图请求，引用文字经处理后发给本地 ComfyUI，回传图片插入正文形成插图效果。
2. 独立悬浮面板：调控生图参数、查看生图进度。
3. ComfyUI 连接配置放在「配置中心」，支持测试连接。

用户确认的关键决策：

- **通信方式**：Nitro 后端直连 ComfyUI 原生 API（`POST /prompt`、`WS /ws?clientId`、`GET /history/{id}`、`GET /view`、`GET /system_stats`），不依赖 comfyui-good-anima 的 `comfyui-skill-cli`（Python/Alpha）。`ws@8.19.0` 已在依赖中，本任务是仓库内首个出站 WS 使用者。
- **提示词处理**：LLM 蒸馏——中文选段 → 英文提示词（Anima 是 danbooru 标签 + 自然语言混合风格，见 [模型卡](https://huggingface.co/circlestone-labs/Anima)），结果填入面板供手改。
- **范围**：Markdown Studio（TipTap 选区）与 RP 正文面板（自建选区浮层）都支持。
- **工作流**：内置通用 txt2img 模板 + 配置中心可导入自定义「导出 API」JSON，自动识别注入点，可手改 `nodeId.field` 映射。

## 架构

```
正文选区（TipTap BubbleMenu / RP selectionchange 浮层）
    → comfy-ui store（引用文字 + 插入目标）→ 悬浮面板 ComfyUiIllustrationPanel（DialogWindow）
    → POST /api/projects/comfyui/distill（LLM 蒸馏，tracedStreamSimple + health-check trace bucket）
    → POST /api/projects/comfyui/jobs（job-manager 状态机：pending→running→downloading→completed/failed/cancelled）
        ├─ workflow-template：内置模板 / 用户工作流 + mapping 注入
        ├─ client：/prompt /history /view /interrupt（fetch + 超时）
        ├─ ws-listener：单例出站 WS（懒连接、指数退避、二进制帧丢弃、空闲 60s 关闭）+ history 轮询兜底
        └─ illustration-store：图片落盘 <project>/assets/illustrations/（魔数校验 + recordUploadedFiles + 索引失效）
    → GET /api/comfyui/jobs/events（全局 SSE：jobs_snapshot / job_update / heartbeat）→ 前端进度
    → 插入正文：
        ├─ Markdown：insertMarkdownAt(选区末尾, "![alt](相对路径)")（新增编辑器 API）
        └─ RP：POST /api/projects/rp/insert-illustration（prose.md 锚点四级降级匹配，409 → 用户确认追加）
    → 展示：GET /api/workspace-files/raw（魔数定 Content-Type + ETag/304）
        ├─ TipTap Image 扩展渲染层重写相对 src（序列化保持相对路径）
        └─ marked image renderer（resolveImageSrc 选项）
```

## 变更文件

**shared**：`shared/dto/comfyui.dto.ts`（新）、`shared/dto/config.dto.ts`（ComfyUiConfigDtoSchema）

**server 新模块 `server/comfyui/`**：`client.ts`、`ws-listener.ts`、`workflow-template.ts`、`user-workflows.ts`（存 Workspace Root `.nbook/comfyui/workflows/<id>.json`）、`job-manager.ts`、`illustration-store.ts`、`prompt-distill.ts`

**server 配置链**：`config/types.ts`、`config/normalizer.ts`（DEFAULT_COMFYUI，Global-only）、`config/registry.ts`、`config/config-service.ts`（redact 投影 + save 搬运）

**server 路由**：`api/comfyui/check.post.ts`、`api/comfyui/workflows/*`（CRUD）、`api/comfyui/jobs/events.get.ts`（SSE）、`api/projects/comfyui/{distill,jobs}.post.ts`、`api/projects/comfyui/jobs/[jobId]/cancel.post.ts`、`api/projects/rp/insert-illustration.post.ts`、`api/workspace-files/raw.get.ts`；`server/workspace-files/workspace-files.ts` 新增 `readWorkspaceBinaryFile`；`server/rp/prose-store.ts` 新增 `insertIllustrationAfterAnchor`（该文件从「只读」改为「插图是唯一受控用户写入口」）；`server/openapi/route-map.ts` 登记 + `generate:openapi`

**前端**：`app/stores/comfy-ui.ts`（新，非持久）、`app/stores/novel-ide.ts`（comfyUiPanelOpen 持久）、`app/composables/useComfyUiJobEvents.ts`（SSE + 退避重连）、`app/components/comfyui/ComfyUiIllustrationPanel.vue`（DialogWindow，生成中 busy 锁关闭）、`app/utils/workspace-image-url.ts`、`app/utils/markdown/render.ts`（image renderer）、`AgentMarkdownContent.vue`（resolveImageSrc prop）、`markdown-editor-extensions.ts`（WorkspaceImage 渲染层重写）、`TipTapMarkdownEditor.vue`（generate-illustration emit + insertMarkdownAt）、`MarkdownSelectionMenu.vue`（生成插画按钮）、`MarkdownStudio(.Workbench).vue`（事件透传）、`useMarkdownStudioController.ts`（insertMarkdownAt 门面）、`RpProsePanel.vue` + `RpProseSelectionOverlay.vue`（新）、`RpModeSurface.vue`（refreshProse expose + 事件透传）、`app/pages/index.vue`（面板挂载 + 两条入口接线 + RP 写回/409 确认）、设置面板 `NovelIdeComfyUiSettingsPanel.vue` + `NovelIdeComfyUiWorkflowSection.vue`（新）、`NovelIdeSettingsDialog.vue`（comfyui section 注册）、i18n `zh-CN.ts`/`en-US.ts`

## 关键决策

- **`enabled` 是服务端闸门**（关闭时 jobs/distill 返回 400），不做前端入口隐藏——避免为入口可见性加一条配置下发链路。
- Job 只存内存（最近 50 条）；持久产物是落盘图片与正文引用。进度 WS 为主、history 2.5s 轮询兜底、10 分钟看门狗。
- 图片 URL 重写只发生在渲染层（TipTap renderHTML / marked renderer），markdown 源码始终保存**项目相对路径**，项目可迁移。
- RP 锚点匹配四级降级：源码精确 → 剥 markdown 行内标记 + 忽略空白的归一化匹配（带偏移映射）→ 前 30 字符 → fallback（409 让用户确认追加到幕末）。occurrence 越界时容错取最后一次出现。
- 蒸馏复用 Pi runtime（照 `runPiModelSmokeCheck` 组装 + `tracedStreamSimple`），trace 记入 `health-check` bucket（mode=`comfyui-prompt-distill`）；provider 带 proxy 时与 smoke check 一致明确报不支持。
- 自定义工作流 JSON 存 Workspace Root `.nbook/comfyui/workflows/`（envelope 含 mapping 与导入 issues），不进 config.json。

## 验证结果

- `bun run typecheck`：**0 新增错误**；顺手修复 2 个既有错误（`prose-store.ts` heading 可空、`RpModeSurface.vue` proseMatch 可空）。剩余 26 个错误全部为本任务之前已存在（profile 测试 / world-engine.facade / WorldEngineStateOverview 等未触碰文件）。
- `bunx vitest run server/comfyui server/rp/prose-insert.test.ts server/config/normalizer.test.ts`：**4 文件 36 用例全过**，覆盖：
  - workflow 注入 / 内置模板 / mapping 越界 / 注入点自动识别（标准 KSampler、noise_seed 自定义采样器、conditioning 透传追溯、识别不全 issues）
  - **mock ComfyUI 服务器**（http + ws）端到端：连接检查在线/离线/非法地址、完整生命周期（提交→WS 进度→completed→图片下载→落盘 mock→SSE 事件）、`/prompt` 400 node_errors → failed、**离线连接拒绝 → failed 且错误友好**、取消（/interrupt + 幂等）、执行失败（CUDA OOM）透出
  - RP 锚点：精确/归一化（加粗剥离）/occurrence 重复文本/末段/找不到 409 + append fallback/路径注入拒绝/alt 清洗
  - normalizer：comfyui 默认值、partial 覆盖、非法值回落、Global-only
- 既有测试回归：`server/config server/rp shared` 18 文件 114 用例通过；`config-service.test.ts` 57 例失败为**环境问题**（测试 helper 需创建 symlink，Windows 非管理员 EPERM），与本任务无关。
- `bun run generate:openapi`：52 路由更新 0 失败。

### 浏览器 UI 自测（dev server + CDP，已执行）

- **配置中心**：ComfyUI section 完整渲染；「测试连接」离线返回「无法连接 ComfyUI(http://127.0.0.1:8188)：fetch failed」；开关+保存成功，editor-snapshot 回读确认落盘。
- **Markdown Studio**：选中中文正文 → BubbleMenu「生成插画」→ 面板打开、insertTarget 正确；**真实 LLM 蒸馏成功**（deepseek-v4-flash）：「雪夜里少女撑着油纸伞独自走过石桥，灯火在河面上摇曳。」→ `masterpiece, ..., 1girl, black hair, red kimono, holding oil-paper umbrella, crossing stone bridge, night, snowing, lantern lights reflecting on river, ..., long shot`，前缀/负向拼装正确。
- **任务链路**：无 checkpoint 提交 → 400 内联错误；配置 checkpoint 后提交 → 面板显示「排队中 0% + seed + 取消按钮」→ 服务端离线收敛 failed；SSE 快照与实时 job_update 均写入 store（REST 直建任务经 SSE 自动进 store）。
- **持久化**：刷新页面后 comfyUiPanelOpen 保持、SSE 重连并拿到最新快照。
- **图片链路**：raw serve 200/304/404(不存在)/400(越界)；编辑器内相对路径插图重写为 raw URL 且实际加载；**编辑保存后磁盘仍是相对路径，无 raw URL 泄漏**。
- **RP 链路**：选中 prose 文字 → 浮动「生成插画」按钮出现 → insertTarget{tickDir, anchorText, occurrence} 正确；insert-illustration 写回锚点段落后（mode=anchored）；正文面板刷新后插图渲染并加载成功。
- 浏览器自测期间发现并修复 3 个问题：
  1. SSE 路由在 `send()` 前 `await push` 首帧导致响应挂起（h3 模式应先 send 后 push），改为 send 后 `setImmediate` 推快照；
  2. marked image renderer 的 `loading="lazy"` 在 RP 面板容器内不触发加载，移除 lazy；
  3. 蒸馏/提交失败原本只走会自动消失的全局通知，按前端错误出口规范改为面板内联 error state。
- 未覆盖（需用户本机环境）：真实 ComfyUI 出图、WS 实时进度条（mock 已测事件协议）。测试产物已清理（测试图片/RP tick/章节改动已还原，配置 checkpoint 已清空、enabled 保持开启）。

## 后续 TODO

- [ ] 真实 ComfyUI + Anima 模型端到端出图验证（需要用户本机 ComfyUI 环境）
- [ ] 生图面板 styleHint（风格提示）输入框（DTO 已支持，UI 未暴露）
- [ ] batch_size > 1 多图生成（当前固定 1，多图链路已兼容）
