/**
 * 第二幕“一张插图”里粘贴的那张图（w00056 t06 第 13 轮）：灰塔的剖面版画。七层有字，第八层只有虚线和一个问号，接第五章那句
 * “第八层的位置还是一片空白”。用 SVG 画；粘贴只收位图，演示时先画成 PNG，当作从别处复制来的图（不另外生成图片）。
 *
 * 横版（塔身在左、各层的名字在右）：正文里的图按自己的宽度显示、最宽到正文那一栏（约 620px），竖版的 720×960 缩到一栏宽时
 * 有 800 多像素高，一屏看不全（第 13 轮第一遍连播）；横版缩下来约 440 像素高，连同上下文在一屏里。
 */

export const ENGRAVING_SIZE = {width: 840, height: 600} as const;

/** 从下往上每一层的名字；第八层没有名字。 */
const FLOORS = ["门厅", "灯油库", "钟绳间", "量具室", "藏图室", "观潮台", "灯室"] as const;
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八"] as const;

const INK = "#3b2a1a";
const PAPER = "#efe3c8";
const SEAL = "#9a2f22";
const SERIF = `'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', serif`;

/** 塔身的中线、地面，与各层名字那一栏的左沿。 */
const AXIS = 230;
const GROUND = 500;
const LABELS = 380;

/** 第 `index` 层（0 是一层）的上下沿与左右墙的位置：塔身往上微微收窄。 */
function floor(index: number): {readonly top: number; readonly bottom: number; readonly left: number; readonly right: number} {
    const bottom = GROUND - index * 44;
    const top = bottom - 44;
    const half = 100 - index * 5;
    return {top, bottom, left: AXIS - half, right: AXIS + half};
}

/** 塔身一侧的斜线阴影：墙里每隔 8px 一道。 */
function hatch(x: number, top: number, bottom: number, width: number): string {
    const lines: string[] = [];
    for (let y = top + 4; y < bottom - 4; y += 8) lines.push(`<line x1="${x}" y1="${y + 5}" x2="${x + width}" y2="${y}" />`);
    return lines.join("");
}

export function engravingSvg(): string {
    const {width, height} = ENGRAVING_SIZE;
    const parts: string[] = [];
    parts.push(`<rect width="${width}" height="${height}" fill="${PAPER}" />`);
    // 双线边框。
    parts.push(`<rect x="22" y="22" width="${width - 44}" height="${height - 44}" fill="none" stroke="${INK}" stroke-width="2.4" />`);
    parts.push(`<rect x="32" y="32" width="${width - 64}" height="${height - 64}" fill="none" stroke="${INK}" stroke-width="0.8" />`);
    // 题名在右上，各层名字那一栏的上面。
    parts.push(`<text x="${LABELS + 50}" y="92" font-family="${SERIF}" font-size="36" font-weight="700" fill="${INK}" letter-spacing="6">灰塔剖面</text>`);
    parts.push(`<text x="${LABELS + 52}" y="124" font-family="${SERIF}" font-size="16" fill="${INK}" opacity="0.78" letter-spacing="3">霜港制图坊　艾莉丝摹</text>`);

    const walls: string[] = [];
    const labels: string[] = [];
    for (let index = 0; index < 8; index += 1) {
        const {top, bottom, left, right} = floor(index);
        const middle = (top + bottom) / 2;
        const blank = index === 7;
        const dash = blank ? ` stroke-dasharray="7 6"` : "";
        // 两道外墙、楼板（双线）。
        walls.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}"${dash} />`, `<line x1="${right}" y1="${top}" x2="${right}" y2="${bottom}"${dash} />`);
        walls.push(`<line x1="${left}" y1="${top}" x2="${right}" y2="${top}"${dash} />`);
        labels.push(`<line x1="${right + 6}" y1="${middle}" x2="${LABELS - 12}" y2="${middle}" stroke-width="0.8" stroke-dasharray="2 3" />`);
        if (!blank) {
            walls.push(`<line x1="${left}" y1="${top + 4}" x2="${right}" y2="${top + 4}" stroke-width="0.8" />`);
            walls.push(`<g stroke-width="0.7" opacity="0.7">${hatch(left, top, bottom, 12)}${hatch(right - 12, top, bottom, 12)}</g>`);
            // 每层一扇拱窗，左右交替。
            const windowX = index % 2 === 0 ? left + 28 : right - 48;
            walls.push(`<path d="M${windowX} ${bottom - 10} V${top + 24} Q${windowX + 10} ${top + 12} ${windowX + 20} ${top + 24} V${bottom - 10} Z" fill="none" />`);
            labels.push(`<text x="${LABELS}" y="${middle + 7}" font-family="${SERIF}" font-size="21" fill="${INK}">${NUMERALS[index]}层　${FLOORS[index]}</text>`);
        } else {
            walls.push(`<text x="${AXIS}" y="${middle + 17}" font-family="${SERIF}" font-size="44" font-weight="700" fill="${INK}" text-anchor="middle" opacity="0.82">？</text>`);
            labels.push(`<text x="${LABELS}" y="${middle + 7}" font-family="${SERIF}" font-size="21" fill="${INK}" opacity="0.7">八层　？</text>`);
        }
    }
    // 尖顶：在第八层上面，也是虚线（还没量到那里）。
    const crown = floor(7);
    walls.push(`<path d="M${crown.left - 10} ${crown.top} L${AXIS} ${crown.top - 60} L${crown.right + 10} ${crown.top}" fill="none" stroke-dasharray="7 6" />`);
    // 地面与一把比例尺（铜尺）。
    walls.push(`<line x1="70" y1="${GROUND}" x2="${LABELS + 10}" y2="${GROUND}" stroke-width="2.4" />`);
    walls.push(`<g stroke-width="0.8" opacity="0.75">${Array.from({length: 18}, (_, n) => `<line x1="${76 + n * 18}" y1="${GROUND + 16}" x2="${88 + n * 18}" y2="${GROUND + 2}" />`).join("")}</g>`);
    walls.push(`<rect x="70" y="536" width="180" height="10" fill="none" stroke-width="1.2" />`, `<rect x="70" y="536" width="45" height="10" fill="${INK}" />`, `<rect x="160" y="536" width="45" height="10" fill="${INK}" />`);
    labels.push(`<text x="262" y="547" font-family="${SERIF}" font-size="16" fill="${INK}">十丈</text>`);
    // 右下角一方制图坊的朱印。
    const seal = `<g transform="translate(${width - 132} ${height - 132})"><rect width="76" height="76" rx="6" fill="none" stroke="${SEAL}" stroke-width="3" /><text x="38" y="34" font-family="${SERIF}" font-size="25" font-weight="700" fill="${SEAL}" text-anchor="middle">霜港</text><text x="38" y="64" font-family="${SERIF}" font-size="25" font-weight="700" fill="${SEAL}" text-anchor="middle">制图</text></g>`;

    parts.push(`<g fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round">${walls.join("")}</g>`);
    parts.push(`<g stroke="${INK}">${labels.join("")}</g>`);
    parts.push(seal);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${parts.join("")}</svg>`;
}

/** 画成 PNG（演示粘贴时用）。只在浏览器里用：要 `Image` 与画布。 */
export async function engravingPng(): Promise<Blob> {
    const {width, height} = ENGRAVING_SIZE;
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(engravingSvg())}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("画不了插图：浏览器没有给 2D 画布");
    context.drawImage(image, 0, 0, width, height);
    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => (blob === null ? reject(new Error("插图没有画成 PNG")) : resolve(blob)), "image/png");
    });
}
