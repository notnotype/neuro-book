/**
 * 章的写作指示快照表（项目实例内存）：诊断的计算与简报读它，`nbook.plot/instructions` 写它。
 *
 * 表放在项目入口的 `activate` 闭包里，由这一个实例的所有调用方与诊断计算共用，不放模块级变量（同一进程里可以有几个项目）。
 * 数据版本取表内容的摘要：内容没变就不变（重复推送不会让 canon 的全部游标作废），重启后同内容得到同一个版本。
 * 换了内容，canon 的读取输入摘要随之变，旧游标 `cursor-stale`（canon.model 输出 36）。
 */

import {createHash} from "node:crypto";

import {canonicalJson} from "@notnotype/nb-canon/schema";

import type {InstructionSnapshot} from "../shared/instructions";

/** 剧情插件自己的数据版本前缀；后面接写作指示表内容的摘要，空表是 `1`。 */
export const PLOT_DATA_VERSION = "1";

export class InstructionTable {
    readonly #snapshots = new Map<string, InstructionSnapshot>();
    #version = PLOT_DATA_VERSION;

    /** 当前表的数据版本。 */
    get dataVersion(): string {
        return this.#version;
    }

    /** 从没推过（表为空）：写作指示的检查据此报“还没有快照”，不当成“查过、没有发现”。 */
    get empty(): boolean {
        return this.#snapshots.size === 0;
    }

    get(chapter: string): InstructionSnapshot | undefined {
        return this.#snapshots.get(chapter);
    }

    /** 全部快照，按章 id 排好。 */
    all(): readonly InstructionSnapshot[] {
        return [...this.#snapshots.values()].sort((a, b) => (a.chapter < b.chapter ? -1 : a.chapter > b.chapter ? 1 : 0));
    }

    /**
     * 按章替换（`null` 是删除）。`base` 给了就要等于当前数据版本，否则 `conflict`；返回新的数据版本与它是否变了。
     */
    put(chapter: string, snapshot: InstructionSnapshot | null, base?: string): {readonly ok: true; readonly dataVersion: string; readonly changed: boolean} | {readonly ok: false; readonly code: "instructions-conflict"} {
        if (base !== undefined && base !== this.#version) return {ok: false, code: "instructions-conflict"};
        const before = this.#version;
        if (snapshot === null) this.#snapshots.delete(chapter);
        else this.#snapshots.set(chapter, snapshot);
        this.#version = this.#snapshots.size === 0 ? PLOT_DATA_VERSION : `${PLOT_DATA_VERSION}+${createHash("sha256").update(canonicalJson(this.all())).digest("hex")}`;
        return {ok: true, dataVersion: this.#version, changed: this.#version !== before};
    }
}
