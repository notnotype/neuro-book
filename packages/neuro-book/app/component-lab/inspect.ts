/**
 * 「检查」模式的元素描述。
 *
 * 存在的理由很具体：维护者要能指着界面上任意一处告诉别人或 Agent「我要调的是这里」。
 * 产出的不是无序的调试转储，而是一段**能直接贴进对话、供开发者或 AI Agent 秒级定位源码的结构化信息**：
 * - 纯净选择器路径（剔除瞬态调试类名、折叠无语义的布局 div、组件内元素自动锚定到 [data-lab-subject]）
 * - 目标标签片段（含关键属性、角色与干净语义类名，彻底过滤冗长 Tailwind 原子类）
 * - 关键可见文本摘要
 * - 组件名、所属业务宿主组件与源码文件
 */

/**
 * 瞬态类名黑名单：取色针开启或检查高亮时临时附加的类名，绝对不进入选择器与标签片段。
 */
const TRANSIENT_CLASSES = new Set([
    "lab-root--inspecting",
    "lab-picked-marker",
    "lab-highlight-box",
]);

/**
 * 语义类名的前缀白名单。
 * 覆盖 Lab、公共 UI 库以及业务各核心领域前缀与常见命名规范。
 */
const SEMANTIC_CLASS_PREFIXES = [
    "lab-",
    "nb-lab-",
    "nb-ui-",
    "desktop-title-bar",
    "workbench-",
    "agent-",
    "editor-",
    "status-bar",
    "novel-",
    "composer-",
];

const ATOMIC_PREFIX_REGEX = /^(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|w|h|min-w|max-w|min-h|max-h|gap|space|top|bottom|left|right|z|opacity|duration|delay|order|col|row)-/;

const ATOMIC_EXACT_SET = new Set([
    "flex", "grid", "inline", "inline-flex", "inline-block", "block", "hidden",
    "relative", "absolute", "fixed", "sticky",
    "items-start", "items-end", "items-center", "items-baseline", "items-stretch",
    "justify-start", "justify-end", "justify-center", "justify-between", "justify-around", "justify-evenly",
    "shrink", "shrink-0", "grow", "grow-0",
    "truncate", "break-all", "break-words", "whitespace-nowrap",
    "select-none", "select-text", "select-all", "pointer-events-none", "pointer-events-auto",
    "border", "border-t", "border-b", "border-l", "border-r",
    "rounded", "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-full",
    "shadow", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xs",
    "transition", "transition-all", "transition-colors", "transition-opacity",
    "cursor-pointer", "cursor-not-allowed", "cursor-default",
    "overflow-hidden", "overflow-auto", "overflow-visible", "overflow-scroll",
    "overflow-x-auto", "overflow-y-auto",
    "outline-none", "box-border",
]);

/** 路径最多回溯几层。在局部容器或 [data-lab-subject] 范围内足够精准，避免长路径爆炸。 */
const MAX_PATH_DEPTH = 5;

/** 类名清单最多展示几条，其余折叠成计数。 */
export const INSPECT_CLASS_LIMIT = 12;

export type InspectedNode = {
    tag: string;
    id: string;
    classes: string[];
    /** 从局部/语义锚点写到自身的选择器路径，形如 `[data-lab-subject] > div.agent-composer-toolbar > button`。 */
    selector: string;
    /** 拥有这个 DOM 节点的 Vue 组件名；取不到时为空串。 */
    componentName: string;
    /** 该组件的源文件（仅开发构建有）；取不到时为空串。 */
    componentFile: string;
    /**
     * 如果该组件是底层 UI 零件（如 Button、FormSelect），向上追溯到的业务宿主组件名。
     * 如：在 AgentComposerToolbar 中使用了 Button，则 hostComponentName 为 "AgentComposerToolbar"。
     */
    hostComponentName?: string;
    hostComponentFile?: string;
    width: number;
    height: number;
    /** 带 data-lab-subject，也就是 fixture 标出的「被测零件本体」。 */
    isSubject: boolean;
    /** 元素的可见文本内容摘要（截取前 40 字符）。 */
    text?: string;
    /** 开始标签 DOM 片段，如 `<button type="button" class="..." title="...">` */
    snippet?: string;
    /** 关键属性（如 role, aria-label, title, placeholder, type）。 */
    keyAttributes?: Record<string, string>;
};

export function isTransientClass(name: string): boolean {
    return TRANSIENT_CLASSES.has(name) || name.startsWith("lab-root--inspecting");
}

export function isSemanticClass(name: string): boolean {
    if (isTransientClass(name)) return false;
    // 图标类名（i-lucide-*）属于极高价值的语义类名
    if (name.startsWith("i-lucide-")) return true;
    // 命中前缀白名单
    if (SEMANTIC_CLASS_PREFIXES.some((prefix) => name.startsWith(prefix))) return true;
    // 命中 BEM 结构（含有双下划线或双连字符），且不是原子修饰符
    if (name.includes("__") || name.includes("--")) {
        if (!name.includes(":") && !name.includes("[")) return true;
    }
    // 排除含有方括号、冒号的原子类
    if (name.includes("[") || name.includes("]") || name.includes(":")) return false;
    // 排除常见原子类
    if (ATOMIC_EXACT_SET.has(name)) return false;
    if (ATOMIC_PREFIX_REGEX.test(name)) return false;
    if (/^(?:text|bg|border|ring|stroke|fill)-(?:[a-z]+|[0-9]+)/.test(name)) return false;

    return false;
}

function escapeCss(str: string): string {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
        return CSS.escape(str);
    }
    return str.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

/** 单个元素的选择器片段。同层有多个同样写法的兄弟时才补 nth-child。 */
function selectorPart(element: Element): string {
    if (element.id !== "") {
        return `#${escapeCss(element.id)}`;
    }
    const tag = element.tagName.toLowerCase();
    const semantic = [...element.classList].filter(isSemanticClass).slice(0, 2);
    const base = tag + semantic.map((name) => `.${escapeCss(name)}`).join("");

    const parent = element.parentElement;
    if (parent === null) {
        return base;
    }
    const siblings = [...parent.children];
    let sameShape = 0;
    try {
        sameShape = siblings.filter((node) => node.matches(base)).length;
    } catch {
        return base;
    }
    if (sameShape <= 1) {
        return base;
    }
    return `${base}:nth-child(${siblings.indexOf(element) + 1})`;
}

/**
 * 判断一个中间节点是否有保留在选择路径中的语义价值。
 * 纯布局包裹性质的裸 div / span（无 id、无语义类名、非目标叶子节点）予以折叠，
 * 避免生成大量无意义的 `div > div > div` 污染选择器。
 */
function isSignificantNode(element: Element, isLeaf: boolean): boolean {
    if (isLeaf) return true;
    if (element.id !== "") return true;
    if (element.hasAttribute("data-lab-subject")) return true;
    if ([...element.classList].some(isSemanticClass)) return true;
    // 具有独特结构语义的标签予以保留
    const tag = element.tagName.toLowerCase();
    if (["form", "button", "input", "textarea", "select", "nav", "header", "footer", "main", "section", "article", "ul", "ol", "li", "table"].includes(tag)) {
        return true;
    }
    return false;
}

/**
 * Reka UI 等无头组件库的内部包装原语。
 * 检查器在查找「拥有这个节点的 Vue 组件」时，应当穿透这些无头包装，
 * 向上定位到维护者真正关心的业务组件（如 FormSelect、Dropdown、Button 等）。
 */
const TRANSPARENT_PRIMITIVE_NAMES = new Set([
    "Primitive",
    "PrimitiveSlot",
    "Slot",
    "PopperAnchor",
    "PopperRoot",
    "PopperPortal",
    "PopperContent",
    "SelectRoot",
    "SelectTrigger",
    "SelectPortal",
    "SelectContent",
    "SelectViewport",
    "SelectItem",
    "SelectItemText",
    "SelectItemIndicator",
    "PopoverRoot",
    "PopoverTrigger",
    "PopoverPortal",
    "PopoverContent",
    "DropdownMenuRoot",
    "DropdownMenuTrigger",
    "DropdownMenuPortal",
    "DropdownMenuContent",
    "DropdownMenuItem",
    "DialogRoot",
    "DialogTrigger",
    "DialogPortal",
    "DialogOverlay",
    "DialogContent",
    "TooltipRoot",
    "TooltipTrigger",
    "TooltipPortal",
    "TooltipContent",
]);

/**
 * 通用底层控件清单（无业务属性的公共基础零件）。
 * 遇到这些组件时，除记录组件自身外，进一步向上查找引用它的业务宿主组件。
 */
const GENERIC_LEAF_COMPONENTS = new Set([
    "Button",
    "IconButton",
    "Switch",
    "SegmentedControl",
    "FormSelect",
    "Icon",
    "NbIcon",
    "HighlightBox",
    ...TRANSPARENT_PRIMITIVE_NAMES,
]);

export type VueOwnerInfo = {
    name: string;
    file: string;
    hostName?: string;
    hostFile?: string;
};

/**
 * 格式化组件名称：若为自动生成的超长目录串，提取 .vue 源码文件的实际文件名。
 */
function cleanComponentName(rawName: string, file: string): string {
    if (file !== "") {
        const normalized = file.replaceAll("\\", "/");
        const filename = normalized.split("/").pop();
        if (filename && filename.endsWith(".vue")) {
            return filename.slice(0, -4);
        }
    }
    return rawName;
}

/**
 * 找到拥有这个 DOM 节点的 Vue 组件及其业务宿主。
 *
 * `__vueParentComponent` 与 `type.__file` 都只在开发构建里存在——Lab 本身就是开发工具，
 * 但这里仍然逐层判空：生产构建下拿不到就当没有，不能让检查功能整个失效。
 */
export function vueOwner(element: Element): VueOwnerInfo {
    let node: Element | null = element;
    let leafOwner = {name: "", file: ""};
    let hostOwner = {name: "", file: ""};
    let fallbackOwner = {name: "", file: ""};

    while (node !== null) {
        let instance = (node as unknown as {__vueParentComponent?: unknown}).__vueParentComponent as
            {type?: {__name?: string; name?: string; __file?: string}; parent?: unknown} | undefined;
        while (instance !== undefined && instance !== null) {
            const type = instance.type ?? {};
            const rawName = type.__name ?? type.name ?? "";
            const file = type.__file ?? "";
            const name = cleanComponentName(rawName, file);
            if (name !== "") {
                if (TRANSPARENT_PRIMITIVE_NAMES.has(name) && file === "") {
                    if (fallbackOwner.name === "") {
                        fallbackOwner = {name, file};
                    }
                } else if (leafOwner.name === "") {
                    leafOwner = {name, file};
                    if (!GENERIC_LEAF_COMPONENTS.has(name)) {
                        hostOwner = {name, file};
                        return {
                            name: leafOwner.name,
                            file: leafOwner.file,
                            hostName: hostOwner.name,
                            hostFile: hostOwner.file,
                        };
                    }
                } else if (hostOwner.name === "" && !GENERIC_LEAF_COMPONENTS.has(name)) {
                    hostOwner = {name, file};
                    return {
                        name: leafOwner.name,
                        file: leafOwner.file,
                        hostName: hostOwner.name,
                        hostFile: hostOwner.file,
                    };
                }
            }
            instance = instance.parent as typeof instance;
        }
        node = node.parentElement;
    }

    const resolvedLeaf = leafOwner.name !== "" ? leafOwner : fallbackOwner;
    return {
        name: resolvedLeaf.name,
        file: resolvedLeaf.file,
        hostName: hostOwner.name || resolvedLeaf.name,
        hostFile: hostOwner.file || resolvedLeaf.file,
    };
}

/** 源文件路径裁到包内相对位置：绝对路径贴进对话里没人读得动。 */
export function shortenFile(file: string): string {
    if (file === "") {
        return "";
    }
    const normalized = file.replaceAll("\\", "/");
    const marker = normalized.lastIndexOf("/packages/");
    return marker === -1 ? normalized : normalized.slice(marker + 1);
}

/** 提取关键语义属性，帮助在源码中通过属性唯一性快速 grep。 */
export function extractKeyAttributes(element: HTMLElement): Record<string, string> {
    const attrs: Record<string, string> = {};
    const candidateKeys = ["role", "aria-label", "title", "placeholder", "name", "type", "href"];
    for (const key of candidateKeys) {
        const val = element.getAttribute(key);
        if (val) {
            attrs[key] = val;
        }
    }
    for (let i = 0; i < element.attributes.length; i++) {
        const attr = element.attributes[i];
        if (attr && (attr.name.startsWith("data-test") || (attr.name.startsWith("data-lab-") && attr.name !== "data-lab-inspect-exempt"))) {
            attrs[attr.name] = attr.value;
        }
    }
    return attrs;
}

/** 提取开始标签 DOM 片段，优先提取语义类名并过滤冗长原子类，大幅降噪。 */
export function extractSnippet(element: HTMLElement): string {
    const tag = element.tagName.toLowerCase();
    const parts: string[] = [tag];
    if (element.id !== "") {
        parts.push(`id="${element.id}"`);
    }

    // 优先提取语义类名（过滤掉 flex, w-full, p-4 等纯原子类），避免标签被巨量 Tailwind 样式淹没
    const semanticClasses = [...element.classList].filter(isSemanticClass);
    // 如果没有语义类名，最多保留前 3 个简要类名避免 class 为空
    const displayClasses = semanticClasses.length > 0
        ? semanticClasses
        : [...element.classList].filter((c) => !isTransientClass(c) && !c.includes("[") && !c.includes(":")).slice(0, 3);

    if (displayClasses.length > 0) {
        parts.push(`class="${displayClasses.join(" ")}"`);
    }
    const attrs = extractKeyAttributes(element);
    for (const [k, v] of Object.entries(attrs)) {
        parts.push(`${k}="${v}"`);
    }
    return `<${parts.join(" ")}>`;
}

/** 提取直接可见文本摘要。 */
export function extractDirectText(element: HTMLElement): string {
    const raw = (element.innerText || element.textContent || "").trim();
    const singleLine = raw.replace(/\s+/g, " ");
    return singleLine.length > 40 ? `${singleLine.slice(0, 40)}...` : singleLine;
}

export function describeNode(element: HTMLElement): InspectedNode {
    const subjectEl = element.closest("[data-lab-subject]");
    const isSubject = element === subjectEl || element.hasAttribute("data-lab-subject");
    const chain: string[] = [];
    let node: HTMLElement | null = element;

    if (subjectEl && element !== subjectEl) {
        // 如果在被测主体内部：向上回溯到 subject 为止，跳过无语义的纯布局 div
        while (node !== null && node !== subjectEl && chain.length < MAX_PATH_DEPTH) {
            if (isSignificantNode(node, node === element)) {
                chain.unshift(selectorPart(node));
                if (node.id !== "") break;
            }
            node = node.parentElement;
        }
        chain.unshift("[data-lab-subject]");
    } else {
        // 如果在被测主体自身，或在 Lab 外部外壳：向上回溯，过滤无意义布局 div
        while (node !== null && chain.length < MAX_PATH_DEPTH) {
            if (isSignificantNode(node, node === element)) {
                chain.unshift(selectorPart(node));
                if (node.id !== "") break;
                if (["MAIN", "NAV", "HEADER", "ASIDE"].includes(node.tagName) && node !== element) {
                    break;
                }
            }
            if (node.parentElement && node.parentElement.classList.contains("lab-root")) {
                break;
            }
            node = node.parentElement;
        }
    }

    const box = element.getBoundingClientRect();
    const owner = vueOwner(element);
    const classes = [...element.classList].filter((c) => !isTransientClass(c));
    const text = extractDirectText(element);
    const snippet = extractSnippet(element);
    const keyAttributes = extractKeyAttributes(element);

    return {
        tag: element.tagName.toLowerCase(),
        id: element.id,
        classes,
        selector: chain.join(" > "),
        componentName: owner.name,
        componentFile: shortenFile(owner.file),
        hostComponentName: owner.hostName !== owner.name ? owner.hostName : undefined,
        hostComponentFile: owner.hostFile && owner.hostFile !== owner.file ? shortenFile(owner.hostFile) : undefined,
        width: Math.round(box.width),
        height: Math.round(box.height),
        isSubject,
        text: text !== "" ? text : undefined,
        snippet,
        keyAttributes,
    };
}

/** 框旁边那行短标签。信息密度按「一眼能读完」裁，完整信息在检视面板里。 */
export function nodeLabel(node: InspectedNode): string {
    const head = node.hostComponentName || node.componentName || node.tag;
    const textDesc = node.text ? ` "${node.text.length > 12 ? node.text.slice(0, 12) + "..." : node.text}"` : "";
    return `${head}${textDesc}  ${node.width} × ${node.height}`;
}

/** 复制到剪贴板的那段文本，结构清晰、信噪比高、无冗余样式垃圾。 */
export function nodeReport(node: InspectedNode): string {
    const lines: string[] = [];

    lines.push(`元素  ${node.selector}`);

    if (node.hostComponentName && node.hostComponentName !== node.componentName) {
        lines.push(`组件  ${node.componentName} (所属宿主: ${node.hostComponentName})`);
        if (node.hostComponentFile) {
            lines.push(`源文件  ${node.hostComponentFile}`);
        } else if (node.componentFile !== "") {
            lines.push(`源文件  ${node.componentFile}`);
        }
    } else if (node.componentName !== "") {
        lines.push(`组件  ${node.componentName}`);
        if (node.componentFile !== "") {
            lines.push(`源文件  ${node.componentFile}`);
        }
    }

    if (node.snippet) {
        lines.push(`标签  ${node.snippet}`);
    }
    if (node.text) {
        lines.push(`文本  "${node.text}"`);
    }

    lines.push(`尺寸  ${node.width} × ${node.height}`);

    // 类名行：只列出有价值的语义类名，其余样式原子类折叠计数，不再无脑转储几百个字符
    const semanticClasses = node.classes.filter(isSemanticClass);
    const otherCount = node.classes.length - semanticClasses.length;
    if (semanticClasses.length > 0) {
        const extraNote = otherCount > 0 ? ` (+${otherCount} 个样式原子类)` : "";
        lines.push(`类名  ${semanticClasses.join(" ")}${extraNote}`);
    } else if (node.classes.length > 0) {
        const cleanClasses = node.classes.filter((c) => !c.includes("[") && !c.includes(":")).slice(0, 4);
        const extraCount = node.classes.length - cleanClasses.length;
        const extraNote = extraCount > 0 ? ` (+${extraCount} 个样式原子类)` : "";
        lines.push(`类名  ${cleanClasses.join(" ")}${extraNote}`);
    }

    return lines.join("\n");
}
