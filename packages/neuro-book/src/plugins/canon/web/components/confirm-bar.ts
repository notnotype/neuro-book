/** `ConfirmBar` 的数据（就地改的确认条，docs/specs/canon/author-ui.md 输出 16）。 */

/** 输入控件按字段的声明：数、文字、有建议值的文字（输入框加候选）、选项、是否、引用（条目选择器）、图片（路径与说明）。 */
export type ConfirmBarKind = "number" | "text" | "suggest" | "enum" | "boolean" | "ref" | "image";

/** 就地改的意图：“改设定”或“剧情里变了”（canon.revisions 输出 8）。 */
export type EditIntent = "creative" | "story";
