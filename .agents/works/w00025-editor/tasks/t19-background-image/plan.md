# t19 实施计划：背景图片与护眼底色

## Context

- **为什么做**：开发者 2026-11-05 提出：需要背景图片（自定义壁纸）与护眼模式，也借此验证编辑器的可访问性。
- **开发者已定**（2026-11-05）：背景有多种，现在有两种：正文（编辑器区）与整个窗口；图片之外再给几个纯色底。
- **依据**：[插件的数据与状态](../../../../../docs/proposals/plugin-data-model.md)（图片是 `user://backgrounds/` 下的文件，配置记引用、透明度、填充方式）；[nb-ui 表面模型](../../../../../docs/proposals/nb-ui-surface-model.md)（面板叠在照片上读不了的教训）；`design-language.md` 的“六、无障碍”。
- **工作方式**：worktree `.worktree/w00025-t19-background-image`，从 master 拉。Spec 与记录在主工作区改。

## 关键设计

设计审查（[前端](evidences/design-review-frontend.txt)、[后端](evidences/design-review-backend.txt)、[逐条处理](evidences/design-review-disposition.txt)）后重写。遮罩与模糊的取值等开发者答复评审板的 `r2-legibility`，下面按推荐（都给）写。

### 1. 设置：`workbench/shared/contracts.ts`

用户层（`layers: ["user"]`），所有作品共用。两份严格的 TypeBox 判别联合，对象拒绝额外字段：

```ts
const image = {
    kind: "image",
    image: string,        // 正则：^user://backgrounds/[0-9a-f]{64}\.(png|jpg|webp)$
    fit: "cover" | "contain" | "repeat",
    blur: boolean,        // 缺省 true
    scrim: number,        // 75–100，缺省 85
};
nbook.workbench/background.editor: {kind: "none"} | {kind: "color", light: "#rrggbb", dark: "#rrggbb"} | image
nbook.workbench/background.window: {kind: "none"} | image
```

手改设置文件写出的不合法值由 schema 拒绝。以后加别的种类就加一个设置项。两种可以同时开。文件不见或解码失败是运行状态：记诊断、退回没有背景、设置页显示原因，不改写设置。

### 2. 可读性：`packages/nb-ui/src/colorway/`（新 `background-legibility.ts`）

比值之外还有纹理：实测高细节的图上清晰 75% 读不动，已接受的表面模型提案也走查出大面积要 92%。

- **模式下限**：模糊开 75，模糊关 92。
- **角色下限**：纯函数按配色算，最坏情况是纯白或纯黑的图：主文字、次要文字、链接、高亮正文都要不低于 4.5。实际下限取两者中较大的。设置里的值低于它时只在显示时抬高，不改写设置；设置页的滑块从它开始。下限因此由配色决定，不是应用里的常量。
- **弱化文字**（`--text-muted`）没有图时也不到 4.5（nbook 暗色 4.22）：验收标准是不低于它无图时的值。
- **纯色底**：亮暗各存一个。校验主文字、次要文字与链接都不低于 4.5，不合格不应用并说明原因（错误信息不算说明文字）。预设都要通过，第 1 轮的豆沙绿上链接只有 4.28，要调。
- **无障碍偏好**：`prefers-reduced-transparency`、`prefers-contrast: more`、`forced-colors` 下不画图片，退回主题的实心面。

### 3. 怎么画

变量不在子作用域里覆盖：派生变量（`--shell-ground`、`--editor-tabs-surface`）在 `:root` 已求值，写自引用还会成环。计算好的面色作为字面量写在文档根，派生变量跟着重算；写入归 `WorkbenchDocument.vue` 现有的主题写入。

- **正文**：画在编辑组的内容区，标签条与面包屑之下。一层图（模糊时是 `filter: blur` 的独立层）加一层面色遮罩。Markdown 与源码编辑器透明透出，图片查看器与 HTML 预览不透出，它们不是长文。工具栏通栏时在图上；并入面包屑时在实心行里；底部浮条有自己的面。图按组定位，不随正文滚动，拖分隔条时按新尺寸重排。`contain` 留边露面色。
- **整个窗口**：`.workbench-shell-layout` 铺图。标题栏、状态栏目前透明，这时要有面。外层卡片用新变量 `--shell-card-surface`（缺省就是 `--panel-surface`），编辑组里叠的 2 到 3 层改透明，否则不透明度相乘，图看不见。其余层级轴的面保持不透明；`--panel-surface` 的 37 处消费方实施前逐个清点，例如图片查看器的透明格。
- 同时开时正文的盖在窗口的上面。
- **Monaco**：`editor.background` 与 `editorGutter.background` 带透明度；吸顶行给实心底，否则字叠字；整行高亮改半透明；`hex()` 读带透明度的颜色时不能退回不透明色。它画的是 `--bg-main`，对比度按它算。真透不出来就回来问开发者，不自己缩范围。

### 4. 图片怎么进来：`files`

现在浏览器写不了二进制。沿用封面上传（`projects/backend/cover-routes.ts`）的做法：

- `PUT /api/nbook.files/backgrounds`，请求体是原始字节，并入 `nbook.files` 现有的 `http.routes`，经统一的 Host、Origin 检查与准入。
- 上限 20 MiB（20,971,520 字节），接收时限长（`hono/body-limit`，不看请求头），超限 413。
- 白名单 PNG、JPEG、WebP，按字节判定（复用封面的判定），不信文件名与 `Content-Type`；SVG 拒绝。动图不检测，不承诺。
- 文件名由服务端算：`<sha256>.<规范扩展名>`。整份在内存里算哈希（上限内有界），再经现有 `WorkspaceFiles.write` 提交，所以暂存、记账与变更都走现有链路，不另写磁盘。写入归属保持 `{kind: "system", plugin: "nbook.files"}`，写进 Spec。
- `backgrounds` 必须是真实目录：是符号链接时拒绝（现有检查只保住整个 user 根，链接会把文件写到别的目录）。
- 已存在时核对摘要：相同就返回同一地址，不发事件、不记账；不同报冲突，不覆盖。
- 显示用现成的 `/api/nbook.files/raw/user/…`，它的 `nosniff`、CSP sandbox、跨站拒绝照旧。

### 5. 设置页：`settings.pages`

左栏独立一项“背景”（`settings.pages` 是分区，不是“外观”里的一页）。两种背景各一块：无 / 纯色 / 图片；图片有填充方式、模糊开关与遮罩滑块。滑块松手才写设置。预览与真实渲染共用一个组件。图片加载失败要预加载才发现，显示原因。除错误与状态外没有说明文字。

## Spec 与文档改动

| 文档 | 改什么 |
|---|---|
| `docs/specs/ui/backgrounds.md`（新） | 设置、可读性下限、画在哪里、无障碍偏好、失败与恢复 |
| `docs/specs/workspace/files.md` | 写字节的路由 |
| `docs/specs/theme/system.md` | 背景遮罩怎样改表面变量 |

## 切片

| 片 | 内容 | 验证 |
|---|---|---|
| S0 | Spec | `docs:check`、`governance:check` |
| S1 | 写字节的路由 | 真实文件服务的合同测试：类型、大小、路径越界 |
| S2 | 设置与计算（对比度、下限） | 单元测试 |
| S3 | 正文背景（含 Monaco） | e2e，四组合取证 |
| S4 | 整个窗口 | e2e，四组合取证，加 390px |
| S5 | 设置页 | e2e：选图、调遮罩、改纯色、重启后还在 |
| S6 | 收口 | 可访问性取证、实现审查（Sonnet）、`test:affected` |

## 验证

- **可访问性**：e2e 用纯白、纯黑与高细节三张图，在 nbook、macos × 明暗下，隐藏文字后量正文、次要文字、链接、面包屑、标题栏、状态栏与侧栏的背景，算最差对比度。先有正向对照（图确实画出来了），否则会空过。标准按第 2 节的角色。
- **人眼**：比值之外，长文在下限与缺省值下的截图给开发者看一次。
- **无障碍偏好**：三个媒体特性都模拟，沿用 `packages/nb-ui/e2e/dialog-surfaces.spec.ts`。
- **上传**：真实文件服务的合同测试：假 MIME 的真 PNG、SVG、截断头、无 `Content-Length` 的超限流、客户端断开、重复上传、两个窗口并发同内容、预占的坏文件、`backgrounds` 是根内链接、根外链接、悬空链接。

## 不做与风险

- 不做：按作品分别设置；书架页与独立页面的背景；视频；模糊强度的设置。
- 风险：`--panel-surface` 消费方多，窗口背景可能打穿依赖不透明的地方；实施前清点，只动外层卡片。
- 风险：`filter: blur` 铺满大图有绘制成本，拖分隔条时量一次，不够就预先缩小图。
- 风险：别的会话在改布局（w00026 的 nb-layout），外壳的 DOM 可能变；合入前跟上 master。

## 开发者已确认（2026-11-05，全部按推荐）

1. **遮罩下限 75%**：开发者确认时依据的“保证任何图片都读得清”说过头了，已说明并在评审板第 2 轮 `r2-legibility` 重新问。
2. **设置是应用级的**：所有作品共用一套。推荐。按作品分别设置以后能加。
3. **源码编辑器（Monaco）也透出**：正文背景连带它。推荐，否则切到源码时背景消失，很突兀。
