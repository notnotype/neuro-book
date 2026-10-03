import {describe, expect, it} from "vitest";
import {profileSourceModuleSpecifiers} from "nbook/server/agent/profiles/profile-source-imports";

describe("Profile source module specifier", () => {
    it("保留 type import、re-export、side effect 与静态 dynamic import", () => {
        expect(profileSourceModuleSpecifiers(`
            import type {ProfilePrepareContext} from "nbook/server/agent/profiles/types";
            import {defineAgentProfile} from "nbook/profile-sdk";
            import "side-effect";
            export type {ReadyProjectSessionRef} from "nbook/server/workspace-files/project-session-types";
            const runtime = import("nbook/profile-sdk/jsx-runtime");
        `)).toEqual([
            "nbook/server/agent/profiles/types",
            "nbook/profile-sdk",
            "side-effect",
            "nbook/server/workspace-files/project-session-types",
            "nbook/profile-sdk/jsx-runtime",
        ]);
    });

    it("忽略注释和模板正文里的 import 示例", () => {
        expect(profileSourceModuleSpecifiers(`
            // import type {X} from "nbook/server/comment";
            /* export {Y} from "nbook/server/block"; */
            const prompt = "import {Z} from 'nbook/server/prompt';";
            import {defineAgentProfile} from "nbook/profile-sdk";
        `)).toEqual(["nbook/profile-sdk"]);
    });
});
