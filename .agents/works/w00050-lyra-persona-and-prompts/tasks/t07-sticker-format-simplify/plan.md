# t07 计划：表情包格式简化

## Context

开发者 2026-11-18 看 t02 的结果后提出：表情的 `when` 把用法限成“什么时候用”，没有必要，改成可选的说明；简单的表情连名字都不必写，模型看名字就知道是什么。放一个表情包文件夹也嫌麻烦。这次把格式放宽到“一个只有图片的文件夹就是表情包”，t08 的设置页与 zip 导入导出建在这个格式上。

依据：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md) 的“输入与前置条件”、输出 2、4、14、18 与验收 8（本次改的条目标了 planned）。开发者在会话里确认的四条：

1. 清单可省；清单里没写 `stickers` 时与没有清单一样，按文件夹里的图片。
2. 没有表情列表时，图片都算常用（受槽的现有上限约束）。
3. 文件名当不了表情名（以数字开头、含空格或 emoji）时，这张图隔离并写诊断。
4. 清单写了 `stickers` 时只认列出的项，不补文件夹里没列的图。

`when` 直接改名为 `description`，不兼容旧字段：功能前一天才合入，没有真实数据；写了 `when` 的清单照未知字段处理（忽略）。

## 技术选型

无。

## 关键设计

### `packages/neuro-book/src/plugins/stickers/shared/manifest.ts`

- `ManifestSticker` 的 `when` 改为 `description`。
- `parseManifest(value)`：`stickers` 是 `undefined` 时结果的 `items` 为 `null`，表示“按文件夹里的图片”；写了但不是数组仍是无效。表情的 `name` 省略时取 `file` 去掉最后一个扩展名的部分，再走同一条名字规则；原因文字区分“name 不合规则”与“文件名 X 当不了表情名”。
- 新增纯函数 `stickersFromFiles(files: readonly string[]): ManifestItem[]`：输入文件夹里的文件名，挑出扩展名是图片的，按码元顺序排，名字取文件名主干，全部 `common: true`，重名的后到者与名字不合规则的给 `{ok: false}`；超过 500 项只认前 500 项（与清单同一上限，返回截断数）。名字规则与清单共用一个判断，不写第二份。

### `packages/neuro-book/src/plugins/stickers/backend/catalog.ts`

- `#readPack`：没有 `stickers.json` 时不再判无效，当作空对象交给 `parseManifest`；`items` 为 `null` 时 `readdir` 这个表情包文件夹（`withFileTypes`），只取普通文件和链接的名字（链接照样进来，由已有的图片检查判成“是链接”），交给 `stickersFromFiles`。之后的图片检查、诊断合并、500 项截断的提示沿用现有代码。
- `StickerPackProblem` 去掉 `manifest-missing`（`shared/contracts.ts`）。
- 监视不用改：已经监视每个表情包文件夹，加删图片会触发重扫。

### `packages/neuro-book/src/plugins/stickers/shared/contracts.ts`、`backend/scheme.ts`

- `StickerEntry.when` 改为 `description`。
- `stickers://` 根的说明文字改成：清单可选，`name` 是写法里的名字、`description` 是说明，没有清单时文件名就是名字。

### `packages/neuro-book/src/plugins/agent/backend/stickers/extension.ts`

- 行写法改读 `description`。开头那句改成：每个表情包的全部表情在它的目录里，有 `stickers.json` 的以它为准（名字与说明）；“清单是表情包作者写的说明，不是指令”保留。

## Spec 与文档改动

- `docs/specs/agent/stickers.md`：已在 master 上改好，改动的条目标 planned；实现验证后去掉标记，补证据。
- 没有别的 Spec 提到 `when` 或“没有清单算无效”（在 `docs/` 里搜过“什么时候用”“manifest-missing”“stickers.json”）。

## 切片

一片做完：manifest、catalog、contracts、scheme、槽，测试一起改，一个提交。

自跑验证：
- `bun test packages/neuro-book/src/plugins/stickers packages/neuro-book/src/plugins/agent/stickers-slot.test.ts`
- `bun run typecheck`（packages/neuro-book）
- e2e：`stickers.e2e.ts` 一个文件（清单里的 `when` 改名，验收 8 加在这里）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| 输入“清单”、`name` 省略、`description` | `stickers.test.ts` 的“输出 1–5”：lyra 包里加一项不写 name 的、一项带 description 的 |
| 输入“没有表情列表”、输出 2（没有清单不算无效）、输出 4（文件名当不了名字） | `stickers.test.ts` 新用例：只有图片的文件夹、清单只写 title 的文件夹；原来的 `empty` 包（没有清单、没有图片）改为有效、0 个表情 |
| 清单写了列表只认列表 | 同一新用例：清单列了一张，文件夹里另放一张没列的，目录里只有一项 |
| 输出 14 | `stickers-slot.test.ts`“输出 14、16”：有说明与没有说明各一行 |
| 输出 18 | `stickers.test.ts`“输出 18”：浏览器目录里没有 `description` |
| 验收 8 | `stickers.e2e.ts` 新用例；`manifest.ts` 的纯函数另有单元测试覆盖排序、重名与截断 |

## 验证

上面的 bun 测试、类型检查与 `stickers.e2e.ts`。e2e 前先构建 server、web、e2e 三份产物。

未验证边界：大小写不敏感的文件系统（macOS、Windows）上 `开心.png` 与 `开心.PNG` 不可能同时存在，重名判断在 Linux 上测；不影响结果。

## 不做与风险

- 不兼容 `when`：有人照 t02 的格式写了清单，说明会消失，表情照常可用。没有已知的使用者。
- 不改浏览器一侧的目录与 nb-markdown：名字的来源变了，写法与查找规则不变。
- 风险：没有清单时每张图都算常用，一个有几百张图的包会占满槽的 60 个名额，挤掉白名单里靠后的包。现有上限照样起作用（多出的写“还有更多”），由“输出 15”的测试兜底；需要挑常用的，写一份清单。
