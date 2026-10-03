import {describe, expect, it} from "vitest";
import {buildDefaultWorkspaceCreatePath} from "nbook/app/utils/workspace-create-path";

describe("workspace create path helpers", () => {
    it("builds default file and directory paths", () => {
        expect(buildDefaultWorkspaceCreatePath("file", "manuscript/")).toBe("manuscript/new-file.md");
        expect(buildDefaultWorkspaceCreatePath("directory", "manuscript/")).toBe("manuscript/new-folder");
    });

    it("places root lorebook entries under the default type directory", () => {
        expect(buildDefaultWorkspaceCreatePath("lorebook", null)).toBe("lorebook/location/new-entry");
        expect(buildDefaultWorkspaceCreatePath("lorebook", "lorebook/")).toBe("lorebook/location/new-entry");
    });

    it("keeps lorebook type directories as the default base", () => {
        expect(buildDefaultWorkspaceCreatePath("lorebook", "lorebook/character/")).toBe("lorebook/character/new-entry");
    });
});
