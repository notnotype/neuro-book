/**
 * 呈现（`layout-project.ts`）里生成、不进文档的节点 id 的写法：带入口条的区域多一片入口条叶 `strip:<区域>`，区域节点是分支时内层分支是 `<区域节点>:sections`。
 * 文档里的节点与面板 id 撞上它们，呈现里就有两个同 id 的节点，所以布局文档的校验拒掉这样的 id（`validateLayoutDoc`）。不从包入口导出。
 */

export const STRIP_LEAF_PREFIX = "strip:";
export const INNER_SECTIONS_SUFFIX = ":sections";

/** 这个 id 按呈现生成 id 的写法会撞：以入口条叶的前缀开头，或以内层分支的后缀结尾（按字面拦，以后加区域不用改这里）。 */
export const collidesWithPresentedIds = (id: string): boolean => id.startsWith(STRIP_LEAF_PREFIX) || id.endsWith(INNER_SECTIONS_SUFFIX);
