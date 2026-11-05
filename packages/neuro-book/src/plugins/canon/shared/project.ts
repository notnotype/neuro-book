/**
 * canon 给项目里别的插件的接口（docs/specs/canon/model.md “诊断的计算”、project.md 输出 24）：按调用方提供。
 *
 * - 诊断：登记自己在 `canon.diagnostics` 声明过的诊断的计算，报告数据版本；登记记在调用方的插件名下，一个插件登记不了
 *   别的插件的诊断。
 * - 快照：只读世界、带视图令牌的读取与戳，建在同一份世界与正文快照上；只在拿到它的同步段里用（中间不 `await`）。
 * - 视图：调用方开的视图记在它名下，调用方的入口停止时一起关掉。内核的视图令牌只在项目进程里流转，不要交给远程调用方：
 *   拿着它直接调 canon 就绕过了插件在视图之上的过滤。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import type {CanonReadView, DiagnosticCompute, ObjectRef, ReadPosition, ReadStamp, ViewedReads, ViewGrant} from "@notnotype/nb-canon/schema";

export interface CanonSnapshot {
    readonly view: CanonReadView;
    readonly viewed: (token: string) => ViewedReads;
    readonly stamp: ReadStamp;
}

export interface CanonProject {
    /** 登记计算（按诊断 id）与数据版本。再登记一次替换上一次的。世界还没打开时先记下，打开后接上。 */
    register(registration: {readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}): void;
    /** 插件的数据变了：之后的读取按新数据算。 */
    reportDataVersion(dataVersion: string): void;
    /** 当前这份世界的快照；世界打不开时是失败。 */
    snapshot(): Promise<CanonSnapshot | {readonly code: "world-locked" | "stopping"}>;
    openView(grant: ViewGrant): Promise<{readonly token: string} | {readonly code: string}>;
    closeView(token: string): Promise<void>;
    /** 在一张视图之上又挡掉了什么（换成占位）：记进内核的视图审计。 */
    audit(token: string, entry: {readonly method: string; readonly blocked?: readonly ObjectRef[]; readonly position?: ReadPosition}): Promise<void>;
}

export const canonProjectKey: ServiceKey<CanonProject> = defineServiceKey<CanonProject>("nbook.canon/project");
