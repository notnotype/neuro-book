import {describe, expect, it} from "vitest";
import {
    decodePasswordInput,
    MAX_ADMIN_PASSWORD_BYTES,
    parseCreateAdminArgs,
} from "nbook/server/auth/create-admin-command";

describe("create-admin secret interface", () => {
    it("只接受username和显式stdin开关", () => {
        expect(parseCreateAdminArgs(["admin", "--password-stdin"]))
            .toEqual({username: "admin", passwordStdin: true});
        expect(parseCreateAdminArgs([])).toEqual({username: undefined, passwordStdin: false});
        expect(() => parseCreateAdminArgs(["admin", "secret"])).toThrow("不要把密码作为命令行参数");
        expect(() => parseCreateAdminArgs(["--password-stdin", "--password-stdin"])).toThrow("不能重复");
    });

    it("保留Unicode与换行原义，不trim", async () => {
        const value = " 密码-测试\r\n";
        await expect(decodePasswordInput(chunks(new TextEncoder().encode(value))))
            .resolves.toBe(value);
    });

    it("拒绝超限或非法UTF-8输入", async () => {
        await expect(decodePasswordInput(chunks(new Uint8Array(MAX_ADMIN_PASSWORD_BYTES + 1))))
            .rejects.toThrow("不能超过 4096 bytes");
        await expect(decodePasswordInput(chunks(Uint8Array.from([0xc3, 0x28]))))
            .rejects.toThrow("不是有效UTF-8");
    });
});

async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
    yield* values;
}
