import {readFile} from "node:fs/promises";
import {describe, expect, it} from "vitest";

const adminRoutes = [
    "server/api/admin/users/index.get.ts",
    "server/api/admin/users/index.post.ts",
    "server/api/admin/users/[userId].patch.ts",
    "server/api/admin/users/[userId]/password.put.ts",
];

describe("admin auth contract", () => {
    it("所有管理员 API 都使用统一访问守卫", async () => {
        for (const routePath of adminRoutes) {
            const source = await readFile(routePath, "utf-8");
            expect(source, routePath).toContain("requireAdminAccess(event)");
            expect(source, routePath).not.toContain("if (isAuthEnabled())");
        }
    });
});
