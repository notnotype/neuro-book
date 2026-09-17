---
schema: nbook.task/v2
taskId: t58-markdown-studio-migration
role: tasker
---

# 编辑器工作区：源码与富文本视图

状态：实现与隔离验收完成。主代理以 Tasker 身份亲自实现关键链路，展示组件、文案、Lab 与展示测试由子代理配套；独立数据/视图审查发现的三项正确性问题已修复并复核通过。

## 结果

中央 EditorWorkbench 的通用标签/菜单外壳承载可注册编辑器：code 统一复用 Monaco 按 language 高亮，markdown 为 TipTap 富文本。实际主页面完成文件树打开、标签管理、视图切换、编辑、保存和错误恢复；HTML 仅源码。不改变现有正文 authority，不将正文或编辑器偏好迁入通用 Storage。

## 实施合同

- Config 的 editor.associations 与 editor.languageAssociations 分别选择视图与语言，内置 .md → markdown，其余可编辑文本 → code；Global 与 Project 按扩展名层叠。配置文件可由用户编辑并手动重新加载；已有标签不强制换视图。
- 配置 PATCH 未提交字段保持原值，提交空映射清除该层覆盖；未知 ID 显示诊断，非法结构明确失败且不改原件。
- 领域 store 保持唯一正文/buffer/dirty owner。旧 tab editorKind/viewMode 读取边界转换为 editorId 和 editorGroupId=main，不丢 dirty 正文。
- 工作面 generation、文档 documentId 和打开 activation token 为非持久身份。旧请求/旧视图回调不得污染新文档；切换前 flush；保存确认不能清掉后续输入。
- 保存失败、冲突、取消或保存中继续输入时不得强关标签。中央视图 blur 只 flush 不自动保存。
- 主代理负责公共合同、Config、文档生命周期、内核提取、视图宿主和 index.vue 集成。子代理负责受控外壳/文案及后续独立 Lab 配套，禁止并发修改核心文件。
- 移除旧双模式 wrapper/controller 和未迁提示；表单源码消费者迁到通用内核但不改变表单语义。

## 验证与安全边界

3001 为开发者保留：不用于验收、不停止、不重启。用户 dirty descriptors.ts 与 descriptors.test.ts 不编辑、不暂存。验收在系统 Temp 的独立源码、依赖、State/Workspace/Cache 根与独立浏览器 profile 中，使用其它空闲端口；不得复用 .nuxt 或写真实数据根。

每个增量由主代理运行聚焦行为测试、typecheck；最终完成 Lab all 与真实浏览器：JSON 原样保存、Markdown 防抖窗口切换、保存失败保留正文、Global/Project 覆盖与设置保存、HTML/未知/只读文件、跨项目迟到响应、批注引用/frontmatter 与源码表单、四主题桌面及390×844。不调用真实 Provider/Model。

授权含本地实现、隔离验证及绿色提交，不含 push/PR/合并/部署、真实数据迁移或历史暂存删除。首次执行身份核对：refactor/w00003-nb-ui-adoption，基线 5b3b1069，governance:context failures=[]。

## 交付

实施、红→绿过程、真实浏览器证据与未运行范围见 [实施记录](walkthroughs/implementation.md)。最终聚焦18文件166例通过，typecheck exit0，Lab all smoke exit0；仅逐文件本地提交，不含受保护用户改动、Temp产物或远端操作。
