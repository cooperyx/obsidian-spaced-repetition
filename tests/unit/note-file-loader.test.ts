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
