import { CardType } from "src/data/data-structures/card/questions/question";
import { findUpdatedReviewQuestion } from "src/note/review-source-tracker";
import { ParsedQuestionInfo } from "src/parser";

function question(
    text: string,
    firstLineNum: number,
    lastLineNum = firstLineNum,
): ParsedQuestionInfo {
    return new ParsedQuestionInfo(CardType.SingleLineBasic, text, firstLineNum, lastLineNum);
}

describe("findUpdatedReviewQuestion", () => {
    test("重新关联编辑过问题和答案的当前卡片", () => {
        const previousSource = "标题\n问题::旧答案\n其他::答案";
        const current = question("问题::旧答案", 1);
        const nextSource = "标题\n新问题::新答案\n其他::答案";
        const updated = question("新问题::新答案", 1);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("其他::答案", 2),
            ]),
        ).toBe(updated);
    });

    test("只改答案时使用未修改的问题边界重新关联", () => {
        const previousSource = "问题::旧答案\n其他::答案";
        const current = question("问题::旧答案", 0);
        const nextSource = "问题::新答案\n其他::答案";
        const updated = question("问题::新答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("其他::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("只改问题时使用未修改的答案边界重新关联", () => {
        const previousSource = "旧问题::答案\n其他::答案";
        const current = question("旧问题::答案", 0);
        const nextSource = "新问题::答案\n其他::答案";
        const updated = question("新问题::答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("其他::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("在答案末尾追加字符时更新当前卡片", () => {
        const previousSource = "当前::答案\n邻卡::答案";
        const current = question("当前::答案", 0);
        const nextSource = "当前::答案！\n邻卡::答案";
        const updated = question("当前::答案！", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("邻卡::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("在问题开头插入普通字符时更新当前卡片", () => {
        const previousSource = "当前::答案\n邻卡::答案";
        const current = question("当前::答案", 0);
        const nextSource = "新当前::答案\n邻卡::答案";
        const updated = question("新当前::答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("邻卡::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("当前卡片前插入一整张新卡时仍定位原卡", () => {
        const previousSource = "目标::答案\n末尾::答案";
        const current = question("目标::答案", 0);
        const nextSource = "新卡::答案\n目标::答案\n末尾::答案";
        const inserted = question("新卡::答案", 0);
        const updated = question("目标::答案", 1);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                inserted,
                updated,
                question("末尾::答案", 2),
            ]),
        ).toBe(updated);
    });

    test("删除完全相同的两张卡之一时不猜测任一旧卡的身份", () => {
        const previousSource = "重复::答案\n重复::答案";
        const first = question("重复::答案", 0);
        const second = question("重复::答案", 1);
        const nextSource = "重复::答案";
        const remaining = question("重复::答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, first, nextSource, [remaining]),
        ).toBeNull();
        expect(
            findUpdatedReviewQuestion(previousSource, second, nextSource, [remaining]),
        ).toBeNull();
    });

    test("新增完全相同的卡片时不把旧卡与新增卡混淆", () => {
        const previousSource = "重复::答案\n末尾::答案";
        const current = question("重复::答案", 0);
        const nextSource = "重复::答案\n重复::答案\n末尾::答案";

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("重复::答案", 0),
                question("重复::答案", 1),
                question("末尾::答案", 2),
            ]),
        ).toBeNull();
    });

    test.each([
        ["第一张问题", "新问题::答案\n问题::答案", "新问题::答案", "问题::答案"],
        ["第一张答案", "问题::新答案\n问题::答案", "问题::新答案", "问题::答案"],
        ["第二张问题", "问题::答案\n新问题::答案", "问题::答案", "新问题::答案"],
        ["第二张答案", "问题::答案\n问题::新答案", "问题::答案", "问题::新答案"],
    ])("无调度重复卡仅编辑%s时，两个旧问题都能精确映射", (_, nextSource, firstText, secondText) => {
        const previousSource = "问题::答案\n问题::答案";
        const first = question("问题::答案", 0);
        const second = question("问题::答案", 1);
        const updatedFirst = question(firstText, 0);
        const updatedSecond = question(secondText, 1);
        const nextQuestions = [updatedFirst, updatedSecond];

        expect(findUpdatedReviewQuestion(previousSource, first, nextSource, nextQuestions)).toBe(
            updatedFirst,
        );
        expect(findUpdatedReviewQuestion(previousSource, second, nextSource, nextQuestions)).toBe(
            updatedSecond,
        );
    });

    test("完整源块计数不会把包含相同文字的更长行当作重复", () => {
        const previousSource = "问题::答案\n前缀问题::答案";
        const current = question("问题::答案", 0);
        const nextSource = "问题::答案\n前缀问题::已修改答案";
        const unchanged = question("问题::答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                unchanged,
                question("前缀问题::已修改答案", 1),
            ]),
        ).toBe(unchanged);
    });

    test("上方插入行后按精确源范围定位，不按重复文本的索引定位", () => {
        const previousSource = "重复::答案\n重复::答案\n末尾::答案";
        const current = question("重复::答案", 1);
        const nextSource = "新增说明\n重复::答案\n重复::答案\n末尾::答案";
        const firstDuplicate = question("重复::答案", 1);
        const updated = question("重复::答案", 2);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                firstDuplicate,
                updated,
                question("末尾::答案", 3),
            ]),
        ).toBe(updated);
    });

    test("当前卡片前插入内容但自身未改动时仍能重新关联", () => {
        const previousSource = "前言::答案\n目标::答案\n结尾::答案";
        const current = question("目标::答案", 1);
        const nextSource = "前言::答案\n插入的普通说明\n目标::答案\n结尾::答案";
        const updated = question("目标::答案", 2);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("前言::答案", 0),
                updated,
                question("结尾::答案", 3),
            ]),
        ).toBe(updated);
    });

    test("删除当前卡片时不会错误认定移到原处的邻卡", () => {
        const previousSource = "当前::答案\n邻卡::答案";
        const current = question("当前::答案", 0);
        const nextSource = "邻卡::答案";

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("邻卡::答案", 0),
            ]),
        ).toBeNull();
    });

    test("当前卡片变为不符合语法的文本时返回 null", () => {
        const previousSource = "当前::答案\n邻卡::答案";
        const current = question("当前::答案", 0);
        const nextSource = "当前已失效\n邻卡::答案";

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("邻卡::答案", 1),
            ]),
        ).toBeNull();
    });

    test("删去答案中的一段文本但卡片仍有效时更新当前卡片", () => {
        const previousSource = "当前::多余答案\n邻卡::答案";
        const current = question("当前::多余答案", 0);
        const nextSource = "当前::答案\n邻卡::答案";
        const updated = question("当前::答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("邻卡::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("删去问题开头的一段文本但语法仍有效时更新当前卡片", () => {
        const previousSource = "旧的当前::答案\n邻卡::答案";
        const current = question("旧的当前::答案", 0);
        const nextSource = "当前::答案\n邻卡::答案";
        const updated = question("当前::答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("邻卡::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("整张卡片被一次替换时可在严格边界下重新关联", () => {
        const previousSource = "旧问题::旧答案\n邻卡::答案";
        const current = question("旧问题::旧答案", 0);
        const nextSource = "新问题::新答案\n邻卡::答案";
        const updated = question("新问题::新答案", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("邻卡::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("唯一 block ID 可关联大范围改写后的当前卡片", () => {
        const previousSource = "旧问题::旧答案 ^stable-id\n邻卡::答案";
        const current = question("旧问题::旧答案 ^stable-id", 0);
        const nextSource = "完全不同的问题::完全不同的答案 ^stable-id\n邻卡已修改::答案";
        const updated = question("完全不同的问题::完全不同的答案 ^stable-id", 0);

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                updated,
                question("邻卡已修改::答案", 1),
            ]),
        ).toBe(updated);
    });

    test("重复 block ID 时不猜测候选卡片", () => {
        const previousSource = "旧问题::旧答案 ^stable-id";
        const current = question("旧问题::旧答案 ^stable-id", 0);
        const nextSource = "新一::答案 ^stable-id\n新二::答案 ^stable-id";

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("新一::答案 ^stable-id", 0),
                question("新二::答案 ^stable-id", 1),
            ]),
        ).toBeNull();
    });

    test("新版本重复 block ID 时不退回到位置匹配", () => {
        const previousSource = "当前::答案 ^same-id\n末尾::答案";
        const current = question("当前::答案 ^same-id", 0);
        const nextSource = "当前::答案 ^same-id\n另一张::答案 ^same-id\n末尾::答案";

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("当前::答案 ^same-id", 0),
                question("另一张::答案 ^same-id", 1),
                question("末尾::答案", 2),
            ]),
        ).toBeNull();
    });

    test("旧版本重复 block ID 时不把它当作唯一锚点", () => {
        const previousSource = "另一张::答案 ^same-id\n当前::答案 ^same-id";
        const current = question("当前::答案 ^same-id", 1);
        const nextSource = previousSource;

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("另一张::答案 ^same-id", 0),
                question("当前::答案 ^same-id", 1),
            ]),
        ).toBeNull();
    });

    test("跨多个卡片的改动没有可靠边界时返回 null", () => {
        const previousSource = "当前::旧答案\n其他::旧答案\n末尾";
        const current = question("当前::旧答案", 0);
        const nextSource = "当前已修改::答案\n其他已修改::答案\n末尾";

        expect(
            findUpdatedReviewQuestion(previousSource, current, nextSource, [
                question("当前已修改::答案", 0),
                question("其他已修改::答案", 1),
            ]),
        ).toBeNull();
    });

    test("无效的旧行号不能退化为按数组下标匹配", () => {
        const current = question("当前::答案", 3);

        expect(
            findUpdatedReviewQuestion("当前::答案", current, "当前::答案", [
                question("当前::答案", 0),
            ]),
        ).toBeNull();
    });
});
