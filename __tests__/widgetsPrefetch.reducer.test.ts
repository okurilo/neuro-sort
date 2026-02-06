import { categoriesReducer, initialState, CategoriesState } from "../reducer";
import type { CategoryStatus } from "../types";

type StatusMap = Record<string, CategoryStatus>;

type MakeStateArgs = Partial<CategoriesState> & {
    statuses?: StatusMap;
};

const makeState = (overrides: MakeStateArgs = {}): CategoriesState => ({
    ...initialState,
    queue: ["A"],
    candidates: { A: [] },
    statuses: {
        A: { status: "pending", validWidgets: [], validCount: 0 },
    },
    requestedCount: 1,
    preparedCount: 0,
    inFlight: false,
    ...overrides,
});

describe("categoriesReducer deadlocks", () => {
    it("T1: category_failed всегда делает inFlight=false", () => {
        const state = makeState({ inFlight: true });
        const next = categoriesReducer(state, { type: "category_failed" });
        expect(next.inFlight).toBe(false);
    });

    it("T2: category_resolved всегда делает inFlight=false и фиксирует preparedCount", () => {
        const state = makeState({ inFlight: true, preparedCount: 0 });
        const status: CategoryStatus = {
            status: "ready",
            validWidgets: [],
            validCount: 1,
        };
        const next = categoriesReducer(state, {
            type: "category_resolved",
            payload: { name: "A", status, preparedCount: 1 },
        });
        expect(next.inFlight).toBe(false);
        expect(next.preparedCount).toBe(1);
    });

    it("T3: category_loading НЕ должен включать inFlight, если статус != pending", () => {
        const state = makeState({
            inFlight: false,
            statuses: {
                A: { status: "ready", validWidgets: [], validCount: 1 },
            },
        });
        const next = categoriesReducer(state, {
            type: "category_loading",
            payload: { name: "A" },
        });
        expect(next.inFlight).toBe(false);
    });
});
