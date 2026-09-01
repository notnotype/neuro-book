/**
 * 「检查」模式的元素描述。
 *
 * 存在的理由很具体：维护者要能指着界面上任意一处告诉别人「我要调的是这里」。所以这里
 * 产出的不是调试转储，而是一段**能贴进对话的定位信息**——选择器路径、组件名、源文件。
 */

/**
 * 语义类名的前缀白名单。
 *
 * 一个元素身上通常混着两类类名：`lab-bar` 这种描述「它是什么」的，和 `flex` `shrink-0`
 * 这种描述「它怎么排」的。选择器里只有前者有用，后者放进去既长又指不准。没有通用判据能
 * 分开两者（原子类同样是合法类名），所以按本仓库的命名前缀认。
 *
 * 新增一套命名前缀时要同步加进来，否则那部分界面选出来的路径会退化成 `div:nth-child(3)`。
 */
const SEMANTIC_CLASS_PREFIXES = ["lab-", "nb-lab-", "nb-ui-"];

/** 路径最多回溯几层。再往上都是布局容器，对定位没有帮助，只会把一行撑爆。 */
const MAX_PATH_DEPTH = 4;

/** 类名清单最多展示几条，其余折叠成计数。 */
export const INSPECT_CLASS_LIMIT = 12;

export type InspectedNode = {
    tag: string;
    id: string;
    classes: string[];
    /** 从上层容器写到自身的选择器路径，形如 `div.lab-root > main > div.lab-bar`。 */
    selector: string;
    /** 拥有这个 DOM 节点的 Vue 组件名；取不到时为空串。 */
    componentName: string;
    /** 该组件的源文件（仅开发构建有）；取不到时为空串。 */
    componentFile: string;
    width: number;
    height: number;
    /** 带 data-lab-subject，也就是 fixture 标出的「被测零件本体」。 */
    isSubject: boolean;
};

function isSemanticClass(name: string): boolean {
    return SEMANTIC_CLASS_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/** 单个元素的选择器片段。同层有多个同样写法的兄弟时才补 nth-child。 */
function selectorPart(element: Element): string {
    if (element.id !== "") {
        return `#${CSS.escape(element.id)}`;
    }
    const tag = element.tagName.toLowerCase();
    const semantic = [...element.classList].filter(isSemanticClass).slice(0, 2);
    const base = tag + semantic.map((name) => `.${CSS.escape(name)}`).join("");

    const parent = element.parentElement;
    if (parent === null) {
        return base;
    }
    const siblings = [...parent.children];
    // matches 可能因为类名里含转义字符抛错，那时退回「不加 nth」而不是让整个检查挂掉
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
 * 找到拥有这个 DOM 节点的 Vue 组件。
 *
 * `__vueParentComponent` 与 `type.__file` 都只在开发构建里存在——Lab 本身就是开发工具，
 * 但这里仍然逐层判空：生产构建下拿不到就当没有，不能让检查功能整个失效。
 */
function vueOwner(element: Element): {name: string; file: string} {
    let node: Element | null = element;
    while (node !== null) {
        let instance = (node as unknown as {__vueParentComponent?: unknown}).__vueParentComponent as
            {type?: {__name?: string; name?: string; __file?: string}; parent?: unknown} | undefined;
        while (instance !== undefined && instance !== null) {
            const type = instance.type ?? {};
            const name = type.__name ?? type.name ?? "";
            if (name !== "") {
                return {name, file: type.__file ?? ""};
            }
            instance = instance.parent as typeof instance;
        }
        node = node.parentElement;
    }
    return {name: "", file: ""};
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

export function describeNode(element: HTMLElement): InspectedNode {
    const chain: string[] = [];
    let node: HTMLElement | null = element;
    while (node !== null && chain.length < MAX_PATH_DEPTH) {
        chain.unshift(selectorPart(node));
        // id 是唯一锚点，往上再走没有意义
        if (node.id !== "") {
            break;
        }
        node = node.parentElement;
    }

    const box = element.getBoundingClientRect();
    const owner = vueOwner(element);
    return {
        tag: element.tagName.toLowerCase(),
        id: element.id,
        classes: [...element.classList],
        selector: chain.join(" > "),
        componentName: owner.name,
        componentFile: shortenFile(owner.file),
        width: Math.round(box.width),
        height: Math.round(box.height),
        isSubject: element.hasAttribute("data-lab-subject"),
    };
}

/** 框旁边那行短标签。信息密度按「一眼能读完」裁，完整信息在检视面板里。 */
export function nodeLabel(node: InspectedNode): string {
    const head = node.componentName !== "" ? node.componentName : node.tag;
    return `${head}  ${node.width} × ${node.height}`;
}

/** 复制到剪贴板的那段文本，贴进对话就能定位。 */
export function nodeReport(node: InspectedNode): string {
    const lines = [`元素  ${node.selector}`];
    if (node.componentName !== "") {
        lines.push(`组件  ${node.componentName}`);
    }
    if (node.componentFile !== "") {
        lines.push(`源文件  ${node.componentFile}`);
    }
    lines.push(`尺寸  ${node.width} × ${node.height}`);
    if (node.classes.length > 0) {
        lines.push(`类名  ${node.classes.join(" ")}`);
    }
    return lines.join("\n");
}
