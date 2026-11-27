/** Lab 里表情包页的样本图：几张 SVG 小表情（透明底的小图，加两张不透明的宽图与竖图），不经服务。 */

export type Face = "smile" | "blush" | "sleepy" | "heart" | "cry" | "angry" | "what" | "night" | "cat" | "mochi" | "plain" | "card";

export interface Sticker {
    readonly name: string;
    readonly file: string;
    readonly face: Face;
    readonly color: string;
    readonly description?: string;
    readonly common: boolean;
    readonly size?: string;
    /** 不透明的矩形图（截图、梗图）的宽高与图上的字；其余是 100×100 的透明底小表情。 */
    readonly box?: {readonly width: number; readonly height: number; readonly caption: string};
    /** 当不了表情的原因（没有清单的包里，stickers.md 输出 4）。 */
    readonly problem?: string;
    /** 在文件夹里、清单里没有（有清单时不算表情，stickers.md 的“没有表情列表”）。 */
    readonly unlisted?: boolean;
}

export interface Pack {
    readonly id: string;
    readonly folder: string;
    readonly title: string;
    readonly description?: string;
    readonly source: "user" | "plugin";
    readonly plugin?: string;
    readonly stickers: readonly Sticker[];
}

const EYES = `<circle cx="38" cy="46" r="5" fill="#2b2522"/><circle cx="62" cy="46" r="5" fill="#2b2522"/>`;

function features(face: Face): string {
    switch (face) {
        case "smile": return `${EYES}<path d="M36 60 Q50 74 64 60" stroke="#2b2522" stroke-width="4" fill="none" stroke-linecap="round"/>`;
        case "blush": return `<path d="M32 46 q6 -6 12 0" stroke="#2b2522" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M56 46 q6 -6 12 0" stroke="#2b2522" stroke-width="4" fill="none" stroke-linecap="round"/><ellipse cx="30" cy="58" rx="7" ry="4" fill="#f38ba8" opacity=".8"/><ellipse cx="70" cy="58" rx="7" ry="4" fill="#f38ba8" opacity=".8"/><path d="M44 64 q6 4 12 0" stroke="#2b2522" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
        case "sleepy": return `<path d="M32 48 h12 M56 48 h12" stroke="#2b2522" stroke-width="4" stroke-linecap="round"/><ellipse cx="50" cy="64" rx="5" ry="6" fill="#2b2522"/><text x="70" y="30" font-size="16" font-weight="700" fill="#2b2522">z</text>`;
        case "heart": return "";
        case "cry": return `${EYES}<path d="M38 52 v14 M62 52 v14" stroke="#89dceb" stroke-width="5" stroke-linecap="round"/><path d="M40 70 Q50 62 60 70" stroke="#2b2522" stroke-width="4" fill="none" stroke-linecap="round"/>`;
        case "angry": return `<path d="M30 38 l14 6 M70 38 l-14 6" stroke="#2b2522" stroke-width="4" stroke-linecap="round"/>${EYES}<path d="M38 68 Q50 58 62 68" stroke="#2b2522" stroke-width="4" fill="none" stroke-linecap="round"/>`;
        case "what": return `${EYES}<path d="M42 66 h16" stroke="#2b2522" stroke-width="4" stroke-linecap="round"/><text x="68" y="34" font-size="22" font-weight="700" fill="#2b2522">?</text>`;
        case "night": return `<path d="M32 48 q6 6 12 0 M56 48 q6 6 12 0" stroke="#2b2522" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M45 64 q5 3 10 0" stroke="#2b2522" stroke-width="3.5" fill="none" stroke-linecap="round"/>`;
        case "cat": return `${EYES}<path d="M44 60 l6 4 l6 -4" stroke="#2b2522" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
        case "mochi": return `<circle cx="40" cy="54" r="4" fill="#2b2522"/><circle cx="60" cy="54" r="4" fill="#2b2522"/><path d="M46 62 q4 3 8 0" stroke="#2b2522" stroke-width="3" fill="none" stroke-linecap="round"/>`;
        case "card": return "";
        case "plain": return `<text x="50" y="58" font-size="20" text-anchor="middle" fill="#ffffff" font-family="sans-serif">1.png</text>`;
    }
}

function body(face: Face, color: string): string {
    if (face === "heart") return `<path d="M50 86 C14 62 10 34 30 24 C40 19 48 24 50 32 C52 24 60 19 70 24 C90 34 86 62 50 86 Z" fill="${color}"/>`;
    if (face === "cat") return `<path d="M18 30 L28 8 L42 24 Q50 22 58 24 L72 8 L82 30 Q92 50 82 70 Q70 90 50 90 Q30 90 18 70 Q8 50 18 30 Z" fill="${color}"/>`;
    if (face === "mochi") return `<path d="M10 70 Q10 30 50 28 Q90 30 90 70 Q90 86 50 86 Q10 86 10 70 Z" fill="${color}"/>`;
    if (face === "night") return `<circle cx="50" cy="52" r="36" fill="${color}"/><path d="M66 12 a14 14 0 1 0 14 18 a10 10 0 1 1 -14 -18 Z" fill="#f9e2af"/>`;
    if (face === "plain") return `<rect x="10" y="20" width="80" height="60" rx="8" fill="${color}"/>`;
    return `<circle cx="50" cy="52" r="38" fill="${color}"/>`;
}

function card(color: string, box: NonNullable<Sticker["box"]>): string {
    const {width, height, caption} = box;
    const face = Math.min(width, height) * 0.32;
    const cx = width / 2;
    const cy = height * 0.42;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${String(width)} ${String(height)}" width="${String(width)}" height="${String(height)}"><rect width="100%" height="100%" fill="${color}"/><circle cx="${String(cx)}" cy="${String(cy)}" r="${String(face)}" fill="#fff4e0"/><circle cx="${String(cx - face * 0.35)}" cy="${String(cy - face * 0.1)}" r="${String(face * 0.11)}" fill="#2b2522"/><circle cx="${String(cx + face * 0.35)}" cy="${String(cy - face * 0.1)}" r="${String(face * 0.11)}" fill="#2b2522"/><path d="M${String(cx - face * 0.3)} ${String(cy + face * 0.4)} h${String(face * 0.6)}" stroke="#2b2522" stroke-width="${String(face * 0.09)}" stroke-linecap="round"/><text x="50%" y="${String(height - Math.max(10, height * 0.08))}" font-size="${String(Math.max(14, Math.min(width, height) * 0.13))}" font-weight="700" text-anchor="middle" fill="#ffffff" stroke="#2b2522" stroke-width="1.2" paint-order="stroke" font-family="sans-serif">${caption}</text></svg>`;
}

export function stickerImage(sticker: Pick<Sticker, "face" | "color" | "box">): string {
    if (sticker.face === "card" && sticker.box !== undefined) return `data:image/svg+xml;utf8,${encodeURIComponent(card(sticker.color, sticker.box))}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="128" height="128">${body(sticker.face, sticker.color)}${features(sticker.face)}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

