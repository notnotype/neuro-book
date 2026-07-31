# Artist Style Research

只在用户要求画师背景、画风特色、构图倾向、擅长内容时读取。不自动触发。

## 边界

1. Artist tag 有效性：只看 `danbooru-tags/bin/danbooru-tags.exe` 输出。
2. 有效画师：CLI 输出的 artist category `tag`。
3. Web 搜索用途：画师信息、别名、主页/账号、画风特色、常见构图、常画场景、擅长题材、内容倾向。
4. Web 搜索不得否定 CLI 已确认 artist tag。
5. "公开资料少 / 搜不到"不得转写为"tag 不存在 / 不适合 Anima"。

## 检索词

1. Web 查询词：canonical `tag` 去掉开头 `@`。
2. 禁止用 `prompt_tag` 搜索。
3. 搜索词示例：`lily_(shio1006)`、`momoiro_lettuce`。

## 样例隔离

1. 从画师样例或 booru post 元数据提取风格时，只输出画师研究结论。
2. 不得把样例 post 的角色、作品、服装、姿势、暴露程度或成人向标签自动并入 prompt。
3. 画师研究结论只写视觉倾向：线条、上色、主体距离、常见构图、背景复杂度、常见场景、擅长题材、光影和氛围。
4. 只看 tag/元数据时，标明"metadata-derived"。

## 输出

1. 画师 tag。
2. 检索词。
3. 来源类型：visual observation / metadata-derived / mixed。
4. 公开身份或主页；没有就写"未可靠命中"。
5. 线条、上色、主体距离。
6. 构图倾向、常见场景、擅长题材。
7. 光影和氛围。
8. 禁止迁移进 prompt 的样例内容。
