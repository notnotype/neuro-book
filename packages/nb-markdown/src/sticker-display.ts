/**
 * 按贴纸显示（docs/specs/agent/stickers.md 输出 47）：选中的表情包，它的表情在文字中间也显示成大图（高同只有表情的文本块里的大图，
 * 这一行跟着变高、底边对齐）。
 *
 * 宿主把这段样式表放进页面，不给元素加类：切换开关时已经画出来的表情（展示器、编辑器、输入框里的）不用重画就跟着变，绕开“已显示的
 * 表情不随目录重画”。尺寸规则只在这里写一份，宿主只决定哪些包要这样显示、样式表放在哪。纯 TS，不碰 DOM：宿主的浏览器入口在后端的
 * 类型检查范围里，也会在没有页面的宿主里激活。
 *
 * 选择器的特异性要压过 `stickers.css` 里行内小图的规则（`.nb-sticker.has-image` 的负外边距、`.nb-sticker__image` 的高度）与
 * 大图块的规则（`.nb-sticker-block .nb-sticker__image`），所以写成 `.nb-sticker.has-image[data-sticker-pack]` 再接图片的类。
 */

/** 包 id 的字符集（表情包 id 由文件夹名、插件 id 与 `.` 组成）；放进带引号的属性选择器不用转义。不合的丢掉。 */
const PACK_ID = /^[a-z0-9._-]{1,200}$/u;

/** 这些包按贴纸显示的样式表原文；没有包时是空串。 */
export function stickerDisplayCss(packIds: readonly string[]): string {
    const ids = [...new Set(packIds)].filter((id) => PACK_ID.test(id));
    if (ids.length === 0) return "";
    const roots = ids.map((id) => `.nb-sticker.has-image[data-sticker-pack="${id}"]`);
    return [
        `${roots.join(",\n")} {\n    max-width: 100%;\n    margin-block: 0;\n    vertical-align: bottom;\n}`,
        `${roots.map((root) => `${root} .nb-sticker__image`).join(",\n")} {\n    height: var(--nb-sticker-large-size, 120px);\n    max-width: 100%;\n    object-fit: contain;\n}`,
    ].join("\n\n");
}
