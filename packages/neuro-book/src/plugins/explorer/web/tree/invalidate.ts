/**
 * 一批变更事件要让树做什么（docs/specs/workbench/files-explorer.md 的“增量刷新的依赖”）。规则集中在这里，动作执行后
 * 不各自手工刷新：经文件服务的操作与外部修改都靠事件更新树。
 *
 * 一层目录的列出结果依赖的不只是它自己的直接子项：
 * - 内容文件夹的展示名、顺序、缺失与未列入都来自内容根上的 `content.xml`，嵌套各层都依赖它；
 * - 子目录有没有正文（`body`）在上一层列出时算出，节点的 `index.md` 增删要重列上一层。
 */

import type {FileChange} from "nbook/plugins/files/shared/contracts";
import type {Scheme} from "nbook/plugins/files/shared/resource";

import {addressOf, isWithin, parentAddress} from "./address";

const MANIFEST = "content.xml";
const BODY = "index.md";

export interface Invalidation {
    /** 要重列的目录：已加载或正在列出的才有意义，其余由调用方忽略。 */
    readonly dirty: ReadonlySet<string>;
    /** 这些目录连同子树已不在原地址：缓存与在途列出作废。 */
    readonly gone: ReadonlyArray<string>;
    /** 改名：展开、选择与焦点按前缀改写到新地址。 */
    readonly moves: ReadonlyArray<{readonly from: string; readonly to: string}>;
    /** 删除：展开、选择与焦点里这些地址及其后代移除。 */
    readonly removed: ReadonlyArray<string>;
}

/**
 * `loaded` 是当前已加载或正在列出的目录地址：清单变化要标脏同一内容根下的所有这些目录。用前缀而不是各层的
 * `contentRoot` 判断，是因为正在列出的目录还没有结果可看。
 */
export function invalidation(scheme: Scheme, events: ReadonlyArray<FileChange>, loaded: Iterable<string>): Invalidation {
    const dirty = new Set<string>();
    const gone: string[] = [];
    const moves: Array<{from: string; to: string}> = [];
    const removed: string[] = [];
    const known = [...loaded];
    const touch = (address: string): void => {
        const parent = parentAddress(address);
        if (parent !== null) dirty.add(parent);
        // 目录自身的“changed”可能是被整个替换了：它自己的列出也要重做。
        dirty.add(address);
        const name = address.slice(address.lastIndexOf("/") + 1);
        if (name === MANIFEST && parent !== null) {
            for (const directory of known) if (isWithin(directory, parent)) dirty.add(directory);
        }
        if (name === BODY && parent !== null) {
            const grandparent = parentAddress(parent);
            if (grandparent !== null) dirty.add(grandparent);
        }
    };
    for (const event of events) {
        const address = addressOf(scheme, event.path);
        if (event.type === "renamed") {
            const from = addressOf(scheme, event.from);
            touch(from);
            touch(address);
            gone.push(from);
            moves.push({from, to: address});
        } else if (event.type === "deleted") {
            touch(address);
            gone.push(address);
            removed.push(address);
        } else {
            touch(address);
        }
    }
    return {dirty, gone, moves, removed};
}
