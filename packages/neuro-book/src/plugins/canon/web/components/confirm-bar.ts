/** `ConfirmBar` 的数据（就地改的确认条，docs/specs/canon/author-ui.md 输出 16）。 */

/** 输入控件按字段的声明：数、文字、选项、是否。 */
export type ConfirmBarKind = "number" | "text" | "enum" | "boolean";

/** 就地改的意图：“改设定”或“剧情里变了”（canon.revisions 输出 8）。 */
export type EditIntent = "creative" | "story";
