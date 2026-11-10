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
import {AddMarkStep, RemoveMarkStep} from "@tiptap/pm/transform";

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

export function wholeRubyPlugin(type: MarkType): Plugin {
    return new Plugin({
        key: new PluginKey("markdownWholeRuby"),
        appendTransaction(transactions, _oldState, newState) {
            let tr: Transaction | null = null;
            transactions.forEach((transaction, index) => {
                transaction.steps.forEach((step, stepIndex) => {
                    if (!(step instanceof AddMarkStep) && !(step instanceof RemoveMarkStep)) return;
                    // 在整个事务之前的文档上认注音：`addMark` 换掉同类或被排斥的标记时先生成一步去掉旧注音、再生成一步加新标记，
                    // 到第二步时旧注音已经被切开，认不出它原来盖到哪里。
                    const back = transaction.mapping.slice(0, stepIndex).invert();
                    const stepFrom = back.mapResult(step.from, 1);
                    const stepTo = back.mapResult(step.to, -1);
                    if (stepFrom.deleted || stepTo.deleted) return;
                    const left = rubyAround(transaction.before, stepFrom.pos, type);
                    const right = rubyAround(transaction.before, stepTo.pos, type);
                    if (left === null && right === null) return;
                    // 换到最终文档：经过整个事务，再经过之后的各个事务。两端都往注音里面靠，不把边上新插入的字算进来。
                    let from = transaction.mapping.map(left?.from ?? stepFrom.pos, 1);
                    let to = transaction.mapping.map(right?.to ?? stepTo.pos, -1);
                    for (const later of transactions.slice(index + 1)) {
                        from = later.mapping.map(from, 1);
                        to = later.mapping.map(to, -1);
                    }
                    if (from >= to) return;
                    // 标记步不改位置，所以几次补写共用最终文档的坐标。补写的两端都在注音的边上，下一轮不再触发。
                    tr ??= newState.tr;
                    if (step instanceof AddMarkStep) tr.addMark(from, to, step.mark);
                    else tr.removeMark(from, to, step.mark.type);
                });
            });
            return tr;
        },
    });
}
