import {describe, expect, it} from "vitest";
import {assertProfileArtifactDependencyGate, PROFILE_ARTIFACT_MAX_BYTES} from "nbook/server/agent/profiles/profile-artifact-compiler";

/** 构造 normalize 后形态的依赖项。 */
function dep(path: string): {path: string; sha256: string; bytes: number} {
    return {path, sha256: "0".repeat(64), bytes: 100};
}

describe("profile artifact 依赖门禁", () => {
    it("放行 DSL 表面：白名单 server 模块、shared、profile 源码与普通包", () => {
        expect(() => assertProfileArtifactDependencyGate("writer.profile.tsx", [
            dep("assets/workspace/.nbook/agent/profiles/builtin/writer.profile.tsx"),
            dep("profile-sdk/index.ts"),
            dep("profile-sdk/jsx-runtime.ts"),
            dep("server/agent/profiles/profile-dsl.ts"),
            dep("server/agent/messages/stored-message-presentation.ts"),
            dep("server/agent/plan-mode-directory.ts"),
            dep("server/workspace-files/project-manifest.ts"),
            dep("shared/agent/file-change-policy.ts"),
            dep("node_modules/.bun/typebox@1.3.6/node_modules/typebox/build/index.mjs"),
            dep("node_modules/.bun/zod@4.3.5/node_modules/zod/index.js"),
        ], 1024)).not.toThrow();
    });

    it("拦截白名单之外的宿主源码", () => {
        expect(() => assertProfileArtifactDependencyGate("bad.profile.tsx", [
            dep("server/agent/tools/web-tools.ts"),
        ], 1024)).toThrow(/依赖门禁违规[\s\S]*web-tools/u);
        expect(() => assertProfileArtifactDependencyGate("bad.profile.tsx", [
            dep("server/workspace-files/project-workspace.ts"),
        ], 1024)).toThrow(/依赖门禁违规/u);
    });

    it("拦截禁止依赖族：bun 布局与常规布局都能识别 scope", () => {
        expect(() => assertProfileArtifactDependencyGate("bad.profile.tsx", [
            dep("node_modules/.bun/jsdom@29.1.1/node_modules/jsdom/lib/api.js"),
        ], 1024)).toThrow(/禁止依赖族：jsdom/u);
        expect(() => assertProfileArtifactDependencyGate("bad.profile.tsx", [
            dep("node_modules/.bun/@prisma+client@7.8.0+6c3bd020c7966821/node_modules/@prisma/client/runtime/client.js"),
        ], 1024)).toThrow(/禁止依赖族：@prisma\/client/u);
        expect(() => assertProfileArtifactDependencyGate("bad.profile.tsx", [
            dep("node_modules/@earendil-works/pi-ai/dist/compat.js"),
        ], 1024)).toThrow(/禁止依赖族：@earendil-works\/pi-ai/u);
    });

    it("拦截超过字节上限的 artifact 并汇总多条违规", () => {
        try {
            assertProfileArtifactDependencyGate("fat.profile.tsx", [
                dep("server/plot/index.ts"),
                dep("node_modules/.bun/@libsql+client@0.17.4/node_modules/@libsql/client/lib-cjs/node.js"),
            ], PROFILE_ARTIFACT_MAX_BYTES + 1);
            expect.unreachable("门禁应当抛错");
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            expect(message).toContain("server/plot/index.ts");
            expect(message).toContain("@libsql/client");
            expect(message).toContain("超过上限");
        }
    });
});
