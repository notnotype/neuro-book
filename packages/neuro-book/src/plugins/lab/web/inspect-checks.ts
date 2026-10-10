/**
 * 元素页签的结构检查与计算样式读数（docs/specs/ui/component-lab.md 的输出“变量 tab”一条里的结构检查）：读检查器选中
 * 元素的 ARIA 属性与计算样式，做几项结构检查。纯函数，只读 DOM，不改它；UI 只负责渲染结果。
 */

export type LabReadoutItem = {
    readonly label: string;
    readonly value: string;
    /** 颜色类读数的色板 */
    readonly swatch?: string;
};

export type LabReadoutGroup = {
    readonly id: string;
    readonly label: string;
    readonly items: readonly LabReadoutItem[];
};

export type LabCheck = {
    readonly label: string;
    readonly pass: boolean;
    readonly detail: string;
};

export type LabInspection = {
    readonly groups: readonly LabReadoutGroup[];
    readonly checks: readonly LabCheck[];
};

function attr(element: Element, name: string): string {
    return element.getAttribute(name) ?? "—";
}

/** 常见原生元素的隐式角色；写了 role 属性时以属性为准。只覆盖组件库里会出现的元素，查不到时为空串。 */
function implicitRole(element: Element): string {
    const tag = element.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return element.hasAttribute("href") ? "link" : "";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
        const type = (element.getAttribute("type") ?? "text").toLowerCase();
        if (type === "checkbox" || type === "radio") return type;
        if (type === "range") return "slider";
        if (type === "number") return "spinbutton";
        if (type === "search") return "searchbox";
        return ["button", "submit", "reset"].includes(type) ? "button" : "textbox";
    }
    return "";
}

/** 元素的角色：role 属性，或原生元素的隐式角色；都没有为空串。 */
function rawRole(element: Element): string {
    return element.getAttribute("role")?.trim() || implicitRole(element);
}

/** 读数用的角色：隐式角色标“隐式”，没有角色为“—”。 */
export function roleOf(element: Element): string {
    const explicit = element.getAttribute("role")?.trim();
    if (explicit) return explicit;
    const implicit = implicitRole(element);
    return implicit === "" ? "—" : `${implicit}（隐式）`;
}

/** 可以从内容取名的角色（WAI-ARIA 的 name from content）；其它元素的文字不是它的名称。 */
const NAME_FROM_CONTENT = new Set(["button", "link", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "treeitem", "cell", "gridcell", "columnheader", "rowheader", "heading", "tooltip"]);

/** 读屏能读到的文字：跳过 aria-hidden 与 hidden 的子树。 */
function visibleText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
    if (!(node instanceof Element)) return "";
    if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return "";
    return Array.from(node.childNodes, visibleText).join("");
}

const squash = (text: string): string => text.replace(/\s+/gu, " ").trim();

/**
 * 近似的可访问名称，按来源的先后：aria-labelledby、aria-label、关联的 label、可以从内容取名的角色的文字、title。
 * 空白当作没写；隐藏的文字不算。
 */
export function accessibleName(element: Element): string {
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
        const text = squash(labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? "").join(" "));
        if (text) return text;
    }
    const ariaLabel = squash(element.getAttribute("aria-label") ?? "");
    if (ariaLabel) return ariaLabel;
    if (element.id) {
        const label = Array.from(document.querySelectorAll("label")).find((candidate) => candidate.htmlFor === element.id);
        const text = label === undefined ? "" : squash(visibleText(label));
        if (text) return text;
    }
    const wrapping = element.closest("label");
    if (wrapping !== null && wrapping !== element) {
        const text = squash(visibleText(wrapping));
        if (text) return text;
    }
    if (NAME_FROM_CONTENT.has(rawRole(element))) {
        const text = squash(visibleText(element));
        if (text) return text;
    }
    return squash(element.getAttribute("title") ?? "");
}

/**
 * @param canvas 画布盒子：“画布边界”检查看元素有没有越出它。传送到页面根上的浮层不在画布里，这一项对它们不判。
 */
export function inspectElement(element: HTMLElement, canvas: HTMLElement | null): LabInspection {
    const styles = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    const groups: LabReadoutGroup[] = [
        {id: "aria", label: "ARIA 与属性", items: [
            {label: "role", value: roleOf(element)},
            {label: "可访问名称", value: accessibleName(element) || "—"},
            {label: "aria-describedby", value: attr(element, "aria-describedby")},
            {label: "aria-invalid", value: attr(element, "aria-invalid")},
            {label: "aria-expanded", value: attr(element, "aria-expanded")},
            {label: "aria-checked", value: attr(element, "aria-checked")},
            {label: "disabled", value: attr(element, "disabled")},
            {label: "readonly", value: attr(element, "readonly")},
        ]},
        {id: "box", label: "尺寸", items: [
            {label: "内边距", value: styles.padding},
            {label: "描边", value: styles.border},
            {label: "圆角", value: styles.borderRadius},
        ]},
        {id: "color", label: "颜色", items: [
            {label: "背景", value: styles.backgroundColor, swatch: styles.backgroundColor},
            {label: "文字", value: styles.color, swatch: styles.color},
        ]},
        {id: "effects", label: "阴影与滤镜", items: [
            {label: "阴影", value: styles.boxShadow || "none"},
            {label: "背景滤镜", value: styles.backdropFilter || "none"},
        ]},
        {id: "type", label: "排版", items: [
            {label: "字体", value: styles.fontFamily},
            {label: "字号", value: styles.fontSize},
            {label: "行高", value: styles.lineHeight},
            {label: "字重", value: styles.fontWeight},
        ]},
    ];

    const idCount = element.id === "" ? 0 : Array.from(document.querySelectorAll("[id]")).filter((candidate) => candidate.id === element.id).length;
    const describedBy = (element.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(Boolean);
    const describedByExists = describedBy.every((id) => document.getElementById(id) !== null);
    const expanded = element.getAttribute("aria-expanded");
    const isCombobox = rawRole(element) === "combobox";
    // 只认明确的关联：aria-controls、aria-owns 指向的元素，或它自己里面的弹出列表。扫整页会把别处的列表框算进来。
    const related = (element.getAttribute("aria-controls") ?? element.getAttribute("aria-owns") ?? "").split(/\s+/u).filter(Boolean);
    const popupExists = related.length > 0
        ? related.some((id) => document.getElementById(id) !== null)
        : element.querySelector("[role='listbox'], [role='tree'], [role='grid'], [role='dialog']") !== null;
    const name = accessibleName(element);
    const box = canvas?.getBoundingClientRect() ?? null;
    const inCanvas = canvas !== null && canvas.contains(element);
    // 1px 容差：亚像素取整
    const fits = box === null || !inCanvas || (rect.left >= box.left - 1 && rect.right <= box.right + 1);

    const checks: LabCheck[] = [
        {label: "可访问名称", pass: name.length > 0, detail: name || "缺少名称"},
        {label: "id 唯一", pass: element.id === "" || idCount === 1, detail: element.id ? `${element.id} × ${String(idCount)}` : "未设置 id"},
        {label: "aria-describedby 引用", pass: describedByExists, detail: describedBy.length === 0 ? "未设置" : describedBy.join(", ")},
        {label: "combobox 展开关系", pass: !isCombobox || expanded !== "true" || popupExists, detail: !isCombobox ? "不是 combobox" : expanded !== "true" ? "未展开" : popupExists ? "关联的弹出列表存在" : related.length === 0 ? "展开了但没有关联弹出列表（aria-controls）" : "关联的弹出列表缺失"},
        {label: "画布边界", pass: fits, detail: !inCanvas ? "不在画布里，不判" : fits ? "没有越出画布" : "越出了画布"},
    ];
    return {groups, checks};
}
