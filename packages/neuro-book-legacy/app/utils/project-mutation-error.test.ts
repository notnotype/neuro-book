import {describe, expect, it} from "vitest";
import {FetchError} from "ofetch";
import {
    ProjectCatalogRefreshError,
    resolveProjectMutationCommitState,
} from "nbook/app/utils/project-mutation-error";

describe("Project mutation HTTP error", () => {
    it("解析 $fetch data 与 response._data 中的 committed 状态", () => {
        expect(resolveProjectMutationCommitState({
            data: {
                data: {
                    code: "PROJECT_PUBLISH_FAILED",
                    operation: "cover-update",
                    phase: "publish-manifest",
                    committed: "unknown",
                },
            },
        }, "cover-update")).toBe("unknown");
        expect(resolveProjectMutationCommitState({
            response: {
                _data: {
                    data: {
                        code: "PROJECT_LOCK_RELEASE_FAILED",
                        operation: "cover-update",
                        phase: "release",
                        committed: true,
                    },
                },
            },
        }, "cover-update")).toBe(true);
        expect(resolveProjectMutationCommitState({
            data: {data: {operation: "cover-update", committed: false}},
        }, "cover-update")).toBe(false);
    });

    it("其它 operation 或畸形字段 fail closed", () => {
        expect(resolveProjectMutationCommitState({
            data: {data: {operation: "metadata-update", committed: "unknown"}},
        }, "cover-update")).toBeNull();
        expect(resolveProjectMutationCommitState({
            data: {data: {operation: "cover-update", committed: "true"}},
        }, "cover-update")).toBeNull();
        expect(resolveProjectMutationCommitState(new Error("network"), "cover-update")).toBeNull();
    });

    it("把没有 HTTP response 的 ofetch transport failure 归类为 unknown", () => {
        const noResponse = new FetchError("transport failed");
        const withResponse = new FetchError("server rejected");
        Object.defineProperty(withResponse, "response", {value: new Response("error", {status: 500})});

        expect(resolveProjectMutationCommitState(noResponse, "cover-update")).toBe("unknown");
        expect(resolveProjectMutationCommitState(withResponse, "cover-update")).toBeNull();
    });

    it("保留 mutation 成功后 Catalog 刷新失败的 committed true", () => {
        const error = new ProjectCatalogRefreshError("delete", {cause: new Error("refresh failed")});

        expect(resolveProjectMutationCommitState(error, "delete")).toBe(true);
        expect(resolveProjectMutationCommitState(error, "create")).toBeNull();
    });
});
