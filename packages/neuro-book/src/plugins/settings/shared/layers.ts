/**
 * 层快照与合成：拥有者发布层快照，每个实例按本实例可用的层合成有效值（docs/specs/settings/configuration.md 输出 5、6、10）。
 * 两端共用，不碰文件。
 */

import {Value} from "typebox/value";

import {isJson} from "nbook/shared/settings";
import type {SettingDeclaration, SettingLayer, SettingSource, SettingsFailure, WrittenSettingDeclaration} from "nbook/shared/settings";

/** 拥有者进程的启动标识加进程内单调递增的序号；只有启动标识相同的两个修订号可以比较先后。 */
export interface Revision {
    readonly boot: string;
    readonly seq: number;
}

/**
 * 一条声明与它的声明者。层的规则只看 schema、默认值与允许的层，不看文字，所以按作者写下的类型收：没经插件宿主登记的
 * `defineSetting` 结果也能直接用。
 */
export interface DeclaredSetting {
    readonly plugin: string;
    readonly declaration: WrittenSettingDeclaration;
}

/** 经插件宿主登记、已接受的一条（`acceptedSettings` 的结果）：声明已由贡献点补全，标题总有值。 */
export interface AcceptedSetting extends DeclaredSetting {
    readonly declaration: SettingDeclaration;
}

/** 对一个键的写入：设成某个值，或从这一层删除。 */
/** 比较后写入的期望：这一层里这个键当前没有，或是这个值（按 `canonical` 比）。 */
export type LayerExpectation = {readonly present: false} | {readonly present: true; readonly value: unknown};

export type LayerEdit = ({readonly kind: "set"; readonly value: unknown} | {readonly kind: "delete"}) & {readonly expect?: LayerExpectation};

/** 期望与这一层的当前值对不对得上；没有期望时总是对得上。 */
export function expectationHolds(expect: LayerExpectation | undefined, values: Readonly<Record<string, unknown>>, key: string): boolean {
    if (expect === undefined) return true;
    const present = Object.hasOwn(values, key);
    if (!expect.present) return !present;
    return present && canonical(values[key]) === canonical(expect.value);
}

/** 拥有者对一次写入的结果：成功带回写后的层快照。 */
export type LayerWriteResult = {readonly ok: true; readonly snapshot: LayerSnapshot} | {readonly ok: false; readonly code: SettingsFailure; readonly detail: string};

/** 文本里的位置，行与列从 1 起（`invalid-text` 用）。 */
export interface LayerTextPosition {
    readonly line: number;
    readonly column: number;
}

/** 整份读这一层的设置文件（configuration.md 输出 24）：`revision` 是原始文本的摘要。 */
export type LayerTextRead =
    | {readonly ok: true; readonly text: string; readonly revision: string; readonly exists: boolean}
    | {readonly ok: false; readonly code: SettingsFailure; readonly detail: string};

/** 整份写：成功带回新的修订号与写后的层快照。 */
export type LayerTextWrite =
    | {readonly ok: true; readonly revision: string; readonly snapshot: LayerSnapshot}
    | {readonly ok: false; readonly code: SettingsFailure; readonly detail: string; readonly position?: LayerTextPosition};

export interface LayerProblem {
    readonly key: string;
    readonly reason: "invalid-value" | "layer-not-allowed";
}

/** 一层的公开内容。`values` 只含已声明、符合 schema、本层允许的键，深冻结。 */
export type LayerContent =
    | {readonly status: "ok"; readonly values: Readonly<Record<string, unknown>>; readonly problems: ReadonlyArray<LayerProblem>}
    /**
     * 文件当前无效：`values` 与 `problems` 是上一份有效内容的（启动时即无效则为空），写入一律拒绝。`reason` 是不含位置的
     * 原因，`position` 是出错处（configuration.md 输出 5）；文件读不出来这类没有语法位置的无效，两者都缺省，窗口只能
     * 打开文件、不定位。
     */
    | {
          readonly status: "invalid";
          readonly values: Readonly<Record<string, unknown>>;
          readonly problems: ReadonlyArray<LayerProblem>;
          readonly detail: string;
          readonly reason?: string;
          readonly position?: LayerTextPosition;
      };

/**
 * 拥有者发布的层快照：内容加修订号。`path` 是这一层文件的绝对路径，给设置窗口在层无效时指给用户看
 * （configuration.md 输出 23）；拥有者不发路径时缺省。路径不参与内容比较：同一个拥有者的路径不变。
 */
export type LayerSnapshot = LayerContent & {readonly revision: Revision; readonly path?: string};

/**
 * 收到的快照能不能替换当前的：同一启动标识下序号更大才替换，写入结果与订阅推送乱序到达时不倒退。启动标识不同说明
 * 拥有者换了进程（重新订阅到了新的拥有者），以新的为准。
 */
export function supersedes(next: Revision, current: Revision | null): boolean {
    if (current === null || next.boot !== current.boot) return true;
    return next.seq > current.seq;
}

/**
 * 两份快照是否在公开内容上相同（状态、键值、被丢弃的键、无效原因与出错位置），不看修订号：拥有者重读后都相同时不发布
 * （输出 10）。值都是 JSON，按规范化的 JSON 文本比较。
 */
export function sameContent(left: LayerContent, right: LayerContent): boolean {
    return canonical(contentOf(left)) === canonical(contentOf(right));
}

function contentOf(snapshot: LayerContent): unknown {
    return snapshot.status === "ok"
        ? {status: "ok", values: snapshot.values, problems: snapshot.problems}
        : {status: "invalid", values: snapshot.values, problems: snapshot.problems, detail: snapshot.detail, reason: snapshot.reason, position: snapshot.position};
}

/** 键按码元顺序排列的 JSON 文本；值只来自 JSON 文本或已校验的 JSON 值。 */
export function canonical(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) => {
        if (typeof item !== "object" || item === null || Array.isArray(item)) return item;
        const record = item as Record<string, unknown>;
        return Object.fromEntries(Object.keys(record).sort().map((key) => [key, record[key]]));
    });
}

/** 一个键在本实例的有效值：允许的层里最具体的那一层的值，没有则取默认值（输出 6）。对象整体覆盖，不合并。 */
export function effectiveOf(key: string, declaration: WrittenSettingDeclaration, layers: Readonly<Partial<Record<SettingLayer, Readonly<Record<string, unknown>>>>>): {readonly value: unknown; readonly source: SettingSource} {
    for (const layer of ["project", "user"] as const) {
        const values = layers[layer];
        if (values === undefined || !declaration.layers.includes(layer) || !Object.hasOwn(values, key)) continue;
        return {value: values[key], source: layer};
    }
    return {value: declaration.default, source: "default"};
}

/**
 * 写入的核对（configuration.md 输出 11 的顺序：已声明、声明者、值、允许的层）。实例在选路前、拥有者在落盘前各做一遍：
 * 实例给调用方正确的失败原因，拥有者守住副作用的边界，两处用同一个函数，顺序不会走样。
 */
export function writeProblem(plugin: string | null, key: string, declared: DeclaredSetting | undefined, edit: LayerEdit, layer: SettingLayer): WriteProblem | null {
    if (declared === undefined) return {code: "undeclared", detail: `配置项 ${key} 没有被接受的声明`};
    if (plugin !== declared.plugin) return {code: "denied", detail: `配置项 ${key} 由 ${declared.plugin} 声明，${plugin ?? "宿主"} 不能写`};
    return contentProblem(key, declared, edit, layer);
}

/**
 * 用户编辑的核对（configuration.md 输出 19）：与 `writeProblem` 相同，只是不看声明者。调用方是不是 `nbook.settings`
 * 由拥有者按内核填写的身份另行核对。
 */
export function userEditProblem(key: string, declared: DeclaredSetting | undefined, edit: LayerEdit, layer: SettingLayer): WriteProblem | null {
    if (declared === undefined) return {code: "undeclared", detail: `配置项 ${key} 没有被接受的声明`};
    return contentProblem(key, declared, edit, layer);
}

export interface WriteProblem {
    readonly code: SettingsFailure;
    readonly detail: string;
}

function contentProblem(key: string, declared: DeclaredSetting, edit: LayerEdit, layer: SettingLayer): WriteProblem | null {
    if (edit.kind === "set" && !isJson(edit.value)) return {code: "invalid-value", detail: "值不是 JSON 能如实表示的值"};
    if (edit.kind === "set" && !Value.Check(declared.declaration.schema, edit.value)) return {code: "invalid-value", detail: `值不符合配置项 ${key} 的 schema`};
    if (!declared.declaration.layers.includes(layer)) return {code: "layer-not-allowed", detail: `配置项 ${key} 不允许写 ${layer} 层`};
    return null;
}
