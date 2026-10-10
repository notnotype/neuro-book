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

/** 元素的角色：role 属性，或原生元素的隐式角色（标“隐式”）。 */
export function roleOf(element: Element): string {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const implicit = implicitRole(element);
    return implicit === "" ? "—" : `${implicit}（隐式）`;
}

/** 近似的可访问名称：aria-label、aria-labelledby、关联的 label、包着它的 label，最后是文字内容。 */
export function accessibleName(element: Element): string {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
        const text = labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
        if (text) return text;
    }
    if (element.id) {
        const label = Array.from(document.querySelectorAll("label")).find((candidate) => candidate.htmlFor === element.id);
        if (label?.textContent?.trim()) return label.textContent.trim();
    }
    return element.closest("label")?.textContent?.trim() || element.textContent?.trim() || "";
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
    const isCombobox = roleOf(element).startsWith("combobox");
    const controls = element.getAttribute("aria-controls");
    const popupExists = controls === null ? document.querySelector("[role='listbox']") !== null : document.getElementById(controls) !== null;
    const name = accessibleName(element);
    const box = canvas?.getBoundingClientRect() ?? null;
    const inCanvas = canvas !== null && canvas.contains(element);
    // 1px 容差：亚像素取整
    const fits = box === null || !inCanvas || (rect.left >= box.left - 1 && rect.right <= box.right + 1);

    const checks: LabCheck[] = [
        {label: "可访问名称", pass: name.length > 0, detail: name || "缺少名称"},
        {label: "id 唯一", pass: element.id === "" || idCount === 1, detail: element.id ? `${element.id} × ${String(idCount)}` : "未设置 id"},
        {label: "aria-describedby 引用", pass: describedByExists, detail: describedBy.length === 0 ? "未设置" : describedBy.join(", ")},
        {label: "combobox 展开关系", pass: !isCombobox || expanded !== "true" || popupExists, detail: !isCombobox ? "不是 combobox" : expanded === "true" ? `弹出列表${popupExists ? "存在" : "缺失"}` : "未展开"},
        {label: "画布边界", pass: fits, detail: !inCanvas ? "不在画布里，不判" : fits ? "没有越出画布" : "越出了画布"},
    ];
    return {groups, checks};
}
