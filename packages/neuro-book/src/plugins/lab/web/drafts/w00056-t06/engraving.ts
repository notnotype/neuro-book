/**
 * 第二幕“一张插图”里粘贴的那张图（w00056 t06 第 13 轮）：灰塔的剖面版画。七层有字，第八层只有虚线和一个问号，接第五章那句
 * “第八层的位置还是一片空白”。用 SVG 画；粘贴只收位图，演示时先画成 PNG，当作从别处复制来的图（不另外生成图片）。
 */

export const ENGRAVING_SIZE = {width: 720, height: 960} as const;

/** 从下往上每一层的名字；第八层没有名字。 */
const FLOORS = ["门厅", "灯油库", "钟绳间", "量具室", "藏图室", "观潮台", "灯室"] as const;
const NUMERALS = ["一", "二", "三", "四", "五", "六", "七", "八"] as const;

const INK = "#3b2a1a";
const PAPER = "#efe3c8";
const SERIF = `'Source Han Serif SC', 'Noto Serif CJK SC', 'Songti SC', serif`;

/** 第 `index` 层（0 是一层）的上下沿与左右墙的位置：塔身往上微微收窄。 */
function floor(index: number): {readonly top: number; readonly bottom: number; readonly left: number; readonly right: number} {
    const bottom = 840 - index * 76;
    const top = bottom - 76;
    const half = 150 - index * 7;
    return {top, bottom, left: 300 - half, right: 300 + half};
}

/** 塔身一侧的斜线阴影：墙里每隔 9px 一道。 */
function hatch(x: number, top: number, bottom: number, width: number): string {
    const lines: string[] = [];
    for (let y = top + 4; y < bottom - 4; y += 9) lines.push(`<line x1="${x}" y1="${y + 6}" x2="${x + width}" y2="${y}" />`);
    return lines.join("");
}

export function engravingSvg(): string {
    const parts: string[] = [];
    parts.push(`<rect width="720" height="960" fill="${PAPER}" />`);
    // 双线边框。
    parts.push(`<rect x="22" y="22" width="676" height="916" fill="none" stroke="${INK}" stroke-width="2.4" />`);
    parts.push(`<rect x="32" y="32" width="656" height="896" fill="none" stroke="${INK}" stroke-width="0.8" />`);
    parts.push(`<text x="60" y="92" font-family="${SERIF}" font-size="38" font-weight="700" fill="${INK}" letter-spacing="6">灰塔剖面</text>`);
    parts.push(`<text x="62" y="126" font-family="${SERIF}" font-size="17" fill="${INK}" opacity="0.78" letter-spacing="3">霜港制图坊　艾莉丝摹</text>`);

    const walls: string[] = [];
    const labels: string[] = [];
    for (let index = 0; index < 8; index += 1) {
        const {top, bottom, left, right} = floor(index);
        const blank = index === 7;
        const dash = blank ? ` stroke-dasharray="7 6"` : "";
        // 两道外墙、楼板（双线）。
        walls.push(`<line x1="${left}" y1="${top}" x2="${left}" y2="${bottom}"${dash} />`, `<line x1="${right}" y1="${top}" x2="${right}" y2="${bottom}"${dash} />`);
        walls.push(`<line x1="${left}" y1="${top}" x2="${right}" y2="${top}"${dash} />`);
        if (!blank) {
            walls.push(`<line x1="${left}" y1="${top + 5}" x2="${right}" y2="${top + 5}" stroke-width="0.8" />`);
            walls.push(`<g stroke-width="0.7" opacity="0.7">${hatch(left, top, bottom, 14)}${hatch(right - 14, top, bottom, 14)}</g>`);
            // 每层一扇拱窗，左右交替。
            const windowX = index % 2 === 0 ? left + 34 : right - 58;
            walls.push(`<path d="M${windowX} ${bottom - 14} V${top + 32} Q${windowX + 12} ${top + 18} ${windowX + 24} ${top + 32} V${bottom - 14} Z" fill="none" />`);
            labels.push(`<line x1="${right + 6}" y1="${(top + bottom) / 2}" x2="476" y2="${(top + bottom) / 2}" stroke-width="0.8" stroke-dasharray="2 3" />`);
            labels.push(`<text x="488" y="${(top + bottom) / 2 + 7}" font-family="${SERIF}" font-size="21" fill="${INK}">${NUMERALS[index]}层　${FLOORS[index]}</text>`);
        } else {
            walls.push(`<text x="300" y="${(top + bottom) / 2 + 22}" font-family="${SERIF}" font-size="58" font-weight="700" fill="${INK}" text-anchor="middle" opacity="0.82">？</text>`);
            labels.push(`<line x1="${right + 6}" y1="${(top + bottom) / 2}" x2="476" y2="${(top + bottom) / 2}" stroke-width="0.8" stroke-dasharray="2 3" />`);
            labels.push(`<text x="488" y="${(top + bottom) / 2 + 7}" font-family="${SERIF}" font-size="21" fill="${INK}" opacity="0.7">八层　？</text>`);
        }
    }
    // 尖顶：在第八层上面，也是虚线（还没量到那里）。
    const crown = floor(7);
    walls.push(`<path d="M${crown.left - 10} ${crown.top} L300 ${crown.top - 92} L${crown.right + 10} ${crown.top}" fill="none" stroke-dasharray="7 6" />`);
    // 地面与一把比例尺（铜尺）。
    walls.push(`<line x1="90" y1="840" x2="630" y2="840" stroke-width="2.4" />`);
    walls.push(`<g stroke-width="0.8" opacity="0.75">${Array.from({length: 30}, (_, n) => `<line x1="${96 + n * 18}" y1="858" x2="${108 + n * 18}" y2="842" />`).join("")}</g>`);
    walls.push(`<rect x="90" y="884" width="200" height="10" fill="none" stroke-width="1.2" />`, `<rect x="90" y="884" width="50" height="10" fill="${INK}" />`, `<rect x="190" y="884" width="50" height="10" fill="${INK}" />`);
    labels.push(`<text x="300" y="895" font-family="${SERIF}" font-size="16" fill="${INK}">十丈</text>`);

    parts.push(`<g fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round">${walls.join("")}</g>`);
    parts.push(`<g stroke="${INK}">${labels.join("")}</g>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="960" viewBox="0 0 720 960">${parts.join("")}</svg>`;
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
