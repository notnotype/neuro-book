# t14 计划：书房工作态场景

## Context

书房（`nbook.theme-study.study`）有亮暗两张场景图，没有工作态场景：Agent 在运行时书房画面不变，而 t06 做的“按状态换场景”只在示例主题里演示过（t06 README，[`theme/skins.md`](../../../../../docs/specs/theme/skins.md) 输出 17）。书房现在是字段最全的参考主题，缺这一项。

t05 想重画书房时，两次图片请求被服务拒绝（HTTP 401、403：用的是 `gpt-image-2`、`gpt-image-2-high`，这把密钥没开通，不是分辨率问题），开发者当时决定不再生图。2026-11-06 开发者改了主意：工作态图可以用图片生成重新做，“上限 4 次、桌面忙碌版”（本会话提问，选了推荐项）。

## 已完成的素材（不收费部分之外的全部收费请求已用完）

- 请求账本：本地 `.local/agent/works/w00041-themes-and-backgrounds/tasks/t14-study-working-scene/ledger.txt`。**2 次请求**（亮、暗各 1 次，`bafang` 配置的 `gpt-image-2.5-1k`，`edit` 加现有原图做参考，1536×1024，直连不用代理，不重试），上限 4 次，没有用完；返回图一次通过目检，不重出。
- 提示词：同一个房间，同一机位，只改桌面：更多摊开的稿纸、几张皱纸、没盖帽的钢笔、一本摊开的笔记本、一杯冒热气的茶；夜晚台灯保持亮着。
- 本地处理：模型会让桌面以外的地方有细微漂移，所以只取桌面区域（`x≥905, y≥585`，边缘高斯羽化 14 像素）贴回书房现有的 `study-day.webp`、`study-night.webp`，其余像素与现有图逐像素差 ≤1（只是 WebP 重编码），空闲与工作中之间切换时整个房间不跳。结果 WebP：亮 98 KB、暗 76 KB，均低于 Spec 建议的 300 KB。原图、提示词与处理脚本留在本地，入库的只有最终 WebP。
- 参考图上传：把现有的亮、暗两张书房图作为编辑参考上传给图片服务（开发者同意重新生图，沿用）。

## 关键设计

### `packages/neuro-book/src/plugins/theme-study/`

- `assets/study-day-working.webp`、`assets/study-night-working.webp`（新增）。
- `plugin.ts`：`light.workingScene = "assets/study-day-working.webp"`，`dark.workingScene = "assets/study-night-working.webp"`；两张图与场景图构图对齐，`crop` 不动。
- 同一张图要裁给六个位置（`crop`），工作态图在那些位置的裁切与场景图相同，所以不另写。

## Spec 与文档改动

- `theme/skins.md`：输出 17 末尾或输出 11 里如果写了“书房没有工作态场景”，改为书房有；验收 17 的“书房”描述同步。
- `plugin-sdk/examples/README.md` 的 theme-study 一行加“亮暗各一张工作态场景”。
- `plugin.ts` 里 `STUDY` 的注释补一句：工作态图是同一张图的桌面区域换成了忙碌的样子，其余像素与空闲图一致。

## 切片

单片：素材 + 声明 + Spec/文档。验证：`bun test src/plugins/workbench/themes.test.ts`（书房声明里 `workingScene` 指向存在的文件，大小 ≤ 300 KB，与场景图同尺寸）；`e2e/themes.e2e.ts` 新增用例。

## 验收映射

- `theme.skins` 验收 17：`themes.e2e.ts` 新用例“书房的工作态场景”：用 Agent 会话进入运行态的做法（沿用 t06 的 `agent-conversation.e2e.ts` 里让会话进入工作中的写法），断言书房的场景变量从 `study-day` 换成 `study-day-working`，结束后换回，暗色同理；以及两张图在六个位置不超出可读性对比度（沿用书房的对比度用例对工作态再跑一遍）。
- 素材合同（尺寸一致、≤300 KB）：`themes.test.ts`。

## 验证

`bun run build`、`bun run build:e2e` 后只跑 `themes.e2e` 里书房相关的用例。给开发者看的：亮色 `nbdev shot` 书房空闲与工作中并排（欢迎页、正文两侧）。

## 不做与风险

- 不重画空闲图，不改 `crop`。
- 风险：工作态图的桌面区域与空闲图拼合处在窄屏裁切（正文两侧只露 118% 高度的一条）可能露出桌面，需要截图确认拼合边缘没有可见接缝；已有的 `themes.e2e` 对比度用例按图的颜色量，工作态图桌面更亮的纸可能影响右栏下角文字对比度，用例会报。
