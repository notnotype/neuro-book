import {describe, expect, it} from "vitest";
import {StorageContextInvalidError} from "nbook/shared/storage/storage-errors";
import {createStorageHttpError} from "nbook/server/storage/http-error";

describe("Storage HTTP 错误白名单", () => {
    it("内部诊断 reason 和路径不能进入响应", () => {
        const error = createStorageHttpError(new StorageContextInvalidError("private-path-and-credential", "private-diagnosis"));
        expect(error?.statusCode).toBe(403);
        expect(error?.data).toEqual({code: "STORAGE_CONTEXT_INVALID", message: "Storage 访问上下文已失效，请重新初始化"});
        expect(JSON.stringify(error)).not.toContain("private-");
    });
});
