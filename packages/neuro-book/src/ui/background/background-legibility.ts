/**
 * 背景上的文字读不读得动（docs/specs/ui/backgrounds.md 输出 5、7）。纯函数：颜色由调用方从文档根读好交进来。
 *
 * 下限是两个数的较大值。模式下限来自人眼走查：图的细节会和字混在一起，比值看不出来（模糊时 75，不模糊时 92）。角色下限是算出来的：
 * 面色按遮罩盖在这张图最亮、最暗的地方，每种文字都要不低于 4.5。
 */

export type Rgb = readonly [number, number, number];

export const MODE_FLOOR = {blur: 75, sharp: 92} as const;
export const DEFAULT_SCRIM = 85;
export const MIN_CONTRAST = 4.5;

/** 纯色底的预设：亮暗各一个，文字颜色来自主题，同一个颜色在另一种明暗下读不了。 */
export const BACKGROUND_COLOR_PRESETS = [
    {id: "parchment", light: "#f4ecd8", dark: "#2a2520"},
    {id: "green", light: "#d9f0dc", dark: "#1f2a24"},
] as const;

/** 最坏的图：不知道这张图长什么样时（采样失败）按它算。 */
export const WORST_CASE_EXTREMES: Readonly<{lightest: Rgb; darkest: Rgb}> = {lightest: [255, 255, 255], darkest: [0, 0, 0]};

/** 解析浏览器算出的颜色：`#rrggbb`、`rgb()`、`rgba()`、`color(srgb …)`；带透明度的取第四个数。 */
export function parseColor(value: string): {readonly rgb: Rgb; readonly alpha: number} | null {
    const text = value.trim();
    const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/iu.exec(text);
    if (hex !== null) return {rgb: [Number.parseInt(hex[1] as string, 16), Number.parseInt(hex[2] as string, 16), Number.parseInt(hex[3] as string, 16)], alpha: 1};
    const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/u.exec(text);
    if (srgb !== null) return {rgb: [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255], alpha: srgb[4] === undefined ? 1 : Number(srgb[4])};
    const legacy = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+))?\s*\)$/u.exec(text);
    if (legacy !== null) return {rgb: [Number(legacy[1]), Number(legacy[2]), Number(legacy[3])], alpha: legacy[4] === undefined ? 1 : Number(legacy[4])};
    return null;
}

function luminance(color: Rgb): number {
    const channel = (value: number): number => {
        const v = value / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(color[0]) + 0.7152 * channel(color[1]) + 0.0722 * channel(color[2]);
}

export function contrast(a: Rgb, b: Rgb): number {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
    return (light + 0.05) / (dark + 0.05);
}

export function blend(top: Rgb, bottom: Rgb, alpha: number): Rgb {
    return [top[0] * alpha + bottom[0] * (1 - alpha), top[1] * alpha + bottom[1] * (1 - alpha), top[2] * alpha + bottom[2] * (1 - alpha)];
}

export interface TextRole {
    readonly color: Rgb;
    /** 文字下面还有一层半透明的底（高亮）。 */
    readonly over?: {readonly color: Rgb; readonly alpha: number};
}

const contrastOn = (role: TextRole, background: Rgb): number => contrast(role.color, role.over === undefined ? background : blend(role.over.color, background, role.over.alpha));

/**
 * 这张图上最小的遮罩（百分比）。实心面上本来就到不了 4.5 的角色不参与：抬遮罩也救不了它（弱化文字），验收按它无背景时的值。
 */
export function scrimFloor(options: {readonly surface: Rgb; readonly roles: ReadonlyArray<TextRole>; readonly extremes: Readonly<{lightest: Rgb; darkest: Rgb}>; readonly blur: boolean}): number {
    const {surface, roles, extremes, blur} = options;
    const mode = blur ? MODE_FLOOR.blur : MODE_FLOOR.sharp;
    const reachable = roles.filter((role) => contrastOn(role, surface) >= MIN_CONTRAST);
    for (let scrim = mode; scrim < 100; scrim += 1) {
        const alpha = scrim / 100;
        const passes = (extreme: Rgb): boolean => reachable.every((role) => contrastOn(role, blend(surface, extreme, alpha)) >= MIN_CONTRAST);
        if (passes(extremes.lightest) && passes(extremes.darkest)) return scrim;
    }
    return 100;
}

/** 纯色底（输出 7）：这些文字在它上面都要够。 */
export function colorIsLegible(color: Rgb, roles: ReadonlyArray<TextRole>): boolean {
    return roles.every((role) => contrastOn(role, color) >= MIN_CONTRAST);
}
