import {captureStorageJsonValue, type StorageJsonValue} from "nbook/shared/storage/bounded-json";
import {StorageValueInvalidError, StorageValueTooLargeError} from "nbook/shared/storage/storage-errors";

/** 在接纳边界捕获并校验实际提交的不可变值，避免排队期间 caller 改写对象。 */
export function captureStorageValue(
    value: unknown,
    policy: {readonly key: string; readonly limits: {readonly maxValueBytes: number}; readonly validate: (value: unknown) => boolean},
): StorageJsonValue {
    const captured = captureStorageJsonValue(value, policy.limits.maxValueBytes);
    if (!captured.ok) {
        if (captured.kind === "oversize") throw new StorageValueTooLargeError(captured.bytes, captured.maxBytes);
        throw new StorageValueInvalidError("json", captured.reason);
    }
    if (!policy.validate(captured.value)) throw new StorageValueInvalidError("validate", `Storage 值未通过注册校验：${policy.key}`);
    return captured.value;
}
