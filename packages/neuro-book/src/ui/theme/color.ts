/**
 * 颜色计算（docs/specs/theme/editor.md 输出 7、14）：解析、混合、WCAG 对比度，以及按 OKLCH 调明度的推导用工具。
 * 只认编辑器自己写的 `#rgb`、`#rrggbb`、`#rrggbbaa` 和逗号写法的 `rgb()/rgba()`；别的写法（`color-mix`、`hsl()`、命名色）返回 null，不猜。
 */

export interface Rgba {
    readonly r: number;
    readonly g: number;
    readonly b: number;
    readonly a: number;
}

export interface Oklch {
    readonly l: number;
    readonly c: number;
    /** 色相，度。 */
    readonly h: number;
}

const clampByte = (value: number): number => Math.min(255, Math.max(0, Math.round(value)));
const hex2 = (value: number): string => clampByte(value).toString(16).padStart(2, "0");

const HEX = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/iu;
const FUNC = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/iu;

/** 读一个颜色；读不懂返回 null。 */
export function parseColor(text: string): Rgba | null {
    const value = text.trim();
    const hex = HEX.exec(value);
    if (hex !== null) {
        let digits = hex[1] as string;
        if (digits.length <= 4) digits = [...digits].map((digit) => digit + digit).join("");
        const byte = (index: number): number => Number.parseInt(digits.slice(index, index + 2), 16);
        return {r: byte(0), g: byte(2), b: byte(4), a: digits.length === 8 ? byte(6) / 255 : 1};
    }
    const func = FUNC.exec(value);
    if (func !== null) {
        const [r, g, b] = [func[1], func[2], func[3]].map(Number) as [number, number, number];
        const a = func[4] === undefined ? 1 : Number(func[4]);
        if (r > 255 || g > 255 || b > 255 || a > 1) return null;
        return {r, g, b, a};
    }
    return null;
}

/** 写成 `#rrggbb`，有透明度时写 `rgba()`。 */
export function formatColor(color: Rgba): string {
    if (color.a >= 1) return `#${hex2(color.r)}${hex2(color.g)}${hex2(color.b)}`;
    return `rgba(${String(clampByte(color.r))}, ${String(clampByte(color.g))}, ${String(clampByte(color.b))}, ${String(Math.round(color.a * 100) / 100)})`;
}

/** 把半透明的前景叠到不透明的底上。 */
export function composite(foreground: Rgba, background: Rgba): Rgba {
    const a = foreground.a;
    return {r: foreground.r * a + background.r * (1 - a), g: foreground.g * a + background.g * (1 - a), b: foreground.b * a + background.b * (1 - a), a: 1};
}

/** 在 sRGB 里按比例混合，`amount` 是第二个颜色的占比。 */
export function mix(first: Rgba, second: Rgba, amount: number): Rgba {
    return {
        r: first.r + (second.r - first.r) * amount,
        g: first.g + (second.g - first.g) * amount,
        b: first.b + (second.b - first.b) * amount,
        a: first.a + (second.a - first.a) * amount,
    };
}

const linear = (byte: number): number => {
    const s = byte / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 相对亮度。 */
export function luminance(color: Rgba): number {
    return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

/** 前景对背景的对比度；前景有透明度时先叠到背景上，背景必须不透明。 */
export function contrast(foreground: Rgba, background: Rgba): number {
    const over = foreground.a < 1 ? composite(foreground, background) : foreground;
    const [high, low] = [luminance(over), luminance(background)].sort((x, y) => y - x) as [number, number];
    return (high + 0.05) / (low + 0.05);
}

// OKLab 转换（Björn Ottosson 的公式）。
export function toOklch(color: Rgba): Oklch {
    const [r, g, b] = [linear(color.r), linear(color.g), linear(color.b)];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const hue = (Math.atan2(bb, a) * 180) / Math.PI;
    return {l: lightness, c: Math.hypot(a, bb), h: hue < 0 ? hue + 360 : hue};
}

const gamma = (value: number): number => (value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055);

function oklchToLinear({l, c, h}: Oklch): [number, number, number] {
    const a = c * Math.cos((h * Math.PI) / 180);
    const b = c * Math.sin((h * Math.PI) / 180);
    const lp = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mp = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const sp = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * lp - 3.3077115913 * mp + 0.2309699292 * sp, -1.2684380046 * lp + 2.6097574011 * mp - 0.3413193965 * sp, -0.0041960863 * lp - 0.7034186147 * mp + 1.707614701 * sp];
}

/** OKLCH 转 sRGB；超出色域时降低色度直到进去，明度与色相不变。 */
export function fromOklch(color: Oklch): Rgba {
    let chroma = color.c;
    for (let step = 0; step < 24; step += 1) {
        const rgb = oklchToLinear({...color, c: chroma});
        if (rgb.every((channel) => channel >= -0.0005 && channel <= 1.0005)) {
            const [r, g, b] = rgb.map((channel) => gamma(Math.min(1, Math.max(0, channel))) * 255) as [number, number, number];
            return {r, g, b, a: 1};
        }
        chroma *= 0.9;
    }
    const gray = gamma(Math.min(1, Math.max(0, color.l ** 3))) * 255;
    return {r: gray, g: gray, b: gray, a: 1};
}

/** 改明度，保持色相与色度（超色域时色度自动降）。 */
export function withLightness(color: Rgba, lightness: number): Rgba {
    const lch = toOklch(color);
    return fromOklch({...lch, l: Math.min(1, Math.max(0, lightness))});
}

/**
 * 把前景往“更醒目”的方向调明度，直到对每个背景都不低于 `minimum`。背景是亮色时往暗调，暗色时往亮调；一直到头都不够时，
 * 返回已经调到极限的那个（纯黑或纯白）。
 */
export function ensureContrast(foreground: Rgba, backgrounds: ReadonlyArray<Rgba>, minimum: number): Rgba {
    const meets = (candidate: Rgba): boolean => backgrounds.every((background) => contrast(candidate, background) >= minimum);
    if (meets(foreground)) return foreground;
    const averageLuminance = backgrounds.reduce((sum, background) => sum + luminance(background), 0) / backgrounds.length;
    const direction = averageLuminance > 0.4 ? -1 : 1;
    let candidate = foreground;
    for (let step = 1; step <= 40; step += 1) {
        candidate = withLightness(foreground, toOklch(foreground).l + (direction * step) / 40);
        if (meets(candidate)) return candidate;
    }
    return direction < 0 ? {r: 0, g: 0, b: 0, a: 1} : {r: 255, g: 255, b: 255, a: 1};
}
