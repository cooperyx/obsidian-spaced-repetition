import { CardType } from "src/data/data-structures/card/questions/question";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS } from "src/data/settings";
import { Note } from "src/note/note";
import { NoteFileLoader } from "src/note/note-file-loader";
import { TextDirection } from "src/utils/strings";

import { UnitTestSRFile } from "./helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "./helpers/unit-test-setup";

const noteFileLoader: NoteFileLoader = new NoteFileLoader(DEFAULT_SETTINGS);

beforeAll(() => {
    unitTestSetupStandardDataStoreAlgorithm(DEFAULT_SETTINGS);
});

describe("load", () => {
    test("多行问答内的高亮不增加卡片，且保留既有计划和卡外独立高亮", async () => {
        const noteText = `#flashcards/test

问题 ==题干重点== 和 ==第二重点==
?
答案 ==答案重点==
<!--SR:!2023-09-02,4,270-->

独立 ==仍需复习==`;
        const file = new UnitTestSRFile(noteText);
        const note = await noteFileLoader.load(file, TextDirection.Ltr, TopicPath.emptyPath);

        expect(note.questionList.map((q) => q.questionType)).toEqual([
            CardType.MultiLineBasic,
            CardType.Cloze,
        ]);
        expect(note.questionList.map((q) => q.cards.length)).toEqual([1, 1]);
        const card = note.questionList[0].cards[0];
        expect(card.front).toBe("问题 ==题干重点== 和 ==第二重点==");
        expect(card.back).toBe("答案 ==答案重点==");
        expect(card.scheduleInfo.dueDate.format("YYYY-MM-DD")).toBe("2023-09-02");
        expect(card.scheduleInfo.interval).toBe(4);
        expect(note.hasChanged).toBe(false);
        expect(file.content).toBe(noteText);
    });

    test("Multiple questions, none with too many schedule details", async () => {
        const noteText: string = `#flashcards/test
Q1::A1
#flashcards Q2::A2
<!--SR:!2023-09-02,4,270-->
Q3:::A3
<!--SR:!2023-09-02,4,270-->
`;
        const file: UnitTestSRFile = new UnitTestSRFile(noteText);
        const note: Note = await noteFileLoader.load(file, TextDirection.Ltr, TopicPath.emptyPath);
        expect(note.hasChanged).toEqual(false);
        // 正式复习队列经由 NoteFileLoader 构建；未编辑的笔记也必须带有源快照，
        // 供首次同步确认当前卡片身份。
        expect(note.sourceText).toEqual(noteText);
    });

    test("Multiple questions, some with too many schedule details", async () => {
        const noteText: string = `#flashcards/test
Q1::A1
#flashcards Q2::A2
<!--SR:!2023-09-02,4,270!2023-09-02,4,270-->
Q3:::A3
<!--SR:!2023-09-02,4,270-->
`;
        const file: UnitTestSRFile = new UnitTestSRFile(noteText);
        const note: Note = await noteFileLoader.load(file, TextDirection.Ltr, TopicPath.emptyPath);
        expect(note.hasChanged).toEqual(true);
    });
});
