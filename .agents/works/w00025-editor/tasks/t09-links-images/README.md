---
schema: nbook.task/v2
taskId: t09-links-images
status: active
updated: 2026-11-17
---

# 链接与图片的插入

## 目标与范围

插入图片（选文件、粘贴、拖入）与存放位置设置（t06 决定 4）；新建链接与图片写相对地址（方言 Spec 输出 18 的 planned 条目）；显示与外观归 t07

合同：[`workspace/markdown-dialect.md`](../../../../../docs/specs/workspace/markdown-dialect.md) 输出 18。来源：t06 决定 4、13。

## 当前状态

开发者 2026-10-16 定先搁置；2026-11-16 说“可以做 t09 t10 了”，开始设计。

### 决定

1. （2026-11-16）t09 现在就做，不等 w00046 t15（开发者：“t09 同意现在就做”）。范围：链接卡片、插图的“选本机文件”与“粘贴”、浏览器往作品里写图片的上传接口、图片存放位置的设置。**不做拖放**：从系统拖入（文件树、编辑器插图、书架）整个归 w00046 t15，它到时调 t09 的上传接口与插图函数；从资源管理器拖进正文也不做。上传接口按“单个文件写到作品里的某个地址”设计，与按地址读字节对称。同日按开发者要求给 w00046 的会话发了消息，说明这个分工；对方已记进 w00046 t15（`7e1da57d0`）。
2. （2026-11-16，评审板第 1 轮，四题都取推荐）链接卡片一行、只填地址，链接文字就是正文里选中的字，没选字时取文件标题或网址；改已有的链接时卡片预填地址、多一个“去掉链接”。
3. 插图走插图卡片（斜杠菜单“图片”与工具栏）：先列出存放目录里最近的图，打字找作品里的图，能粘贴网址，上传按钮选本机文件；正文里直接粘贴图片照常插入，不经卡片。
4. 粘贴、上传的图缺省存到作品根下的 `插图/`；设置照 Obsidian 四种（作品根、指定目录、与当前文件同目录、当前文件旁的子目录），跟着作品走。
5. 存成普通图片文件，不用 `.image` 文件夹。
6. 板上“不用答”的几条照做：地址相对当前文件；按住 Ctrl 点链接打开，单击仍是编辑；选的文件保留原名，粘贴的图按日期时间命名，重名加序号不覆盖；只收常见图片格式，上限 32 MiB。

### 现状与参照（2026-11-16 调研）

- 编辑动作：没有插入链接、插入图片的动作。工具栏与选区菜单留着链接按钮，命令 `nbook.edit.link` 登记了才出现（`markdown/web/components/menus/palette.ts`、`editor/shared/contracts.ts`）；`workbench/markdown-editing.md` 把“插入链接、图片与引用文件”列为不承诺。输入一行字的卡片只有注音、双语用的 `MarkdownTextPrompt.vue`。
- 粘贴与拖放：文档编辑器不处理文件与图片的粘贴、拖入；只有 Agent 输入框（`nb-markdown` 的 `PromptEditor.vue`）读 `clipboardData.files`。资源管理器拖行用自己的拖动会话，不走 HTML5 拖放，编辑器接不到。
- 图片显示：节点视图在 `nb-markdown/src/editor/image-views.ts`；地址按方言 Spec 输出 18 解析（`markdown/shared/targets.ts` 的 `classifyTarget`，`asset-urls.ts` 给 `files.rawUrl`）。
- 写文件：浏览器的 `files` 服务只写文本（`write`、`create`）；二进制只能经服务端的暂存与提交，浏览器能写字节的只有主题素材的 `PUT /api/nbook.files/theme-assets`（`workspace/files.md` 的“写主题场景素材”）。粘贴图片要新增一条上传接口，是后端改动。
- 设置：`defineSetting`（`editor/shared/settings.ts` 的 `autoSave` 是例子）。
- 旧应用：插入链接、图片用对话框输入地址、原样写；粘贴只取文字；上传到挂载根的 `upload/`。
- Obsidian：粘贴、拖入的附件复制进“新附件的缺省位置”：作品根（缺省）、指定目录、与当前文件同目录、当前文件旁的子目录（不在就建）。
- 相关的别的 Task：w00046 t15“从系统拖入文件、图片与文件夹”（planned，含 Markdown 编辑器插图，浏览器与桌面同一份 HTML5 拖放）；已接受的 [图像生成提案](../../../../../docs/proposals/image-generation-v1.md) 把书里生成的图定为 `.image` 文件夹（版本与 `image.json`），缺省放 `插图/`，正文怎么引用随 w00042 t09。

### 静态稿

第 1 轮：草稿与 t10 共用 `.worktree/w00025-t10-drafts`（不合并、不提交），Lab 组件 `LinkCardDraft`；评审板 [`artifacts/review/index.html`](artifacts/review/index.html)。问题 1 链接卡片填什么（一行只填地址、两行文字与地址），问题 2 插图从哪里进（插图卡片、直接选文件），问题 3 粘贴与上传的图缺省存到哪里，问题 4 存成普通文件还是 `.image` 文件夹。

## 下一步

设计已定。2026-11-17 开发者说“t09 可以开工”（并问上传接口做好了没有：没有，接口是本 Task 第 1 片）。Spec 已写（planned）：[`workspace/files.md`](../../../../../docs/specs/workspace/files.md) 的“写入图片”与场景 12，[`workbench/markdown-editing.md`](../../../../../docs/specs/workbench/markdown-editing.md) 输出 52–58 与场景 27–30。计划第一稿：[plan.md](plan.md)，末尾“待确认”七条等开发者看；开发者 2026-11-17 说“可以，没问题”（待确认七条都照推荐）。前后端分开做设计审查：后端部分原本交 omp，额度用完（429）改派 Claude Opus（阻断 1、重要 7、建议 6，[报告](evidences/design-review-backend.txt)），前端部分交 Claude Sonnet（重要 11、建议 4，[报告](evidences/design-review-frontend.txt)），逐条处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。计划改为第二稿（[plan.md](plan.md)）：上传写入改经 `projects://`、`find` 加可选的扩展名过滤、共用的类型判定改形状、插图能力用独立注入键、链接动作自己写范围、粘贴有占位与串行的时序；Spec 同步改过。第二稿末尾“审查后定下的几处”七条是我替开发者定的，开发者可改。

执行位置：`.worktree/w00025-t09-links-images`，分支 `feat/w00025-t09-links-images`。
