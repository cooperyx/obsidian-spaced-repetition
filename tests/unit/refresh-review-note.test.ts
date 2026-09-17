import { DataStore } from "src/data/data-store/base/data-store";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteParser } from "src/note/note-parser";
import { refreshReviewNote } from "src/note/refresh-review-note";
import { RepItemScheduleInfoOsr } from "src/scheduling/algorithms/osr/rep-item-schedule-info-osr";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

async function parseReviewNote(
    source: string,
    settings: SRSettings = { ...DEFAULT_SETTINGS },
): Promise<{ file: UnitTestSRFile; note: Note }> {
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const file = new UnitTestSRFile(source, "refresh-review-note-test");
    const note = await new NoteParser(settings).parse(file, TextDirection.Ltr, TopicPath.emptyPath);
    return { file, note };
}

describe("refreshReviewNote", () => {
    test("问答内增删高亮保持同一张卡及计划，评分保留等号原文和卡外计划", async () => {
        const source = `#flashcards

问题
?
答案 ==原重点==
<!--SR:!2023-09-10,4,270-->

独立 ==挖空==
<!--SR:!2023-09-11,5,280-->`;
        const { file, note } = await parseReviewNote(source);
        const question = note.questionList[0];
        const currentCard = question.cards[0];
        // 一次保存可能同时编辑题干和答案；问答类型和子卡片数量保持不变。
        const edited = source.replace(
            "问题\n?\n答案 ==原重点==",
            "问题 ==新重点==\n?\n答案 原重点和 ==另一重点==",
        );
        file.content = edited;

        expect(refreshReviewNote(note, DEFAULT_SETTINGS, edited)).toBe(true);
        expect(question.reviewSourceInvalid).toBe(false);
        expect(question.cards).toEqual([currentCard]);
        expect(question.cards[0]).toBe(currentCard);
        expect(currentCard.front).toBe("问题 ==新重点==");
        expect(currentCard.back).toBe("答案 原重点和 ==另一重点==");
        expect(currentCard.scheduleInfo.dueDate.format("YYYY-MM-DD")).toBe("2023-09-10");

        currentCard.scheduleInfo = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-18", 3, 270);
        await DataStore.getInstance().writeSchedule(question);
        expect(file.content).toContain("问题 ==新重点==\n?\n答案 原重点和 ==另一重点==");
        expect(file.content).toContain("<!--SR:!2023-09-18,3,270-->");
        expect(file.content).toContain("独立 ==挖空==\n<!--SR:!2023-09-11,5,280-->");
        expect(note.questionList.map((q) => q.cards.length)).toEqual([1, 1]);
    });

    test("同步编辑后的重复卡，并且保存计划只改当前卡片", async () => {
        const source = `#flashcards 重复::答案
<!--SR:!2023-09-10,4,270-->

#flashcards 重复::答案
<!--SR:!2023-09-11,5,280-->`;
        const { file, note } = await parseReviewNote(source);
        const currentQuestion = note.questionList[0];
        const currentCard = currentQuestion.cards[0];
        const siblingQuestion = note.questionList[1];
        const edited = source.replace("重复::答案", "重复::更新答案");
        file.content = edited;

        expect(refreshReviewNote(note, DEFAULT_SETTINGS, edited)).toEqual(true);
        expect(currentQuestion.cards[0]).toBe(currentCard);
        expect(currentCard.front).toEqual("重复");
        expect(currentCard.back.trimEnd()).toEqual("更新答案");

        currentCard.scheduleInfo = RepItemScheduleInfoOsr.fromDueDateStr("2023-09-21", 15, 290);
        await DataStore.getInstance().writeSchedule(currentQuestion);

        expect(file.content).toContain("<!--SR:!2023-09-21,15,290-->");
        expect(file.content).toContain("<!--SR:!2023-09-11,5,280-->");
        expect(siblingQuestion.cards[0].scheduleInfo.dueDate.format("YYYY-MM-DD")).toEqual(
            "2023-09-11",
        );
        expect(siblingQuestion.cards[0].scheduleInfo.interval).toEqual(5);
    });

    test("正文编辑后保留卡片对象，并且不改变同胞计划", async () => {
        const source = `#flashcards 问题:::答案
<!--SR:!2023-09-10,4,270!2023-09-20,8,280-->`;
        const { note } = await parseReviewNote(source);
        const question = note.questionList[0];
        const firstCard = question.cards[0];
        const siblingCard = question.cards[1];
        const siblingDueDate = siblingCard.scheduleInfo.dueDate.format("YYYY-MM-DD");
        const edited = source.replace("问题:::答案", "新问题:::新答案");

        refreshReviewNote(note, DEFAULT_SETTINGS, edited);

        expect(question.cards[0]).toBe(firstCard);
        expect(question.cards[1]).toBe(siblingCard);
        expect(firstCard.front).toEqual("新问题");
        expect(firstCard.back.trimEnd()).toEqual("新答案");
        expect(siblingCard.front.trimEnd()).toEqual("新答案");
        expect(siblingCard.back.trimEnd()).toEqual("新问题");
        expect(siblingCard.scheduleInfo.dueDate.format("YYYY-MM-DD")).toEqual(siblingDueDate);
        expect(siblingCard.scheduleInfo.interval).toEqual(8);
    });

    test("删除当前卡片且保留邻卡时，不会错误关联到邻卡", async () => {
        const source = `#flashcards
问题::答案

邻卡::内容

尾部正文`;
        const { note } = await parseReviewNote(source);
        const question = note.questionList[0];
        const card = question.cards[0];
        const edited = `#flashcards
邻卡::内容

尾部正文`;

        refreshReviewNote(note, DEFAULT_SETTINGS, edited);

        expect(question.reviewSourceInvalid).toEqual(true);
        expect(question.cards[0]).toBe(card);
        expect(card.front).toEqual("问题");
        expect(card.back).toEqual("答案");
    });

    test("破坏卡片语法时标记当前队列项失效", async () => {
        const source = "#flashcards 问题::答案";
        const { note } = await parseReviewNote(source);
        const question = note.questionList[0];
        const card = question.cards[0];

        refreshReviewNote(note, DEFAULT_SETTINGS, "#flashcards 问题和答案之间没有分隔符");

        expect(question.reviewSourceInvalid).toEqual(true);
        expect(question.cards[0]).toBe(card);
        expect(card.front).toEqual("问题");
        expect(card.back).toEqual("答案");
    });
});
