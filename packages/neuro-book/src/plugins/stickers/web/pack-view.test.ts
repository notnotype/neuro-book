/**
 * 表情包页的视图模型（docs/specs/agent/stickers.md 输出 25 到 27）：左栏与网格的分组顺序、第一项、方向键移动与删除后的去处。
 */

import {describe, expect, test} from "bun:test";

import type {StickerPackDetail, StickerPackSummary} from "../shared/contracts";
import {addCellGroup, afterRemoval, extraKey, firstPackId, gridGroups, moveSelection, railGroups, sizeLabel, stickerKey} from "./pack-view";

const summary = (id: string, source: "user" | "plugin" = "user", plugin?: {id: string; title: string | null}): StickerPackSummary => ({
    id, folder: id.slice(id.lastIndexOf(".") + 1), source, ...(plugin === undefined ? {} : {plugin}), title: id, status: "ok", count: 1, thumbnail: null, unrecognized: 0, unlisted: 0,
});

const sticker = (name: string, common: boolean, file = `${name}.png`) => ({name, file, common, width: 8, height: 8, bytes: 8, url: `/u/${file}`});
const extra = (file: string, reason: "name" | "unlisted", raw: string | null = null) => ({file, reason, raw, width: 8, height: 8, bytes: 8, url: `/u/${file}`});
const detail = (stickers: ReturnType<typeof sticker>[], extras: ReturnType<typeof extra>[] = []): StickerPackDetail => ({summary: summary("user.cat"), listed: true, token: "t", stickers, extras});

describe("左栏", () => {
  test("“我的”在前，插件按显示名（再按 id）排；第一次打开选“我的”里的第一个，没有就选第一组的", () => {
    const groups = railGroups([
      summary("acme.zoo.b", "plugin", {id: "acme.zoo", title: "动物园"}),
      summary("user.cat"),
      summary("acme.ant.a", "plugin", {id: "acme.ant", title: null}),
      summary("user.bird"),
      summary("acme.zoo.a", "plugin", {id: "acme.zoo", title: "动物园"}),
    ]);
    expect(groups.map((group) => [group.id, group.title, group.items.map((item) => item.id)])).toEqual([
      ["mine", null, ["user.bird", "user.cat"]],
      ["acme.ant", "acme.ant", ["acme.ant.a"]],
      ["acme.zoo", "动物园", ["acme.zoo.a", "acme.zoo.b"]],
    ]);
    expect(firstPackId(groups)).toBe("user.bird");
    expect(firstPackId(railGroups([summary("acme.ant.a", "plugin", {id: "acme.ant", title: null})]))).toBe("acme.ant.a");
    expect(firstPackId(railGroups([]))).toBeNull();
    // 没有自己的包时“我的”照样在（有“新建”）。
    expect(railGroups([]).map((group) => group.id)).toEqual(["mine"]);
  });
});

describe("网格分组", () => {
  test("认不出的在最前，常用、其他，没加进来的在最后；没有的组不画；选中键用文件名与名字", () => {
    const groups = gridGroups(detail([sticker("开心", true), sticker("困", false)], [extra("1.png", "name"), extra("新.png", "unlisted")]));
    expect(groups.map((group) => [group.id, group.items.map((item) => item.label)])).toEqual([["problem", ["1.png"]], ["common", ["开心"]], ["other", ["困"]], ["unlisted", ["新.png"]]]);
    expect(groups[1]!.items[0]!.key).toBe(stickerKey("开心.png", "开心"));
    expect(groups[0]!.items[0]!.key).toBe(extraKey("1.png"));
    expect(gridGroups(detail([]))).toEqual([]);
  });

  test("同一个文件写了两项：选中键不同，不会串", () => {
    const keys = gridGroups(detail([sticker("甲", true, "a.png"), sticker("乙", true, "a.png")])).flatMap((group) => group.items.map((item) => item.key));
    expect(new Set(keys).size).toBe(2);
  });

  test("“添加”格排在最后一个有表情的组末尾；没有表情时单独一行", () => {
    expect(addCellGroup(gridGroups(detail([sticker("a", true), sticker("b", false)])))).toBe("other");
    expect(addCellGroup(gridGroups(detail([sticker("a", true)], [extra("新.png", "unlisted")])))).toBe("common");
    expect(addCellGroup(gridGroups(detail([], [extra("1.png", "name")])))).toBeNull();
  });
});

describe("方向键移动选中", () => {
  // 常用 5 个、其他 3 个、没加进来 2 个，每行 3 格。
  const groups = gridGroups(detail(
    [...["a", "b", "c", "d", "e"].map((name) => sticker(name, true)), ...["f", "g", "h"].map((name) => sticker(name, false))],
    [extra("x.png", "unlisted"), extra("y.png", "unlisted")],
  ));
  const label = (key: string | null): string | undefined => groups.flatMap((group) => group.items).find((item) => item.key === key)?.label;
  const key = (name: string): string => groups.flatMap((group) => group.items).find((item) => item.label === name)!.key;
  const move = (from: string | null, direction: Parameters<typeof moveSelection>[2]): string | undefined => label(moveSelection(groups, from === null ? null : key(from), direction, 3));

  test("左右按全部表情的顺序跨组接续，两头停住；Home、End 到头尾", () => {
    expect(move("e", "ArrowRight")).toBe("f");
    expect(move("f", "ArrowLeft")).toBe("e");
    expect(move("a", "ArrowLeft")).toBe("a");
    expect(move("y.png", "ArrowRight")).toBe("y.png");
    expect(move("c", "Home")).toBe("a");
    expect(move("c", "End")).toBe("y.png");
  });

  test("上下按列数：同组内移一行，到组边进上一组末行或下一组首行的同列，没有同列取最后一格", () => {
    expect(move("a", "ArrowDown")).toBe("d");
    expect(move("c", "ArrowDown")).toBe("e");
    expect(move("e", "ArrowDown")).toBe("g");
    expect(move("c", "ArrowUp")).toBe("c");
    expect(move("d", "ArrowUp")).toBe("a");
    expect(move("g", "ArrowUp")).toBe("e");
    expect(move("h", "ArrowDown")).toBe("y.png");
    expect(move("x.png", "ArrowUp")).toBe("f");
    expect(move("y.png", "ArrowDown")).toBe("y.png");
  });

  test("还没选中时：向后的键从头，向前的键从尾；没有表情时为 null", () => {
    expect(move(null, "ArrowRight")).toBe("a");
    expect(move(null, "ArrowLeft")).toBe("y.png");
    expect(moveSelection([], null, "ArrowRight", 3)).toBeNull();
  });

  test("删掉选中的：焦点到下一格，没有就上一格，再没有为 null", () => {
    expect(label(afterRemoval(groups, key("b")))).toBe("c");
    expect(label(afterRemoval(groups, key("y.png")))).toBe("x.png");
    expect(afterRemoval(gridGroups(detail([sticker("a", true)])), stickerKey("a.png", "a"))).toBeNull();
  });
});

describe("字节数", () => {
  test("B、KB、MB", () => {
    expect([sizeLabel(512), sizeLabel(2048), sizeLabel(50 * 1024), sizeLabel(3 * 1024 * 1024)]).toEqual(["512 B", "2.0 KB", "50 KB", "3.0 MB"]);
  });
});
