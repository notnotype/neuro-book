/**
 * 诊断的项目内接口（docs/specs/canon/model.md “诊断的计算”）：别的插件的项目入口经它登记自己在 `canon.diagnostics`
 * 声明过的诊断的计算，并报告数据版本。按调用方提供：登记记在调用方的插件名下，调用方的入口停止时登记随之失效，
 * 一个插件登记不了别的插件的诊断。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";
import type {DiagnosticCompute} from "@notnotype/nb-canon/schema";

export interface CanonDiagnostics {
    /**
     * 登记计算（按诊断 id）与数据版本（一段不透明的文字）。再登记一次替换上一次的。世界还没打开时先记下，打开后接上。
     * 计算只对这个插件在 `canon.diagnostics` 里声明过的 id 起作用。
     */
    register(registration: {readonly compute: Readonly<Record<string, DiagnosticCompute>>; readonly dataVersion: string}): void;
    /** 插件的数据变了：之后的读取按新数据算。 */
    reportDataVersion(dataVersion: string): void;
}

export const canonDiagnosticsKey: ServiceKey<CanonDiagnostics> = defineServiceKey<CanonDiagnostics>("nbook.canon/diagnostics");
