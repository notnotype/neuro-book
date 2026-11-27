/** `CharacterCard` 与 `LookCard` 的数据（docs/specs/canon/author-ui.md 输出 49、50）：展示层只收这些，读写在绑定层。 */

/** 一行短资料。 */
export interface CardFact {
    /** 字段名（这个命名空间里的）。 */
    readonly id: string;
    readonly label: string;
    /** 显示的值；未知时为 null（写“填写”）。 */
    readonly text: string | null;
    /** 引用的值画成链接色。 */
    readonly link?: boolean;
    /** “第 N 章改过”；只有初值时没有。 */
    readonly mark?: string;
    /** 这个条目上自己加的一项：行尾有“更多”（改名、去掉）。 */
    readonly own?: boolean;
}

/** 一段文字（现在的状态、性格、外貌这些）。 */
export interface CardPassage {
    readonly id: string;
    readonly label: string;
    readonly text: string | null;
    /** 空着时写的提示：这一段写什么。 */
    readonly hint: string;
    readonly mark?: string;
}

/** 立绘那一格（输出 49）：按同一条目上形象模块的情况。 */
export type CardPortrait =
    | {readonly status: "image"; readonly path: string; readonly alt: string}
    | {readonly status: "no-image"}
    | {readonly status: "absent"}
    | {readonly status: "removed"}
    | {readonly status: "later"; readonly from: string}
    | {readonly status: "unavailable"};

/** 衣柜里的一套（输出 50）。 */
export interface CardOutfit {
    /** 元素 id。 */
    readonly id: string;
    readonly name: string;
    readonly look: string;
    readonly image: string | null;
    readonly wearing: boolean;
}

/** 添加一项资料里的一项：预设的、去掉过的。 */
export interface CardAddable {
    readonly id: string;
    readonly label: string;
}

/**
 * 形象模块里“立绘”字段的值读成一张图：有图时是作品内路径与说明，没有图（未知、空、形状不对）时为 null。人物分页的立绘那一格
 * 与条目页页头的头像（输出 6、49）共用这一个读法。
 */
export function portraitImage(value: unknown): {readonly path: string; readonly alt: string} | null {
    const image = value as {readonly 图片?: unknown; readonly 说明?: unknown} | null | undefined;
    return typeof image?.["图片"] === "string" && image["图片"] !== "" ? {path: image["图片"], alt: typeof image["说明"] === "string" ? image["说明"] : ""} : null;
}
