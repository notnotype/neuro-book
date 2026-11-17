/** 表情写法的判断（docs/specs/agent/stickers.md 的“表情写法”）：读法、转义、输入规则与宿主的目录共用这几个函数。 */
import {describe, expect, it} from "bun:test";

import {isStickerName, parseSticker, stickerAt, stickerColonEscapes, stickerEndingAt} from "./stickers";

describe("写法", () => {
    it("不带包与带包；包段可以是文件夹名或表情包 id", () => {
        expect(parseSticker(":开心:")).toEqual({raw: ":开心:", pack: null, name: "开心"});
        expect(parseSticker(":lyra/开心:")).toEqual({raw: ":lyra/开心:", pack: "lyra", name: "开心"});
        expect(parseSticker(":user.lyra/害羞_2:")).toEqual({raw: ":user.lyra/害羞_2:", pack: "user.lyra", name: "害羞_2"});
    });

    it("前后紧挨什么字都认", () => {
        const text = "今天:开心:好";
        expect(stickerAt(text, 2)?.raw).toBe(":开心:");
        expect(stickerAt("a:b:c", 1)?.raw).toBe(":b:");
    });

    it("名字不能以数字开头，所以时间不是写法；空名字、带空白、包段有大写都不是", () => {
        expect(stickerAt("10:30:00", 2)).toBeNull();
        expect(parseSticker("::")).toBeNull();
        expect(parseSticker(":开 心:")).toBeNull();
        expect(parseSticker(":Lyra/开心:")).toBeNull();
        expect(parseSticker(":lyra/:")).toBeNull();
    });

    it("名字按 NFC 比较、按码点计长：NFD 的名字认成同一个，33 个码点太长", () => {
        const nfd = "été";
        expect(parseSticker(`:${nfd}:`)?.name).toBe("été");
        expect(isStickerName("字".repeat(32))).toBe(true);
        expect(isStickerName("字".repeat(33))).toBe(false);
        expect(isStickerName("𠀀".repeat(32))).toBe(true);
    });

    it("打出结尾冒号时认最后一个写法", () => {
        expect(stickerEndingAt("今天:lyra/开心:")?.raw).toBe(":lyra/开心:");
        expect(stickerEndingAt(":ab:cd:")?.raw).toBe(":cd:");
        expect(stickerEndingAt("10:30:")).toBeNull();
        expect(stickerEndingAt("开心")).toBeNull();
    });
});

describe("文字里要转义的冒号", () => {
    it("每个能开出写法的冒号都转义，转义之后结尾的冒号可能开出下一个", () => {
        expect([...stickerColonEscapes(":a:b:")]).toEqual([0, 2]);
        expect([...stickerColonEscapes("时间 10:30:00，网址 http://x")]).toEqual([]);
        expect([...stickerColonEscapes("说:你好:再见")]).toEqual([1]);
    });
});
