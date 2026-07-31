import {describe, expect, it} from "vitest";
import {buildRpMapGraph, buildRpRelationGraph} from "nbook/app/components/novel-ide/rp/rp-graph";

describe("RP 玩家图谱投影", () => {
    it("地图图只包含玩家地图节点、层级边和公开路线", () => {
        const graph = buildRpMapGraph({
            nodes: [
                {id: "world", parentId: null, level: "world", label: "世界", summary: "", approximateDirection: null, status: "discovered"},
                {id: "forest", parentId: "world", level: "region", label: "森林", summary: "", approximateDirection: "东", status: "discovered"},
            ],
            routes: [{id: "road", fromId: "world", toId: "forest", label: "东路", direction: "东", distance: "近", secret: false, discoveredAtTick: 0, status: "active"}],
        });
        expect(graph.nodes.map((node) => node.id)).toEqual(["world", "forest"]);
        expect(graph.edges).toEqual(expect.arrayContaining([
            expect.objectContaining({id: "hierarchy:world->forest", label: "包含"}),
            expect.objectContaining({id: "route:road", label: "东路"}),
        ]));
    });

    it("关系图显示全部分类角色，但只接受正式关系投影中的边", () => {
        const characters = [
            {id: "player", name: "玩家", category: "player" as const, narrativeRole: "玩家化身", playerSummary: "", lastSeenTick: null, currentLocationId: null},
            {id: "npc", name: "同伴", category: "major" as const, narrativeRole: "同伴", playerSummary: "", lastSeenTick: 1, currentLocationId: "forest"},
            {id: "extra", name: "路人", category: "other" as const, narrativeRole: "其他角色", playerSummary: "", lastSeenTick: null, currentLocationId: null},
        ];
        const graph = buildRpRelationGraph(characters, [{
            id: "npc->player", sourceId: "npc", targetId: "player", dimensions: {trust: 20}, tags: ["同伴"],
        }]);
        expect(graph.nodes).toHaveLength(3);
        expect(graph.edges).toEqual([{id: "npc->player", source: "npc", target: "player", label: "同伴"}]);
    });
});
