# t10 计划：内置表情包来源与星璃默认表情

## Context

开发者 2026-11-18 要一组默认表情包（[README](README.md) 决定 1 到 8）：主包 `lyra`（收近版 15 张、加白边）与 `lyra-chibi`（第一批 12 张），作为内置来源随应用分发，只读、可复制到我的，内置主创 Profile 默认只列 `lyra`；按文件夹名认包时我的优先于插件、插件优先于内置。

依据：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（“不承诺”里的内置表情包、来源、输出 1、7、13、14、19、25 到 37）、[`agent/builtin-profiles.md`](../../../../../docs/specs/agent/builtin-profiles.md) 输出 16、[`agent/resources.md`](../../../../../docs/specs/agent/resources.md) 输出 8（Agent 文档按包根找目录的现成做法）。

现状：Skill 的 `builtin` 来源在代码里是空根（`sourceRoot("builtin", null, false)`），应用还没有随包带资源文件的先例，只有 Agent 文档：源码在仓库、构建到 `dist/docs/`，打包时复制进 `<包>/docs/`，服务端从模块位置往上找包根（`agent/backend/docs-root.ts`）。桌面版用的就是 npm 包的内容（`scripts/desktop-payload.ts`），包里带上就都有。

排在 t09 之后：t09 的选择器按目录的来源顺序分组，这里加一种来源后跟着走。

## 技术选型

无新依赖。图片已是 512×512 透明底 WebP（每张 30 到 90 KB，两包合计约 1.7 MB）。

## 关键设计

### 资源：`packages/neuro-book/src/plugins/stickers/builtin/`

- `lyra/`：15 张 `<名字>.webp` 与 `stickers.json`（`title: "星璃"`、`description` 一句说是 NeuroBook 的看板娘、`stickers` 按聊天里常用的顺序列全部 15 项、都常用、不写说明）。顺序：开心、嘿嘿、比心、害羞、期待、惊讶、疑问、嗯、无语、烦、生气、委屈、大哭、困、偷看。
- `lyra-chibi/`：12 张与清单（`title: "星璃 · 半身"`，都常用）。
- 图与清单入库；原图、切格与抠图脚本留在本地 `.local/brand/mascot/stickers/`，[`brand/mascot/README.md`](../../../../../brand/mascot/README.md) 加一行说明出处与做法。

### 找内置目录：`stickers/backend/builtin-root.ts`

- 照 `docs-root.ts`：从模块位置往上找包根，候选 `<包>/stickers/`（打包后）与 `<包>/src/plugins/stickers/builtin/`（开发与源码运行）；都没有为 null，目录不出内置包、写一条诊断 `stickers.root-unavailable`。测试用起点参数模拟两种布局。
- `scripts/pack-app.ts`：把 `src/plugins/stickers/builtin/` 复制成 `<包>/stickers/`，`files` 加 `stickers/`；`pack-app.test.ts` 断言包里有它。

### 目录：`stickers/backend/catalog.ts`、`plugin.ts`

- `StickerSource` 加 `"builtin"`；`plugin.ts` 开目录时多一个根 `{key: "builtin", source: "builtin", prefix: "builtin", root, watch: false}`。
- 只读：服务端的写入入口（`editor.ts` 的 `not-user-pack`）与 `reveal.ts` 已按 `source !== "user"` 判，不用改；页面 `StickerPacksPage.vue` 的 `pluginPack` 按 `source === "plugin"` 判，改成 `source !== "user"`；`stickers://` 的写入已对全部来源拒绝。逐处搜 `"plugin"` 核对，不漏。
- 按文件夹名认包的优先级（决定 8）：抽一个共用函数 `packByFolder(packs, folder)`：候选按来源分级 user > plugin > builtin，取最高一级；这一级里不止一个是认不出。浏览器的 `findSticker`、服务端的取图与 `stickers://` 不受影响（按 id）；槽与选择器的写法规则统一成“写文件夹名；按文件夹名认不到这个包时写 id”：改 `stickers/shared/writing.ts` 的 `writingSegments`，槽（`agent/backend/stickers/extension.ts`）与浏览器目录（`backend/browser-catalog.ts`）都用它，不用另改。复制到我的之后：我的 `lyra` 写 `:lyra/…:`，被盖住的内置包写 `:builtin.lyra/…:`；主创白名单仍是 `builtin.lyra`，槽里那段随之改写成 `:builtin.lyra/…:`（决定 8 的“提示词里也写 `:lyra/…:`”指我的那一份）。
- 浏览器的 `findSticker`（`web/resolver.ts`）的按文件夹名认包改用 `packByFolder`；`packByFolder` 放 `stickers/shared/`，与 `writingSegments` 共用分级。已知限制：浏览器目录按预算整包丢弃时（输出 18），在浏览器里按文件夹名认包看的是截断后的目录，我的同名包被丢掉时会认成内置的；预算是 5000 个表情，不另处理。

### 界面

- 分组：表情包页（`web/pack-view.ts`，现在只认 `source === "plugin"`，内置的会掉出分组）、Profile 设置的表情包一节、选择器（`web/picker.ts` 的 `pickerGroups`，现在把非用户的都按插件名排，内置的要单独排最后）都按我的、各插件、内置。
- 表情包页与 Profile 设置的表情包一节：分组顺序我的、各插件、内置（同 Skill 页）；内置的包同插件的包：只读、“复制到我的”、“在文件夹中显示”、能导出。复制到我的包名沿用 `lyra`（我的没有同名时），复制后旧写法显示我的那一份。
- 组头文字“内置”，中英两份。

### 内置主创：`agent/backend/builtin/profiles/main.ts`

- 声明加 `stickers: {allowed: ["builtin.lyra"]}`；模板在合适位置摆 `<Slot name="stickers" />`，升 `version`（`docs/standards/prompts.md`）。

## Spec 与文档改动

- `agent/stickers.md`：“不承诺”去掉内置表情包；术语里来源加 `builtin`（id `builtin.<文件夹名>`，应用自带，不监视）；输出 1 加内置根；输出 7 与 14 改成分级规则；输出 13、19、25、26、32、37 补内置的那一份；验收加 13（全新的状态根开主创会话，槽里列 `:lyra/…:`，回复里显示成图；复制到我的之后同一写法显示我的那份）。
- `agent/builtin-profiles.md` 输出 16 旁补主创的表情包白名单与槽。
- `brand/mascot/README.md`：表情包的出处一行。

## 切片

1. 资源与找目录：图与清单入库、`builtin-root.ts`、打包复制。验证：`bun test` 找目录的用例、`pack-app.test.ts`。
2. 目录与优先级：来源、只读判断、`packByFolder` 与写法规则。验证：`stickers.test.ts`、`stickers-slot.test.ts`、`web/resolver.test.ts`。
3. 界面与主创：分组、按钮、文案；主创声明与槽。验证：`sticker-page.dom.test.ts`、`profile-page.dom.test.ts`、`builtin-profiles.test.ts`。
4. 收口：e2e、实现审查（目录与优先级是后端，派 omp；界面派 Sonnet），Spec 晋升。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 来源与找目录 | `builtin-root.test.ts`（两种布局与都没有）、`pack-app.test.ts` |
| 输出 7、14 的分级 | `stickers.test.ts`、`stickers-slot.test.ts`、`web/resolver.test.ts`：我的与内置同名、两个插件同名、插件与内置同名 |
| 只读与复制 | `stickers.test.ts` 的写入拒绝、复制用例；`sticker-page.dom.test.ts` 的按钮 |
| 验收 13 | `stickers.e2e.ts` 加一条 |

## 验证

- e2e：`stickers.e2e.ts`、`sticker-packs.e2e.ts`（分组与只读按钮变了）。
- 未验证：桌面安装包里的路径（只核对 npm 包的内容，桌面载荷用同一份）。

## 不做与风险

- 不做：Skill 的内置目录（同一套找目录的做法以后可以复用，不在这里改）；表情的说明文字（名字够用，以后按模型的表现补）。
- 风险：仓库多 1.7 MB 的图；以后换图会继续涨，换图时整包替换、不留旧版。
- 风险：“我的优先”让用户的同名包悄悄盖住内置的；这是开发者定的（决定 8），Spec 写明，表情包页内置那一组的这个包标“被我的同名包盖住”。
