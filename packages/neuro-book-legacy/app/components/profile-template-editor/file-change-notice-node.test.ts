import {describe, expect, it} from "vitest";
import {generatePreviewNodeSource} from "nbook/app/components/profile-template-editor/profile-template-source-utils";
import {createNode} from "nbook/app/components/profile-template-editor/profile-template-tree-utils";

describe("FileChangeNotice visual node", () => {
    it("新节点只声明 minimal 模式，并完整写回 TSX", () => {
        const node = createNode("FileChangeNotice");

        expect(node.props).toEqual({mode: "minimal"});
        expect(generatePreviewNodeSource(node)).toBe('<FileChangeNotice mode="minimal" />');
    });
});
