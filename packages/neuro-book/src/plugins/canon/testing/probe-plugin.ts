/**
 * `test.canon-probe`：项目子进程的测试插件，`NBOOK_TEST_PLUGINS` 含它的 id 时由项目的测试入口加入。它像剧情插件那样
 * 声明一个标注种类与一个诊断（顶层声明，走 `canon.marks`、`canon.diagnostics`），项目入口经诊断的项目内接口登记计算：
 * 每条失联的讲述报一条发现。用来在真实的项目子进程里核对两个贡献点与诊断接口的接线。只由测试启动。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {CANON_DIAGNOSTICS_POINT, CANON_MARKS_POINT} from "../backend/points";
import type {DiagnosticContribution, MarkContribution} from "../backend/points";
import {canonProjectKey} from "../shared/contracts";

export const CANON_PROBE_ID = "test.canon-probe";
export const PROBE_MARK = `${CANON_PROBE_ID}.reveal`;
export const PROBE_DIAGNOSTIC = `${CANON_PROBE_ID}.lost`;

const mark: MarkContribution = {version: 1, label: "揭示", attachTo: ["telling"], schema: {type: "object", properties: {point: {type: "string"}}, required: ["point"], additionalProperties: false}, refs: [{path: "point"}]};
const diagnostic: DiagnosticContribution = {version: 1, level: "pending", label: "讲述失联", key: ["telling"]};

export function createCanonProbeProjectPlugin(): PluginDefinition {
    return {
        id: CANON_PROBE_ID,
        contributions: [
            {capability: CANON_MARKS_POINT, id: PROBE_MARK, declaration: mark},
            {capability: CANON_DIAGNOSTICS_POINT, id: PROBE_DIAGNOSTIC, declaration: diagnostic},
        ],
        entries: [defineEntry({
            id: "project",
            location: "project",
            activationEvents: ["onStartup"],
            dependencies: [{key: canonProjectKey}],
            activate: (context) => {
                context.services.require(canonProjectKey).register({
                    dataVersion: "1",
                    compute: {
                        [PROBE_DIAGNOSTIC]: (view) => view.tellings({effective: false}).map((item) => ({key: {telling: item.telling.id}, objects: [item.owner], params: {}})),
                    },
                });
                return {};
            },
        })],
    };
}
