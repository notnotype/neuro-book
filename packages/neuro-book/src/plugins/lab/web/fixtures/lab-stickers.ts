/**
 * Lab 场景里的表情目录（docs/specs/agent/stickers.md 输出 10–12）：一个叫 `lyra` 的表情包，几张占位图（SVG），不经 `nbook.stickers`。
 * `delay` 让目录晚到，看先显示原文占位、再换成图。
 */

import type {StickerResolver} from "@notnotype/nb-markdown";

interface LabSticker {
    readonly color: string;
    readonly width: number;
    readonly height: number;
}

const STICKERS: Readonly<Record<string, LabSticker>> = {
    开心: {color: "#40a02b", width: 128, height: 128},
    害羞: {color: "#ea76cb", width: 128, height: 128},
    生气: {color: "#d20f39", width: 128, height: 128},
    // 宽的一张：看宽按图片比例。
    比心: {color: "#7287fd", width: 192, height: 128},
};

function picture(name: string, sticker: LabSticker): string {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${String(sticker.width)}" height="${String(sticker.height)}"><rect width="100%" height="100%" rx="10" fill="${sticker.color}"/><text x="50%" y="56%" font-size="36" text-anchor="middle" fill="white">${name}</text></svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

/** Lab 的表情包 id：按贴纸显示（stickers.md 输出 47）按它选中。 */
export const LAB_STICKER_PACK = "user.lyra";

/** 认 `lyra` 包里的名字，带不带包都行（Lab 里只有这一个包）；`delay` 毫秒后给结果。 */
export function labStickers(delay = 0): StickerResolver {
    return (ref, signal) => new Promise((resolve) => {
        const answer = (): void => {
            if (signal.aborted) return;
            const sticker = (ref.pack === null || ref.pack === "lyra") ? STICKERS[ref.name] : undefined;
            resolve(sticker === undefined ? null : {url: picture(ref.name, sticker), width: sticker.width, height: sticker.height, pack: LAB_STICKER_PACK, packTitle: "星璃", release: () => undefined});
        };
        if (delay <= 0) answer();
        else setTimeout(answer, delay);
    });
}

/** 场景里用的一段正文：夹在文字里、一段只有表情、认不出、时间。 */
export const LAB_STICKER_TEXT = [
    "今天写完第三章啦:lyra/开心:明天见。",
    "",
    ":lyra/害羞:",
    "",
    ":lyra/开心: :lyra/比心:",
    "",
    "一段里四个就不放大了：",
    "",
    ":开心: :害羞: :生气: :比心:",
    "",
    "认不出的留原文 :lyra/没有这个:，时间 10:30:00 不是表情，`:开心:` 在代码里也不是。",
    "",
].join("\n");
