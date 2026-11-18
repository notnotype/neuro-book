---
schema: nbook.task/v2
taskId: t10-lyra-default-stickers
status: done
updated: 2026-11-18
---

# 星璃默认表情包：生成一组表情并随应用带上

## 目标与范围

用 image-gen 以 [`brand/mascot/master/canonical-lyra-nai45.png`](../../../../../brand/mascot/master/canonical-lyra-nai45.png) 为参考生成一组星璃表情，定画风与表情清单，并定下怎么默认带给用户。来源：开发者 2026-11-18 在会话里提出（“表情包可以用 /image-gen + brand/mascot/master/canonical-lyra-nai45.png 生成一组默认的”）。

合同：[`agent/stickers.md`](../../../../../docs/specs/agent/stickers.md)（内置来源、输出 1、7、8、13、14、18、19、25 到 27、32 到 35、37、39、41、副作用、失败表、验收 13）与 [`agent/builtin-profiles.md`](../../../../../docs/specs/agent/builtin-profiles.md) 输出 16，已晋升。

## 做法

- 服务：image-gen 的 `jiji` profile（OpenAI Images 协议，`gpt-image-2.6-sunburst`），`edit` 接口上传母版作参考。
- 提示词：Q 版贴纸、白色模切边、整张纯绿幕底（`#00FF00`），每张只换表情与动作一句。
- 抠图：本地脚本去掉绿幕（与四边连通的、或面积至少 30 像素的绿块；人物的青色宝石绿度低不受影响），边缘按绿度渐变透明并去绿溢色，裁到内容加 4% 边距，缩到 512×512 存 WebP。
- 原图、抠图脚本、批量脚本与对照图在本地 `.local/brand/mascot/stickers/`，不入库。

## 决定

第 1 轮评审板（v1，2026-11-18 答复）：

1. **构图收近**：选了“收近到头和手、表情更夸张”。附言：“这一版可以保留，我觉得还挺不错的。看看大图效果会不会更好”，第一批 12 张也留着，比一比大图（约 120 像素）的效果再定怎么用。
2. **白边留着**（对第一批而言）：图里画的模切白边保留。
3. **表情清单**：没有填，按推荐处理。
4. **带给用户的方式：内置来源**。照 Skill 的 `builtin` 给表情包加内置来源，图随应用分发，只读、可“复制到我的”，内置主创 Profile 默认能用。

开发者 2026-11-18 在会话里另给了自己跑的三张 3×3（`.local/brand/stickers-1.png` 到 `-3.png`，共 27 格）：“默认表情包可以用我跑出来的这些，都是 3x3 的可能清晰一些”。收近的这一版改用这 27 格，不再重新生成。

第 2 轮评审板（v2，2026-11-18 答复，都选推荐）：

5. **收近版挑 15 张**：1-1 生气、1-2 嘿嘿、1-3 疑问、1-4 惊讶、1-5 困、1-6 大哭、1-7 比心、1-8 嗯、1-9 烦、2-2 开心、2-5 害羞、2-6 期待、2-9 偷看、3-1 无语、3-6 委屈（编号是第几张 3×3 的第几格）。其余 12 格不进包。
6. **收近版加白边**：按外形补一圈白色模切边，同第一批。
7. **两个内置包**：收近版是主包 `lyra`（星璃），第一批 12 张是 `lyra-chibi`（星璃 · 半身）；内置主创 Profile 默认只列 `lyra`。

开发者 2026-11-18 在会话里定：

8. **同名文件夹我的优先**：按文件夹名认包时，我的 > 插件 > 内置，只有同一级里重名才认不出。“复制到我的”仍叫 `lyra`，复制之后旧写法显示我的那一份，提示词里也写 `:lyra/…:`。这改动 `agent/stickers.md` 输出 7 与输出 14 的同名规则。

9. **计划第 1 稿确认**：开发者 2026-11-18 在会话里问 t10 做好没有，并说“就用你选出来的那一套推荐的表情包就行”，按 [`plan.md`](plan.md) 第 1 稿与上面的推荐实施。
10. **复制出来的是另一个包**：设计审查问复制到我的之后主创用哪一份，开发者 2026-11-18 在会话里答：“不用这么复杂，复制到我的后应该就要换 id，不能叫做 builtin.lyra 了。注意一个原则：写下的是 id，没必要确保写下这个表情包的时候图片一直不变。”复制出的包是 `user.lyra`，主创白名单不跟着换；写法是引用，同名包出现、改名、删除后显示别的包的图可以接受。

## 当前状态

- 2026-11-18 第一批 12 张（开心、害羞、捂脸、思考、灵感、疑问、好的、困、委屈、生气、惊讶、喝茶）：image-gen 发了 14 次生成请求（另 2 张定画风的样图）。人物一致、抠图干净，28 像素的行内小图里分不出。
- 收近版：开发者给的三张 3×3 切成 27 格，rembg 的 isnet-anime 遮罩并上“明显不白”的颜色遮罩（符号不丢）、补实被围住的白色、去掉邻格切进来的碎块（个别格子按边设例外）。
- 第 2 轮评审板（v2）问：收近版挑哪 15 张与名字、收近版加不加白边、第一批怎么用（推荐两个内置包，主创默认只列收近版）。
- 切格与抠图脚本、原图与成品在本地 `.local/brand/mascot/stickers/`（第一批在 `out/`，收近版在 `v2/cut/`），不入库；定稿后成品随内置来源入库。

- 实施按 [`plan.md`](plan.md) 第 2 稿：设计审查（Sonnet，重要 5、建议 4）的处理见 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。
- 2026-11-18 合入 master：图与清单 4396b3e3d、代码 93535ca32、测试与 e2e 0d4f49ca0、审查修正 b3660c0ed、变更记录 45557038c；晋升核对时补测试 5cb3ec33c、3041b7bd2、34294928f。worktree 与分支已删。
- 实现审查（Sonnet，重要 1、建议 6）全部处理，见 [`evidences/impl-review.txt`](evidences/impl-review.txt) 与 [`evidences/impl-review-disposition.txt`](evidences/impl-review-disposition.txt)；第 3 条（改包名、删除对话框不提同名内置包）记为已知限制。
- 验证：typecheck；相关 bun 与 vitest 测试；e2e builtin-stickers、stickers、sticker-packs、sticker-picker、app-package 全过（sticker-picker 第一轮两条因补全里多出内置的同名“开心”定位不唯一，改成按我的包定位后重跑通过）。
- Spec 晋升逐句核对见 [`evidences/spec-check.txt`](evidences/spec-check.txt)，换模型复核见 [`evidences/spec-check-verify.txt`](evidences/spec-check-verify.txt)。

## 下一步

无。
