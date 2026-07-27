// RP 世界线日历配置
// 纪元零点：公元1年1月1日 00:00 (UTC)
// 格式：公元{year}年{month}月{day}日 {hour}:{minute}

export const calendar = {
    era: "公元",
    zero: new Date("0001-01-01T00:00:00.000Z"),
    format: "公元{year}年{month}月{day}日 {hour}:{minute}",
    parse: "公元{year}年{month}月{day}日 {hour}:{minute}",
};
