jest.mock("react", () => {
    const actual = jest.requireActual("react");
    return { ...actual, useReducer: jest.fn() };
});

import * as React from "react";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useWidgetsWithPrefetch } from "../useWidgetsWithPrefetch";
import type { CategoriesState } from "../reducer";
import { __setIntersecting, __resetIntersecting } from "usehooks-ts";

jest.mock("../utils", () => ({
    CATEGORY_MAPPING: {
        A: { codes: ["a"], ordering: 1 },
        B: { codes: ["b"], ordering: 2 },
    },
    FALLBACK_CATEGORY: "fallback",
    categorizeWidgets: (widgets: unknown[]) => {
        const result: Record<string, unknown[]> = { A: [], B: [] };
        for (const widget of widgets) {
            result.A.push(widget);
        }
        return result;
    },
    getDataSource: () => undefined,
    loadRendererData: async () => ({ ok: true }),
    validateBusinessData: () => true,
}));

type DispatchCall = { type: string } | undefined;

const makeState = (overrides: Partial<CategoriesState> = {}): CategoriesState => ({
    queue: ["A", "B", "C"],
    statuses: {
        A: { status: "pending", validWidgets: [], validCount: 0 },
        B: { status: "pending", validWidgets: [], validCount: 0 },
        C: { status: "pending", validWidgets: [], validCount: 0 },
    },
    candidates: { A: [], B: [], C: [] },
    requestedCount: 0,
    preparedCount: 0,
    inFlight: false,
    ...overrides,
});

describe("useWidgetsWithPrefetch sentinel one-time trigger", () => {
    beforeEach(() => {
        __resetIntersecting();
        jest.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        (console.log as jest.Mock).mockRestore();
    });

    it("IntersectionObserver -> request_more при входе в зону видимости", async () => {
        const dispatch = jest.fn();
        let state = makeState({
            requestedCount: 0,
            preparedCount: 0,
            inFlight: false,
        });

        const useReducerMock = React.useReducer as jest.Mock;
        useReducerMock.mockImplementation(() => [state, dispatch]);

        __setIntersecting(false);
        const widgets = [{ id: "1", code: "x", availableSizes: "minor" }];

        const { rerender } = renderHook(() => useWidgetsWithPrefetch(widgets));

        await act(async () => {});

        __setIntersecting(true);
        rerender();
        await waitFor(() => {
            const requestMoreCalls = dispatch.mock.calls.filter((call) => {
                const action = call[0] as DispatchCall;
                return action?.type === "request_more";
            });
            expect(requestMoreCalls.length).toBeGreaterThanOrEqual(1);
        });

        useReducerMock.mockReset();
    });

    it("после освобождения inFlight сразу стартует следующая категория", async () => {
        const dispatch = jest.fn();
        let state = makeState({
            requestedCount: 2,
            preparedCount: 0,
            inFlight: true,
            statuses: {
                A: { status: "loading", validWidgets: [], validCount: 0 },
                B: { status: "pending", validWidgets: [], validCount: 0 },
                C: { status: "pending", validWidgets: [], validCount: 0 },
            },
        });

        const useReducerMock = React.useReducer as jest.Mock;
        useReducerMock.mockImplementation(() => [state, dispatch]);

        __setIntersecting(true);
        const widgets = [{ id: "1", code: "x", availableSizes: "minor" }];

        const { rerender } = renderHook(() => useWidgetsWithPrefetch(widgets));

        await act(async () => {});

        const loadingCallsWhileLocked = dispatch.mock.calls.filter((call) => {
            const action = call[0] as DispatchCall;
            return action?.type === "category_loading";
        });
        expect(loadingCallsWhileLocked.length).toBe(0);

        dispatch.mockClear();

        state = makeState({
            requestedCount: 2,
            preparedCount: 1,
            inFlight: false,
            statuses: {
                A: { status: "ready", validWidgets: [], validCount: 1 },
                B: { status: "pending", validWidgets: [], validCount: 0 },
                C: { status: "pending", validWidgets: [], validCount: 0 },
            },
        });

        rerender();
        await act(async () => {});

        const loadingCalls = dispatch.mock.calls.filter((call) => {
            const action = call[0] as DispatchCall;
            return action?.type === "category_loading" && action?.payload?.name === "B";
        });

        expect(loadingCalls.length).toBe(1);

        useReducerMock.mockReset();
    });
});
