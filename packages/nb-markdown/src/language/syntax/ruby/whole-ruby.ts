/**
 * 注音是一个整体（docs/specs/workbench/markdown-editing.md 输出 26）：加标记或去标记的一步只盖住一段注音的一部分时，在同一个
 * 撤销步里把这一步补到整段注音上。不补的话格式会把注音切成两段，每段各显示一份完整的注音，写回也是两个 `<ruby>`。
 *
 * 补在标记步上，不补在命令上：格式有好几个入口（编辑动作、StarterKit 自带的快捷键与 `**…**` 输入规则、批注与链接的命令），
 * 最后都落成 `AddMarkStep`、`RemoveMarkStep`。在注音中间带着存下的格式打字、往注音中间粘贴是替换步，这里不管，照旧拆开。
 */

import type {MarkType, Node as PMNode} from "@tiptap/pm/model";
import {Plugin, PluginKey} from "@tiptap/pm/state";
import type {Transaction} from "@tiptap/pm/state";
import {AddMarkStep, RemoveMarkStep, StepMap} from "@tiptap/pm/transform";

interface Range {
    readonly from: number;
    readonly to: number;
}

/** `pos` 落在一段注音中间（两侧是同一个注音）时这段注音的范围；在注音的边上或不在注音里时为 null。 */
function rubyAround(doc: PMNode, pos: number, type: MarkType): Range | null {
    const $pos = doc.resolve(pos);
    const before = $pos.nodeBefore;
    const after = $pos.nodeAfter;
    if (before === null || after === null) return null;
    const mark = type.isInSet(before.marks);
    if (mark === undefined || !mark.isInSet(after.marks)) return null;
    // 一段注音可以跨几个文字节点（中间某几个字另有格式），按同一个注音（属性也相同）连成一段。
    const start = $pos.start();
    let found: Range | null = null;
    let runStart: number | null = null;
    let runEnd = start;
    const close = (): void => {
        if (runStart !== null && runStart < pos && pos < runEnd) found = {from: runStart, to: runEnd};
        runStart = null;
    };
    $pos.parent.forEach((child, offset) => {
        if (mark.isInSet(child.marks)) {
            runStart ??= start + offset;
            runEnd = start + offset + child.nodeSize;
        } else {
            close();
        }
    });
    close();
    return found;
}

/**
 * 一个事务里改变过位置的步（替换步；标记步不改位置）与它们的下标。按它们在事务之前的文档与第几步之后的文档之间换算位置：
 * 只有标记步的事务（全选加粗）什么都不用换。不用 `Mapping.slice(0, i).invert()`：prosemirror-transform 的 `invert` 不看
 * `slice` 的范围，反转的是整个事务。
 */
class Moves {
    private readonly moves: ReadonlyArray<{readonly at: number; readonly map: StepMap}>;

    constructor(transaction: Transaction) {
        this.moves = transaction.steps.flatMap((step, at) => {
            const map = step.getMap();
            return map === StepMap.empty ? [] : [{at, map}];
        });
    }

    /** 第 `at` 步之前的文档里的位置，换回事务之前的文档；落在这个事务新插入的内容里时为 null。 */
    toBefore(pos: number, at: number, assoc: number): number | null {
        let mapped = pos;
        for (let index = this.moves.length - 1; index >= 0; index -= 1) {
            const move = this.moves[index]!;
            if (move.at >= at) continue;
            const result = move.map.invert().mapResult(mapped, assoc);
            if (result.deleted) return null;
            mapped = result.pos;
        }
        return mapped;
    }

    /** 第 `from` 步之前的文档里的位置，换到事务之后的文档。 */
    toAfter(pos: number, from: number, assoc: number): number {
        let mapped = pos;
        for (const move of this.moves) if (move.at >= from) mapped = move.map.map(mapped, assoc);
        return mapped;
    }
}

export function wholeRubyPlugin(type: MarkType): Plugin {
    return new Plugin({
        key: new PluginKey("markdownWholeRuby"),
        appendTransaction(transactions, _oldState, newState) {
            let tr: Transaction | null = null;
            transactions.forEach((transaction, index) => {
                const moves = new Moves(transaction);
                /**
                 * 一端换到最终文档：落在注音中间时取这段注音的边，否则取这一端自己。在整个事务之前的文档上认注音：`addMark` 换掉同类
                 * 或被排斥的标记时先生成一步去掉旧注音、再生成一步加新标记，到第二步时旧注音已经被切开，认不出它原来盖到哪里。
                 * 两端都往注音里面靠（左端 assoc 1、右端 -1），不把边上新插入的字算进来。
                 */
                const end = (pos: number, at: number, side: "left" | "right"): {readonly pos: number; readonly widened: boolean} => {
                    const assoc = side === "left" ? 1 : -1;
                    const before = moves.toBefore(pos, at, assoc);
                    const run = before === null ? null : rubyAround(transaction.before, before, type);
                    let mapped = run === null ? moves.toAfter(pos, at, assoc) : moves.toAfter(side === "left" ? run.from : run.to, 0, assoc);
                    for (const later of transactions.slice(index + 1)) mapped = later.mapping.map(mapped, assoc);
                    return {pos: mapped, widened: run !== null};
                };
                transaction.steps.forEach((step, at) => {
                    if (!(step instanceof AddMarkStep) && !(step instanceof RemoveMarkStep)) return;
                    const from = end(step.from, at, "left");
                    const to = end(step.to, at, "right");
                    if ((!from.widened && !to.widened) || from.pos >= to.pos) return;
                    // 标记步不改位置，所以几次补写共用最终文档的坐标。ProseMirror 不把插件自己追加的事务再交给它，不会循环。
                    tr ??= newState.tr;
                    if (step instanceof AddMarkStep) tr.addMark(from.pos, to.pos, step.mark);
                    // 去的是这一个标记（例如某一条批注），不是这一类：同类的别的标记不受牵连。
                    else tr.removeMark(from.pos, to.pos, step.mark);
                });
            });
            return tr;
        },
    });
}
