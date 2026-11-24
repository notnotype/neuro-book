/**
 * 条目的种类（条目的 `type`，一段文字）里内置的几个词。引用字段的 `targets`、设定组的 `kinds` 都按这个词匹配，写在一处，
 * 改名时不会一处改了另一处没改。
 */
export const ENTRY_KINDS = {person: "人物", organization: "组织", place: "地点", item: "物品"} as const;
