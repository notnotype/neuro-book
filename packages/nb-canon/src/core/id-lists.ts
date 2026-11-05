/**
 * 各种对象里哪些数组是有 id 的列表（docs/specs/canon/revisions.md 输入的“路径的写法”）：主 MDX 的块、列表字段的元素、
 * 实例字段声明、讲述。修订按 `[id]` 记它们的元素；别的数组即使元素带 `id`（决策挂的对象）也整体是一个叶子。
 *
 * 这份清单是日志格式的一部分：改了它，同一对象的修改会记成不同的路径。
 */

import type {IdListMatcher} from "./paths";
import type {ObjectKind} from "./schema";

const NEVER: IdListMatcher = () => false;

const ENTRY: IdListMatcher = (keys) => {
    if (keys.length === 2 && keys[0] === "init" && keys[1] === "text") return true;
    if (keys.length === 5 && keys[0] === "init" && keys[1] === "data" && keys[3] === "fields") return true;
    if (keys.length === 4 && keys[0] === "init" && keys[1] === "data" && keys[3] === "declared") return true;
    return keys.length === 2 && keys[0] === "retold";
};

const CHANGE: IdListMatcher = (keys) => keys.length === 1 && keys[0] === "told";

const BY_KIND: Readonly<Record<ObjectKind, IdListMatcher>> = {entry: ENTRY, change: CHANGE, check: NEVER, decision: NEVER, suggestion: NEVER};

export function idListsOf(kind: ObjectKind): IdListMatcher {
    return BY_KIND[kind];
}
