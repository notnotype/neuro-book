/**
 * 星瑕样本上原型与本组 Spec 不同的地方（canon.project 场景 1 的差异清单），逐条注明依据。样本测试断言的是“原型的值
 * 按这份清单修正后”与世界算出的值相同；清单里每一条都必须真的出现，用不上的条目让测试失败。
 *
 * 写入本身的差别（不在对照里，写在这里备查）：
 * - 原型的“记工资”动作在精确档的存款上只写文字、不给数（原型给语义档准备的）。Spec 的精确档字段只接受给了数的一笔，
 *   只有文字的 `note` 拒收 `type-mismatch`（canon.model 的补丁种类与输出 23 的写入校验）。导出脚本按 3,000 记。
 */

export interface Expected {
    /** 读取位置的写法同 `replay.ts` 的 `Difference.where`。 */
    readonly where: string;
    /** 原型条目 id。 */
    readonly entry: string;
    readonly path: string;
    readonly prototype: unknown;
    readonly spec: unknown;
    readonly basis: string;
}

export const DIFFERENCES: readonly Expected[] = [
    {
        where: "初值",
        entry: "book",
        path: "appeared",
        prototype: true,
        spec: false,
        basis: "canon.model 输出 14：早于出场位置的读取位置上标“尚未出场”；《如何做个好哥哥》在第 1 章出场，初值早于第 1 章。原型把初值一律当作已出场。",
    },
];

/*
 * 回执的“在哪”整类不同，不逐条列：原型取“写到哪了”（最后一章有正文的末尾，没有正文时第 1 章开头）；Spec 取这次写入
 * 所在章的末尾，没写章时取缺省读取位置，即最新一章的末尾（canon.revisions 输出 6、canon.model 输出 21）。样本第 3 章
 * 只有细纲没有正文，所以 Spec 的回执多落在第 3 章末尾。回执的其余部分（改了哪些地址、改前改后的值、新出现与消失的
 * 待处理）逐次修订对照。
 */
