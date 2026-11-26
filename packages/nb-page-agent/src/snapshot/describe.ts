/**
 * 元素的角色、名字、状态与值（docs/specs/agent/page-agent.md 输出 3）。角色与名字取 dom-accessibility-api，与读屏软件看到的一致；
 * 它不算 `aria-hidden` 的子树，所以未保存的圆点、图标这类装饰不进名字。
 */

import {computeAccessibleName, getRole} from "dom-accessibility-api";

import {collapse} from "../dom";

/** 能操作的角色：快照里一律列出。 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio",
    "option", "combobox", "slider", "spinbutton", "treeitem", "gridcell", "row", "columnheader", "rowheader",
]);

/** 带名字才列的容器角色：它们让文本树有层次，`scope` 也常指向它们。 */
export const CONTAINER_ROLES: ReadonlySet<string> = new Set([
    "dialog", "alertdialog", "menu", "menubar", "listbox", "tablist", "tree", "treegrid", "toolbar", "region", "navigation", "main",
    "complementary", "banner", "contentinfo", "form", "search", "group", "radiogroup", "tabpanel", "grid", "table", "list",
]);

/** 列表类容器与它们的行：滚出去的行折进一行摘要，列出来的行带位置。 */
export const LIST_ROLES: ReadonlySet<string> = new Set(["tree", "treegrid", "listbox", "grid", "table", "menu", "tablist"]);
export const ROW_ROLES: ReadonlySet<string> = new Set(["treeitem", "option", "row", "menuitem", "menuitemcheckbox", "menuitemradio", "tab"]);

/** 加 `includeText` 时另列的文字角色。 */
export const TEXT_ROLES: ReadonlySet<string> = new Set(["heading", "paragraph", "status", "alert", "note", "caption"]);

/** dom-accessibility-api 没有给隐式角色的几种输入框（密码、日期时间、文件、颜色）。 */
const INPUT_ROLES: Readonly<Record<string, string>> = {
    password: "textbox", date: "textbox", "datetime-local": "textbox", month: "textbox", time: "textbox", week: "textbox", file: "button", color: "button",
};

/** 有隐式角色的标签（dom-accessibility-api 的映射表加 a、area、link、img、input、select，再加本模块补的 p）。 */
const IMPLICIT_ROLE_TAGS: ReadonlySet<string> = new Set([
    "a", "area", "link", "img", "input", "select", "p", "article", "aside", "button", "datalist", "dd", "details", "dialog", "dt", "fieldset",
    "figure", "form", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "html", "legend", "li", "math", "main", "menu", "nav",
    "ol", "optgroup", "option", "output", "progress", "section", "summary", "table", "tbody", "textarea", "tfoot", "td", "th", "thead", "tr", "ul",
]);

const ROLE_PATTERN = /^[a-z][a-z-]*$/u;

/** 快照对每个元素都问一次角色：没有 role 属性的 div、span 这类元素占绝大多数，先跳过库函数。 */
export function roleOf(element: Element): string | null {
    if (!element.hasAttribute("role") && !IMPLICIT_ROLE_TAGS.has(element.localName)) {
        return element.hasAttribute("contenteditable") && element instanceof HTMLElement && element.isContentEditable ? "textbox" : null;
    }
    const role = getRole(element);
    // 显式 role 只取第一个词、不校验（库的行为）；页面能写进换行这类字符，不认它，免得原样写进快照伪造出一行。
    if (role !== null && role !== "generic" && role !== "presentation" && role !== "none" && ROLE_PATTERN.test(role)) return role;
    if (element instanceof HTMLInputElement) return INPUT_ROLES[element.type] ?? null;
    if (element instanceof HTMLElement && element.isContentEditable && element.hasAttribute("contenteditable")) return "textbox";
    if (element.localName === "p") return "paragraph";
    return null;
}

export function nameOf(element: Element): string {
    return collapse(computeAccessibleName(element));
}

/** 看得见的文字（`includeText` 与按文字定位用）：跳过 `aria-hidden`、脚本与样式。读够 `limit` 个字符就停（只用于显示时给上限）。 */
export function visibleTextOf(element: Element, limit = Infinity): string {
    let out = "";
    const visit = (node: Node): void => {
        if (out.length > limit) return;
        if (node.nodeType === Node.TEXT_NODE) {
            out += node.nodeValue ?? "";
            return;
        }
        if (!(node instanceof Element)) return;
        if (node.getAttribute("aria-hidden") === "true" || node.hasAttribute("hidden")) return;
        const tag = node.localName;
        if (tag === "script" || tag === "style" || tag === "template" || tag === "noscript") return;
        const display = getComputedStyleSafe(node)?.display;
        if (display === "none") return;
        for (const child of Array.from(flatChildNodes(node))) visit(child);
        if (display !== "inline") out += " ";
    };
    visit(element);
    return collapse(out);
}

/** 展平树里的子节点（同 `dom.ts` 的 `flatChildren`，含文字节点）。 */
function flatChildNodes(element: Element): ArrayLike<Node> {
    if (element.shadowRoot !== null) return element.shadowRoot.childNodes;
    if (element instanceof HTMLSlotElement) {
        const assigned = element.assignedNodes({flatten: true});
        if (assigned.length > 0) return assigned;
    }
    return element.childNodes;
}

function getComputedStyleSafe(element: Element): CSSStyleDeclaration | null {
    return element.ownerDocument.defaultView?.getComputedStyle(element) ?? null;
}

const BOOLEAN_STATES: ReadonlyArray<readonly [string, string]> = [
    ["aria-checked", "checked"],
    ["aria-selected", "selected"],
    ["aria-pressed", "pressed"],
    ["aria-expanded", "expanded"],
];

/** 状态（输出 3 的“状态”）：只写此刻为真的或要区分的，按固定顺序。 */
export function statesOf(element: Element, active: Element | null): string[] {
    const states: string[] = [];
    for (const [attribute, label] of BOOLEAN_STATES) {
        const value = element.getAttribute(attribute);
        if (value === "true") states.push(label);
        else if (value === "mixed") states.push(`${label}=mixed`);
        else if (value === "false" && label === "expanded") states.push("collapsed");
    }
    if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") && element.checked && !states.includes("checked")) states.push("checked");
    if (element instanceof HTMLOptionElement && element.selected && !states.includes("selected")) states.push("selected");
    const current = element.getAttribute("aria-current");
    if (current !== null && current !== "false") states.push("current");
    if (isDisabled(element)) states.push("disabled");
    if (element.getAttribute("aria-invalid") === "true") states.push("invalid");
    if (element === active) states.push("focused");
    return states;
}

function isDisabled(element: Element): boolean {
    if (element.getAttribute("aria-disabled") === "true") return true;
    return "disabled" in element && (element as HTMLButtonElement).disabled === true;
}

/** 值：输入框、下拉与滑块的当前值；密码框的值不输出（输出 3）。 */
export function valueOf(element: Element, role: string): string | undefined {
    if (element instanceof HTMLInputElement) {
        if (element.type === "password") return undefined;
        if (element.type === "checkbox" || element.type === "radio" || element.type === "button" || element.type === "submit" || element.type === "reset") return undefined;
        return element.value;
    }
    if (element instanceof HTMLTextAreaElement) return element.value;
    if (element instanceof HTMLSelectElement) return element.selectedOptions[0]?.label ?? element.value;
    if (role === "combobox" || role === "slider" || role === "spinbutton" || role === "progressbar") {
        return element.getAttribute("aria-valuetext") ?? element.getAttribute("aria-valuenow") ?? undefined;
    }
    if (element instanceof HTMLElement && element.isContentEditable && role === "textbox") return collapse(element.innerText);
    return undefined;
}
