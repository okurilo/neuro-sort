import type { IWidget } from "../../types";
import type { WidgetWithPrefetch, CategoryStatus } from "./useWidgetsWithPrefetch.types";

/**
 * Состояние prefetch-очереди категорий.
 */
export interface CategoriesState {
    queue: string[];
    statuses: Record<string, CategoryStatus>;
    candidates: Record<string, IWidget[]>;
    requestedCount: number;
    preparedCount: number;
    inFlight: boolean;
}

/**
 * Действия редьюсера загрузки категорий.
 */
export type CategoriesAction =
    | {
          type: "reset";
          payload: {
              queue: string[];
              statuses: Record<string, CategoryStatus>;
              candidates: Record<string, IWidget[]>;
              requestedCount: number;
          };
      }
    | { type: "request_more"; payload: { requestedCount: number } }
    | { type: "category_loading"; payload: { name: string } }
    | {
          type: "category_resolved";
          payload: { name: string; status: CategoryStatus; preparedCount: number };
      }
    | { type: "category_failed" };

/**
 * Начальное состояние редьюсера.
 */
export const initialState: CategoriesState = {
    queue: [],
    statuses: {},
    candidates: {},
    requestedCount: 0,
    preparedCount: 0,
    inFlight: false,
};

/**
 * Редьюсер состояния prefetch категорий.
 */
export const categoriesReducer = (
    state: CategoriesState,
    action: CategoriesAction
): CategoriesState => {
    switch (action.type) {
        case "reset": {
            return {
                queue: action.payload.queue,
                statuses: action.payload.statuses,
                candidates: action.payload.candidates,
                requestedCount: action.payload.requestedCount,
                preparedCount: 0,
                inFlight: false,
            };
        }
        case "request_more": {
            if (action.payload.requestedCount === state.requestedCount) return state;
            return { ...state, requestedCount: action.payload.requestedCount };
        }
        case "category_loading": {
            const name = action.payload.name;
            const current = state.statuses[name];
            if (!current || current.status !== "pending") {
                return { ...state, inFlight: true };
            }
            return {
                ...state,
                inFlight: true,
                statuses: {
                    ...state.statuses,
                    [name]: { ...current, status: "loading" },
                },
            };
        }
        case "category_resolved": {
            const name = action.payload.name;
            const current = state.statuses[name];
            if (!current) {
                return { ...state, inFlight: false };
            }
            return {
                ...state,
                inFlight: false,
                statuses: {
                    ...state.statuses,
                    [name]: action.payload.status,
                },
                preparedCount: action.payload.preparedCount,
            };
        }
        case "category_failed": {
            return { ...state, inFlight: false };
        }
        default:
            return state;
    }
};
