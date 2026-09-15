import moment from "moment";
import { State } from "ts-fsrs";

import { DataStore } from "src/data/data-store/base/data-store";
import { QuestionPostponementList } from "src/data/data-structures/card/questions/question-postponement-list";
import { Deck, DeckTreeFilter } from "src/data/data-structures/deck/deck";
import {
    DeckOrder,
    DeckTreeIterator,
    IIteratorOrder,
    RepItemOrder,
} from "src/data/data-structures/deck/deck-tree-iterator";
import { TopicPath } from "src/data/data-structures/deck/topic-path";
import { DEFAULT_SETTINGS, SRSettings } from "src/data/settings";
import { ISRAlgorithm } from "src/scheduling/algorithms/base/isr-algorithm";
import { ReviewResponse } from "src/scheduling/algorithms/base/repetition-item";
import { RepItemScheduleInfoFsrs } from "src/scheduling/algorithms/fsrs/rep-item-schedule-info-fsrs";
import { SrsAlgorithmFsrs } from "src/scheduling/algorithms/fsrs/sr-algorithm-fsrs";
import { SRAlgorithmOsr } from "src/scheduling/algorithms/osr/srs-algorithm-osr";
import { CardDueDateHistogram } from "src/scheduling/due-date-histogram";
import {
    FlashcardReviewMode,
    FlashcardReviewSequencer,
} from "src/scheduling/flashcard-review-sequencer";
import { globalDateProvider, setupStaticDateProvider20230906 } from "src/utils/dates";

import { UnitTestSRFile } from "../helpers/unit-test-file";
import { unitTestSetupStandardDataStoreAlgorithm } from "../helpers/unit-test-setup";
import { SampleItemDecks } from "../sample-items";

const orderDueFirstSequential: IIteratorOrder = {
    repItemOrder: RepItemOrder.DueFirstSequential,
    deckOrder: DeckOrder.PrevDeckComplete_Sequential,
};

interface ManualReviewContext {
    file: UnitTestSRFile;
    sequencer: FlashcardReviewSequencer;
}

async function createManualReviewContext(
    text: string,
    algorithm: ISRAlgorithm,
    settings: SRSettings = { ...DEFAULT_SETTINGS },
): Promise<ManualReviewContext> {
    unitTestSetupStandardDataStoreAlgorithm(settings);
    const file = new UnitTestSRFile(text, "manual-review-test");
    const deckTree: Deck = await SampleItemDecks.createDeckFromFile(file, new TopicPath(["Root"]));
    const postponementList = new QuestionPostponementList(null, settings, []);
    const remainingDeckTree = DeckTreeFilter.filterForRemainingRepItems(
        postponementList,
        deckTree,
        FlashcardReviewMode.Review,
    );
    const sequencer = new FlashcardReviewSequencer(
        FlashcardReviewMode.Review,
        new DeckTreeIterator(orderDueFirstSequential, null),
        settings,
        algorithm,
        postponementList,
        new CardDueDateHistogram(),
    );
    sequencer.setDeckTree(deckTree, remainingDeckTree);
    return { file, sequencer };
}

describe("processManualReview", () => {
    beforeEach(() => {
        setupStaticDateProvider20230906();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    test("uses the selected natural day and leaves an unreviewed sibling unchanged", async () => {
        const settings = { ...DEFAULT_SETTINGS, burySiblingCards: false };
        const { file, sequencer } = await createManualReviewContext(
            "#flashcards Q:::A",
            new SRAlgorithmOsr(settings),
            settings,
        );
        const reviewedCard = sequencer.currentCard;
        const sibling = sequencer.currentQuestion.cards.find((card) => card !== reviewedCard);

        await sequencer.processManualReview(3);

        expect(reviewedCard.scheduleInfo).toMatchObject({ interval: 3 });
        expect(reviewedCard.scheduleInfo.dueDate.format("YYYY-MM-DD")).toEqual("2023-09-09");
        expect(sibling.scheduleInfo).toBeNull();
        expect(file.content).toContain("<!--SR:!2023-09-09,3,");
        expect(file.content).toContain("!2000-01-01,1,250-->");
    });

    test("converts FSRS short-term learning into a compatible day-based review state", async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const { file, sequencer } = await createManualReviewContext(
            "#flashcards Q::A",
            new SrsAlgorithmFsrs(settings),
            settings,
        );
        const reviewedCard = sequencer.currentCard;

        await sequencer.processManualReview(10);

        const schedule = reviewedCard.scheduleInfo as RepItemScheduleInfoFsrs;
        expect(schedule).toBeInstanceOf(RepItemScheduleInfoFsrs);
        expect(schedule.dueDate.format("YYYY-MM-DD")).toEqual("2023-09-16");
        expect(schedule.interval).toEqual(10);
        expect(schedule.state).toEqual(State.Review);
        expect(schedule.learningSteps).toEqual(0);
        expect(schedule.lastReview).not.toBeNull();
        expect(file.content).toContain("<!--SR:!fsrs,");
    });

    test("uses the actual local review date even when the upstream review day is yesterday", async () => {
        jest.spyOn(globalDateProvider, "now", "get").mockReturnValue(moment("2026-09-15T00:05:00"));
        jest.spyOn(globalDateProvider, "today", "get").mockReturnValue(moment("2026-09-14"));
        const settings = { ...DEFAULT_SETTINGS };
        const { sequencer, file } = await createManualReviewContext(
            "#flashcards Q::A",
            new SRAlgorithmOsr(settings),
            settings,
        );
        await sequencer.processManualReview(3);
        expect(file.content).toContain("!2026-09-18,3,");
    });

    test("restores the previous schedule and queue when persistence fails", async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const { sequencer } = await createManualReviewContext(
            "#flashcards Q::A <!--SR:!2023-09-02,4,270-->",
            new SRAlgorithmOsr(settings),
            settings,
        );
        const previousSchedule = sequencer.currentCard.scheduleInfo;
        jest.spyOn(DataStore.getInstance(), "writeSchedule").mockRejectedValueOnce(
            new Error("write"),
        );

        await expect(sequencer.processManualReview(7)).rejects.toThrow("write");

        expect(sequencer.currentCard.scheduleInfo).toBe(previousSchedule);
        expect(sequencer.currentCard.scheduleInfo.interval).toEqual(4);
        expect(sequencer.currentCard.front).toEqual("Q");
    });

    test("does not advance a standard review when persistence fails", async () => {
        const settings = { ...DEFAULT_SETTINGS };
        const { sequencer } = await createManualReviewContext(
            "#flashcards Q::A <!--SR:!2023-09-02,4,270-->",
            new SRAlgorithmOsr(settings),
            settings,
        );
        const previousSchedule = sequencer.currentCard.scheduleInfo;
        jest.spyOn(DataStore.getInstance(), "writeSchedule").mockRejectedValueOnce(
            new Error("write"),
        );

        await expect(sequencer.processReview(ReviewResponse.Good)).rejects.toThrow("write");

        expect(sequencer.currentCard.scheduleInfo).toBe(previousSchedule);
        expect(sequencer.currentCard.scheduleInfo.interval).toEqual(4);
        expect(sequencer.currentCard.front).toEqual("Q");
    });
});
