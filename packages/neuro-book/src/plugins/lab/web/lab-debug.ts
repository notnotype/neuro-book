/**
 * Lab 的只读调试接口，挂在 `window.__nbLab`，给截图脚本和浏览器控制台用。
 *
 * 脚本只认这里和 `data-lab-stage` 标记，不认 Lab 外壳的按钮文字或 class：外壳改版时脚本不必跟着改。
 * 接口只读，改状态一律走 URL 参数（见 lab-url.ts），保证同一个 URL 永远是同一个起点。
 */
import type {LabClippedFocus, LabDebugApi, LabOverflowOffender, LabSmallTarget, LabStageMeasure} from "../shared/debug-api";

import {ringSelectors} from "./focus-rules";
import type {RingSelector} from "./focus-rules";
import {describeNode} from "./inspect";

declare global {
    interface Window {
        __nbLab?: LabDebugApi;
    }
}

const TOLERANCE = 1;
const MAX_OFFENDERS = 20;

/**
 * 看不见的元素不算越界：读屏用的播报区（`opacity: 0`）、视觉隐藏的原生输入（`clip: rect(0 0 0 0)` 或
 * `clip-path: inset(50%)`）与 `visibility: hidden`。它们常被组件库放在盒子外面，算进来就是误报。
 */
function invisible(element: HTMLElement): boolean {
    const style = getComputedStyle(element);
    return style.opacity === "0" || style.visibility === "hidden" || style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
}

/** 元素和舞台之间有没有横向不外溢的容器把它挡住：挡住的越界看不见，也不会撑出滚动条。 */
function clipped(element: HTMLElement, stage: HTMLElement): boolean {
    for (let node = element.parentElement; node !== null && node !== stage; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX !== "visible") {
            return true;
        }
    }
    return false;
}

const FOCUSABLE = "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1']), [role='combobox'], [role='listbox']";

/** box-shadow 的一层：偏移、模糊、扩散（像素），是否内阴影，颜色是否全透明。 */
type ShadowLayer = {readonly x: number; readonly y: number; readonly blur: number; readonly spread: number; readonly inset: boolean; readonly transparent: boolean};

/** 按顶层的分隔符切开：括号连同里面的内容归在它所在的那一段（颜色函数自带逗号与空白）。 */
function splitTopLevel(value: string, separator: (char: string) => boolean): string[] {
    let depth = 0;
    let current = "";
    const parts: string[] = [];
    for (const char of value) {
        if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
        if (depth === 0 && separator(char)) {
            parts.push(current);
            current = "";
        } else {
            current += char;
        }
    }
    parts.push(current);
    return parts;
}

/**
 * 阴影里的长度：带 px，或者不写单位的 0。主题的 `--focus-ring` 是自定义属性，浏览器只替换 `var()`、原样给出
 * `0 0 0 4px`，不像 box-shadow 的计算值那样规范成 px。
 */
const SHADOW_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px)?$/u;
/**
 * 颜色本身全透明：`transparent`，或 alpha 为 0 的颜色函数。alpha 只在斜杠后面，或逗号写法的第四个参数：`rgb(0, 0, 0)`
 * 末尾的 0 是蓝色。`color-mix(…, transparent)` 是半透明的混色，照样算。
 */
function fullyTransparent(token: string): boolean {
    if (token === "transparent") return true;
    const args = /^(?:rgba?|hsla?|color|oklch|oklab|lab|lch)\((.*)\)$/u.exec(token)?.[1];
    if (args === undefined) return false;
    const commas = args.split(",");
    const alpha = args.includes("/") ? args.slice(args.lastIndexOf("/") + 1) : commas.length === 4 ? commas[3] : undefined;
    return alpha !== undefined && Number.parseFloat(alpha) === 0;
}

/** box-shadow 的一层按顶层空白切词：长度依次是偏移、模糊、扩散；其余是颜色与 inset。读不出两个长度（`var()` 一类）为 null。 */
function shadowLayer(part: string): ShadowLayer | null {
    const tokens = splitTopLevel(part.trim(), (char) => /\s/u.test(char)).filter((token) => token !== "");
    const lengths = tokens.filter((token) => SHADOW_LENGTH.test(token) && (token.endsWith("px") || Number.parseFloat(token) === 0)).map((token) => Number.parseFloat(token));
    if (lengths.length < 2) return null;
    const [x = 0, y = 0, blur = 0, spread = 0] = lengths;
    return {x, y, blur, spread, inset: tokens.includes("inset"), transparent: tokens.some(fullyTransparent)};
}

const shadowParts = (value: string): string[] => splitTopLevel(value, (char) => char === ",");

/** box-shadow 拆成读得出的层（见 shadowLayer），读不出的层略过。 */
function shadowLayers(value: string): ShadowLayer[] {
    return shadowParts(value).map(shadowLayer).filter((layer): layer is ShadowLayer => layer !== null);
}

/**
 * 一圈环被裁掉能不能看出来，只看它的实色部分：不偏移的那几层的扩散量。带偏移、靠模糊扩出去的那层被切掉一截，
 * 截图对照看不出差别（2026-10-12，离边 4–5.6px 的十几个控件逐个聚焦对照），按它算全是误报。
 */
function solidRingExtent(layers: ReadonlyArray<ShadowLayer>): number {
    let extent = 0;
    for (const layer of layers) {
        if (layer.inset || layer.transparent || layer.x !== 0 || layer.y !== 0) continue;
        extent = Math.max(extent, layer.spread);
    }
    return extent;
}

/**
 * 主题焦点环的外扩量：`--focus-ring` 里不偏移那几圈的扩散量（见 solidRingExtent）。读不到或解析不出时按 3.5px
 * （nbook、macos 两套主题都是 2 与 3.5 两圈，另有一层 1px 偏移 6px 模糊的光，不算）。
 */
export function focusRingExtent(element: Element): number {
    const value = getComputedStyle(element).getPropertyValue("--focus-ring").trim();
    const extent = value === "" ? 0 : solidRingExtent(shadowLayers(value));
    return extent > 0 ? extent : 3.5;
}

/**
 * 元素现在画着的外扩环有多宽：不偏移的外阴影的扩散量（`0 0 0 2px` 这类选中环、描边环，见 solidRingExtent），或者看得见的
 * outline（宽度 + 偏移）。带偏移的投影是抬起的影子，不算环：卡片、面板的投影本来就会延伸到容器外，算进来全是误报。
 */
function drawnRingExtent(style: CSSStyleDeclaration): number {
    const shadow = style.boxShadow;
    let extent = shadow === "" || shadow === "none" ? 0 : solidRingExtent(shadowLayers(shadow));
    const outlineWidth = Number.parseFloat(style.outlineWidth);
    if (style.outlineStyle !== "none" && outlineWidth > 0 && !/\btransparent\b|rgba\([^)]*,\s*0\)/u.test(style.outlineColor)) {
        extent = Math.max(extent, outlineWidth + (Number.parseFloat(style.outlineOffset) || 0));
    }
    return extent;
}

/**
 * 这条规则聚焦后画不画得出东西：box-shadow 或看得见的 outline。透明的 outline（Tailwind 的 outline-hidden）不算。规则里的
 * `var()` 要到元素上才展开：读不出的阴影层按外扩算，和内阴影写在一起也一样；outline 简写里有 `var()` 时三个长写法读出来是
 * 空的，看简写本身。
 */
function drawsRing(style: CSSStyleDeclaration): boolean {
    const shadow = style.getPropertyValue("box-shadow");
    if (shadow !== "" && shadow !== "none") {
        // 只有内阴影（内嵌焦点线）画在元素里面，不会被裁。
        return shadowParts(shadow).some((part) => shadowLayer(part)?.inset !== true);
    }
    const outline = style.getPropertyValue("outline").trim();
    if (outline.includes("var(")) return true;
    const outlineStyle = style.getPropertyValue("outline-style");
    const outlineWidth = style.getPropertyValue("outline-width");
    const outlineColor = style.getPropertyValue("outline-color");
    return outlineStyle !== "" && outlineStyle !== "none" && outlineWidth !== "0px" && outlineWidth !== "0" && outlineColor !== "transparent";
}

/**
 * 从样式表找“聚焦后会画焦点环”的选择器：含焦点伪类且声明了外阴影或 outline 的规则，只画内阴影的不算（怎么从选择器里认出画环的元素见
 * focus-rules.ts）。环不一定画在焦点元素自己身上（`:focus-within`、`:has(... :focus-visible)` 把环画在外框上），
 * 所以不能按“可聚焦”猜。嵌套规则按 `&` 接上父选择器。跨源样式表读不到规则，跳过。
 */
function ringSelectorsIn(root: Document): RingSelector[] {
    const found: RingSelector[] = [];
    const visit = (rules: CSSRuleList, parent: string | null): void => {
        for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
                const own = rule.selectorText;
                const selector = parent === null ? own : own.includes("&") ? own.replaceAll("&", `:is(${parent})`) : `:is(${parent}) ${own}`;
                if (drawsRing(rule.style)) found.push(...ringSelectors(selector));
                visit(rule.cssRules, selector);
            } else if (rule instanceof CSSGroupingRule) {
                visit(rule.cssRules, parent);
            }
        }
    };
    for (const sheet of root.styleSheets) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        visit(rules, null);
    }
    return found;
}

/**
 * 聚焦光晕会被裁的元素：会画焦点环的元素（见 ringSelectorsIn）沿祖先往上找 overflow 不为 visible 的容器，任一边离容器内容盒的边
 * 不足光晕外扩量就算。不真的去聚焦（会改页面状态、触发监听），按主题 token 的几何算；元素本身就越出容器的归溢出检查，这里跳过。
 * 查几个区域时由调用方把 `selectors` 算一次传进来：它要扫一遍页面上全部样式规则。
 */
export function clippedFocusRings(stage: HTMLElement, extent: number, selectors: ReadonlyArray<RingSelector> = ringSelectorsIn(stage.ownerDocument)): LabClippedFocus[] {
    const candidates = new Set<HTMLElement>();
    for (const {selector, direct} of selectors) {
        let matched: NodeListOf<HTMLElement>;
        try {
            matched = stage.querySelectorAll<HTMLElement>(selector);
        } catch {
            // 改写后的选择器可能不合法（例如带厂商伪元素的规则），这条规则不查。
            continue;
        }
        // 规则命中的元素还得真能拿到焦点：自己可聚焦，或者环画在外框上、里面有可聚焦的。
        for (const element of matched) if (element.matches(FOCUSABLE) || (!direct && element.querySelector(FOCUSABLE) !== null)) candidates.add(element);
    }
    const found: LabClippedFocus[] = [];
    for (const element of candidates) {
        if (found.length >= MAX_OFFENDERS) break;
        if (invisible(element) || (element as HTMLButtonElement).disabled) continue;
        const clipped = clippedBy(element, stage, extent);
        if (clipped !== null) found.push(clipped);
    }
    return found;
}

/**
 * 元素外扩 `extent` 像素的一圈会不会被某个祖先（到 `root` 为止，不含）裁掉：沿祖先往上找 overflow 不为 visible 的容器，
 * 任一边离容器内容盒的边不足 `extent` 就算。元素本身就越出容器的归溢出检查，这里跳过。
 */
function clippedBy(element: HTMLElement, root: HTMLElement, extent: number): LabClippedFocus | null {
    const box = element.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return null;
    // 里层已经在某个方向上滚动时，外层容器在这个方向上的边不再是裁切边：滚动区之外的部分本来就看不见，要滚过去才露出来，
    // 露出来时在滚动区里。不记住这一点，外层不滚动的容器（例如对话框正文）会把滚动区里贴近它边上的元素误报成光晕被裁。
    let scrolledX = false;
    let scrolledY = false;
    for (let node = element.parentElement; node !== null && node !== root; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (style.overflowX === "visible" && style.overflowY === "visible") continue;
        const inner = node.getBoundingClientRect();
        const inset = {
            left: Number.parseFloat(style.borderLeftWidth),
            top: Number.parseFloat(style.borderTopWidth),
            right: Number.parseFloat(style.borderRightWidth),
            bottom: Number.parseFloat(style.borderBottomWidth),
        };
        // 可滚动的方向上，容器边不是裁切边（内容滚过去就露出来），只看不滚动的那个轴。
        const scrollsX = (style.overflowX === "auto" || style.overflowX === "scroll") && node.scrollWidth > node.clientWidth;
        const scrollsY = (style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight;
        const gaps = [
            ...(style.overflowX === "visible" || scrollsX || scrolledX ? [] : [box.left - (inner.left + inset.left), inner.right - inset.right - box.right]),
            ...(style.overflowY === "visible" || scrollsY || scrolledY ? [] : [box.top - (inner.top + inset.top), inner.bottom - inset.bottom - box.bottom]),
        ];
        scrolledX ||= scrollsX;
        scrolledY ||= scrollsY;
        const gap = Math.min(...gaps);
        if (gaps.length > 0 && gap >= -TOLERANCE && gap < extent) {
            const described = describeNode(element);
            return {selector: described.selector, componentName: described.componentName, clipper: describeNode(node).selector, gap: Math.round(gap * 10) / 10};
        }
    }
    return null;
}

/** 现在就画着的外扩环（选中环、描边环，见 drawnRingExtent）会被裁的元素。不依赖焦点：截图时看得见的那一圈。 */
export function clippedDrawnRings(root: HTMLElement): LabClippedFocus[] {
    const found: LabClippedFocus[] = [];
    for (const element of root.querySelectorAll<HTMLElement>("*")) {
        if (found.length >= MAX_OFFENDERS) break;
        const style = getComputedStyle(element);
        const extent = drawnRingExtent(style);
        if (extent <= TOLERANCE || invisible(element)) continue;
        const clipped = clippedBy(element, root, extent);
        if (clipped !== null) found.push(clipped);
    }
    return found;
}

/**
 * 在无限循环的动画里的元素（转圈、骨架闪光）：外框随动画每一帧都在变，旋转的方块转到 45° 时比静止宽四成，
 * 拿它判越界，结果取决于量的那一刻转到哪。
 */
function looping(region: HTMLElement): Set<Element> {
    const targets = new Set<Element>();
    for (const animation of region.ownerDocument.getAnimations()) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        if (target !== null && animation.effect?.getComputedTiming().endTime === Infinity && region.contains(target)) targets.add(target);
    }
    return targets;
}

/** 越出 `region` 左右边缘、且没有被中间某个横向裁剪或滚动容器挡住的元素。 */
function offendersIn(region: HTMLElement, limit: number): LabOverflowOffender[] {
    const rect = region.getBoundingClientRect();
    const offenders: LabOverflowOffender[] = [];
    const moving = [...looping(region)];
    for (const element of region.querySelectorAll<HTMLElement>("*")) {
        if (offenders.length >= limit) {
            break;
        }
        if (moving.some((target) => target.contains(element))) {
            continue;
        }
        const box = element.getBoundingClientRect();
        if (box.width === 0 && box.height === 0) {
            continue;
        }
        const overflow = Math.max(box.right - rect.right, rect.left - box.left);
        if (overflow > TOLERANCE && !invisible(element) && !clipped(element, region)) {
            const node = describeNode(element);
            offenders.push({selector: node.selector, componentName: node.componentName, overflow: Math.round(overflow)});
        }
    }
    return offenders;
}

/** 指针目标：按钮、链接、能点的角色、复选与单选、拖动把手（nb-ui 开发规范“可点区域与焦点”第 10 条）。 */
const POINTER_TARGETS = "button, a[href], [role='button'], [role='checkbox'], [role='radio'], [role='switch'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], input[type='checkbox'], input[type='radio'], [data-drag-handle]";
/** WCAG 2.5.8 的最小目标与间距例外的圆直径，CSS 像素。 */
const MIN_TARGET = 24;

/** 句子里的行内链接不算（WCAG 2.5.8 的例外）：行内显示、父元素里还有别的文字。 */
function inlineInText(element: HTMLElement): boolean {
    if (element.tagName !== "A" || getComputedStyle(element).display !== "inline") return false;
    const parent = element.parentElement;
    return parent !== null && (parent.textContent ?? "").trim().length > (element.textContent ?? "").trim().length;
}

/** 两个矩形相接或重叠（容 1 像素）。 */
function touching(a: DOMRect, b: DOMRect): boolean {
    return a.left <= b.right + TOLERANCE && b.left <= a.right + TOLERANCE && a.top <= b.bottom + TOLERANCE && b.top <= a.bottom + TOLERANCE;
}

/**
 * 可点区域：元素自己加上点了也算点它的 label（`for` 指向它，或包住它）。只并进与控件相接或重叠的 label：中间隔着空白时
 * 并集会把空白也算进去，可点区域被高估、中心也落在空白里。
 */
function hitArea(element: HTMLElement): DOMRect {
    const own = element.getBoundingClientRect();
    const rects = [own];
    const labels = (element as HTMLInputElement).labels;
    if (labels !== undefined && labels !== null) {
        for (const label of labels) {
            const rect = label.getBoundingClientRect();
            if (touching(own, rect)) rects.push(rect);
        }
    }
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    return new DOMRect(left, top, Math.max(...rects.map((rect) => rect.right)) - left, Math.max(...rects.map((rect) => rect.bottom)) - top);
}

/**
 * 可点区域不够 24×24 又不满足间距例外的目标：以它的中心画直径 24 的圆，圆碰到别的目标，或者两个小目标的圆相交。
 * 套在一起的目标（菜单项里的复选）互相不算。看不见的、`aria-hidden` 里的、停用的不算（WCAG 2.5.8 不管不可用的控件）。
 * “看不见”只看元素自己：悬停才显出来的按钮组（祖先透明）照样算，悬停时它们就是目标。
 */
export function smallTargetsIn(region: HTMLElement, limit: number): LabSmallTarget[] {
    const targets = [...region.querySelectorAll<HTMLElement>(POINTER_TARGETS)].filter((element) => {
        const box = element.getBoundingClientRect();
        const disabled = element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
        return box.width > 0 && box.height > 0 && !disabled && !invisible(element) && element.closest("[aria-hidden='true']") === null && !inlineInText(element);
    });
    const areas = targets.map(hitArea);
    const small = areas.map((area) => area.width < MIN_TARGET - 0.5 || area.height < MIN_TARGET - 0.5);
    const center = (area: DOMRect) => ({x: area.left + area.width / 2, y: area.top + area.height / 2});
    const found: LabSmallTarget[] = [];
    targets.forEach((element, index) => {
        if (!small[index] || found.length >= limit) return;
        const c = center(areas[index]!);
        const crowded = targets.some((other, otherIndex) => {
            if (otherIndex === index || other.contains(element) || element.contains(other)) return false;
            const area = areas[otherIndex]!;
            if (small[otherIndex]) {
                const d = center(area);
                if (Math.hypot(c.x - d.x, c.y - d.y) < MIN_TARGET) return true;
            }
            const dx = Math.max(area.left - c.x, 0, c.x - area.right);
            const dy = Math.max(area.top - c.y, 0, c.y - area.bottom);
            return Math.hypot(dx, dy) < MIN_TARGET / 2;
        });
        if (!crowded) return;
        const described = describeNode(element);
        found.push({selector: described.selector, componentName: described.componentName, width: Math.round(areas[index]!.width * 10) / 10, height: Math.round(areas[index]!.height * 10) / 10});
    });
    return found;
}

/**
 * 文字被裁掉的元素：在不滚动的方向上裁切（`overflow: hidden` 或 `clip`）、里面有文字、内容比盒子大，又不是有意的截断
 * （单行省略号、行数截断）。裁文字的常是外面的壳（固定高度的按钮、徽标），文字在里面的 span 里，所以按裁切的容器查，
 * 不要求文字是它的直接子节点。给“文字间距加大不丢内容”（WCAG 1.4.12）摸底用，只报告。
 */
export function clippedTextIn(region: HTMLElement, limit: number): LabOverflowOffender[] {
    const found: LabOverflowOffender[] = [];
    for (const element of region.querySelectorAll<HTMLElement>("*")) {
        if (found.length >= limit) break;
        if ((element.textContent ?? "").trim() === "" || element.closest("[aria-hidden='true']") !== null) continue;
        const style = getComputedStyle(element);
        const hidesX = style.overflowX === "hidden" || style.overflowX === "clip";
        const hidesY = style.overflowY === "hidden" || style.overflowY === "clip";
        const overX = hidesX && style.textOverflow !== "ellipsis" ? element.scrollWidth - element.clientWidth : 0;
        const overY = hidesY && style.webkitLineClamp === "none" ? element.scrollHeight - element.clientHeight : 0;
        const over = Math.max(overX, overY);
        if (over > TOLERANCE && !invisible(element)) {
            const described = describeNode(element);
            found.push({selector: described.selector, componentName: described.componentName, overflow: Math.round(over)});
        }
    }
    return found;
}

/**
 * 场景的内容不只在舞台里：对话框、抽屉这类居中浮层传送到同一块画布上的浮层落点（ViewportCanvas 的
 * `data-lab-overlay-root`），下拉、取色面板这类贴着触发器的浮层由 reka 传送到 body。只测舞台的话，这些全都测不到。
 */
function overlayRootOf(stage: HTMLElement): HTMLElement | null {
    return stage.closest("[data-lab-canvas]")?.querySelector<HTMLElement>("[data-lab-overlay-root]") ?? null;
}

export function measureStage(stage: HTMLElement): LabStageMeasure {
    const rect = stage.getBoundingClientRect();
    const overlayRoot = overlayRootOf(stage);
    // 越界按所在区域的边算：舞台里的按舞台，画布浮层里的按画布。body 上的 reka 浮层按视口定位、会翻转避让，不查越界。
    const regions = overlayRoot === null ? [stage] : [stage, overlayRoot];
    const popovers = [...stage.ownerDocument.querySelectorAll<HTMLElement>("[data-reka-popper-content-wrapper]")];
    const extent = focusRingExtent(stage);
    const selectors = ringSelectorsIn(stage.ownerDocument);
    return {
        box: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
        overflowX: Math.max(0, stage.scrollWidth - stage.clientWidth),
        offenders: regions.flatMap((region) => offendersIn(region, MAX_OFFENDERS)).slice(0, MAX_OFFENDERS),
        clippedFocus: [...regions, ...popovers].flatMap((region) => clippedFocusRings(region, extent, selectors)).slice(0, MAX_OFFENDERS),
        clippedRings: [...regions, ...popovers].flatMap((region) => clippedDrawnRings(region)).slice(0, MAX_OFFENDERS),
        smallTargets: [...regions, ...popovers].flatMap((region) => smallTargetsIn(region, MAX_OFFENDERS)).slice(0, MAX_OFFENDERS),
        clippedText: [...regions, ...popovers].flatMap((region) => clippedTextIn(region, MAX_OFFENDERS)).slice(0, MAX_OFFENDERS),
    };
}

export function installLabDebugApi(source: Omit<LabDebugApi, "version" | "measure">): () => void {
    window.__nbLab = {
        version: 1,
        ...source,
        measure: () => {
            const stage = document.querySelector<HTMLElement>("[data-lab-stage]");
            return stage === null ? null : measureStage(stage);
        },
    };
    return () => {
        delete window.__nbLab;
    };
}
