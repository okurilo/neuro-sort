import { useEffect, useMemo, useReducer, useRef } from "react";
import { useIntersectionObserver } from "usehooks-ts";
import { normalizeSize } from "../../../../helpers/normalizeSize";
import { widgetsShowChanged } from "../../stores/widgets-show";
import type { IWidget } from "../../types";
import {
    CATEGORY_MAPPING,
    FALLBACK_CATEGORY,
    categorizeWidgets,
    getDataSource,
    loadRendererData,
    validateBusinessData,
} from "./utils";
import { CategoryStatus, WidgetWithPrefetch } from "./types";
import { categoriesReducer, initialState } from "./reducer";


export interface PreparedCategory {
    title: string;
    widgets: WidgetWithPrefetch[];
}


const INITIAL_VISIBLE_CATEGORIES = 2;
const LOAD_MORE_ROOT_MARGIN = "200px 0px";


/**
 * LEGACY: НЕ ТРОГАЕМ
 */
/**
 * Разделяет виджеты на minor и остальные по availableSizes.
 */
const splitMinorsAndOthers = <T extends { availableSizes: unknown }>(
    widgets: T[]
) => {
    const minors: T[] = [];
    const others: T[] = [];


    for (const widget of widgets) {
        if (normalizeSize(widget.availableSizes) === "minor") {
            minors.push(widget);
        } else {
            others.push(widget);
        }
    }


    return { minors, others };
};


/**
 * Сортирует виджеты по legacy-правилам размещения в гриде.
 */
const sortWidgets = <T extends { availableSizes: unknown }>(
    widgets: T[]
): T[] => {
    const { minors, others } = splitMinorsAndOthers(widgets);
    const result: T[] = [];
    let minorIndex = 0;


    const hasNextMinor = () => minorIndex < minors.length;
    const takeMinor = () => (hasNextMinor() ? minors[minorIndex++] : null);


    for (let i = 0; i < others.length; i++) {
        const widget = others[i];
        const widgetSize = normalizeSize(widget.availableSizes);


        if (widgetSize === "major") {
            if (result.length !== 0) {
                const m1 = takeMinor();
                const m2 = takeMinor();
                if (m1) result.push(m1);
                if (m2) result.push(m2);
            }


            result.push(widget);


            const after1 = takeMinor();
            const after2 = takeMinor();
            if (after1) result.push(after1);
            if (after2) result.push(after2);
        } else if (widgetSize === "important") {
            result.push(widget);
            const minor = takeMinor();
            if (minor) result.push(minor);
        } else {
            result.push(widget);
        }
    }


    while (minorIndex < minors.length) {
        result.push(minors[minorIndex++]);
    }


    return result;
};


/**
 * Приводит виджет к финальному виду для рендера.
 */
const finalizeWidget = (
    widget: IWidget,
    overrides?: Partial<WidgetWithPrefetch>
): WidgetWithPrefetch => ({
    ...widget,
    data: undefined,
    $prefetchMode: false,
    ...overrides,
});


/**
 * Загружает/валидирует данные виджета и возвращает финальную модель.
 * Если данные невалидны — возвращает null.
 */
const resolveWidget = async (
    widget: IWidget,
    abortController: AbortController
): Promise<WidgetWithPrefetch | null> => {
    const dataSource = getDataSource(widget);
    console.log("🚀 ~ resolveWidget ~ dataSource:", dataSource);
    if (!dataSource) {
        return finalizeWidget(widget);
    }


    try {
        const data = await loadRendererData(dataSource, abortController);
        console.log("🚀 ~ resolveWidget ~ data:", data);
        if (!validateBusinessData(data)) return null;
        return finalizeWidget(widget, { data, dataSource: undefined });
    } catch {
        return finalizeWidget(widget);
    }
};


/**
 * Формирует очередь категорий по заданному порядку, включая fallback.
 */
const createQueue = (categorized: Record<string, IWidget[]>): string[] => {
    const ordered = Object.entries(CATEGORY_MAPPING)
        .map(([name, config]) => ({ name, ordering: config.ordering }))
        .sort((a, b) => a.ordering - b.ordering)
        .map((item) => item.name);


    if ((categorized[FALLBACK_CATEGORY] || []).length > 0) {
        ordered.push(FALLBACK_CATEGORY);
    }


    return ordered;
};


/**
 * Создаёт стартовые статусы категорий (pending/empty).
 */
const createInitialStatus = (
    queue: string[],
    categorized: Record<string, IWidget[]>
): Record<string, CategoryStatus> => {
    const initial: Record<string, CategoryStatus> = {};


    for (const name of queue) {
        const candidates = categorized[name] || [];
        initial[name] = {
            status: candidates.length > 0 ? "pending" : "empty",
            validWidgets: [],
            validCount: 0,
        };
    }


    return initial;
};


/**
 * Ограничивает запрошенное количество категорий допустимым диапазоном.
 */
const clampRequestedCount = (value: number, max: number): number => {
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
};


/**
 * Считает, сколько первых категорий подряд уже подготовлены.
 */
const countPrepared = (
    queue: string[],
    statuses: Record<string, CategoryStatus>
): number => {
    let count = 0;


    for (let i = 0; i < queue.length; i++) {
        const name = queue[i];
        const status = statuses[name];
        if (!status) break;
        if (status.status === "pending" || status.status === "loading") break;
        count += 1;
    }


    return count;
};


/**
 * Находит первую pending-категорию в пределах лимита.
 */
const findPendingCategory = (
    queue: string[],
    statuses: Record<string, CategoryStatus>,
    limit: number
): string | null => {
    const maxIndex = Math.min(limit, queue.length);


    for (let i = 0; i < maxIndex; i++) {
        const name = queue[i];
        const status = statuses[name];
        if (status && status.status === "pending") {
            return name;
        }
    }


    return null;
};


/**
 * Собирает готовые категории для рендера в исходном порядке.
 */
const collectPrepared = (
    queue: string[],
    statuses: Record<string, CategoryStatus>,
    preparedCount: number
): PreparedCategory[] => {
    const result: PreparedCategory[] = [];
    const sliceCount = Math.min(preparedCount, queue.length);


    for (let i = 0; i < sliceCount; i++) {
        const name = queue[i];
        const status = statuses[name];
        if (!status) {
            // no-op
        } else if (status.status === "ready" && status.validCount > 0) {
            result.push({ title: name, widgets: status.validWidgets });
        }
    }


    return result;
};


export const useWidgetsWithPrefetch = (widgets: IWidget[]) => {
    const [state, dispatch] = useReducer(categoriesReducer, initialState);


    // Нужен чтобы отменять текущие prefetch-запросы при смене widgets/размонтаже.
    const abortControllerRef = useRef<AbortController>(new AbortController());
    // Сигнализируем в store один раз, когда показали первые валидные виджеты.
    const hasShownWidgetsRef = useRef(false);
    // Debounce для IntersectionObserver: реагируем один раз на вход в зону видимости.
    const wasIntersectingRef = useRef(false);


    const widgetsKey = useMemo(
        () =>
            widgets
                .map((w) => String(w.code))
                .sort()
                .join("|"),
        [widgets]
    );


    useEffect(() => {
        // Полный reset при смене входных widgets.
        abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();


        hasShownWidgetsRef.current = false;
        wasIntersectingRef.current = false;


        const categorized = categorizeWidgets(widgets);
        const queue = createQueue(categorized);
        const initial = createInitialStatus(queue, categorized);
        const initialRequests = clampRequestedCount(
            INITIAL_VISIBLE_CATEGORIES,
            queue.length
        );


        dispatch({
            type: "reset",
            payload: {
                queue,
                statuses: initial,
                candidates: categorized,
                requestedCount: initialRequests,
            },
        });
    }, [widgets, widgetsKey]);


    const { preparedCount } = state;
    const hasMore = preparedCount < state.queue.length;

    const prevPreparedCountRef = useRef(preparedCount);

    const { ref: loadMoreObserverRef, isIntersecting } = useIntersectionObserver({
        threshold: 0,
        rootMargin: LOAD_MORE_ROOT_MARGIN,
    });

    useEffect(() => {
        if (preparedCount > prevPreparedCountRef.current) {
            prevPreparedCountRef.current = preparedCount;
            if (isIntersecting && hasMore) {
                wasIntersectingRef.current = false;
            }
        }
    }, [hasMore, isIntersecting, preparedCount]);


    useEffect(() => {
        console.log(`[INFQ] TODO REMOVE observer visible=${isIntersecting}`);
        // Догружаем ещё одну категорию при первом входе sentinel в зону видимости.
        if (!isIntersecting) {
            wasIntersectingRef.current = false;
            return;
        }


        console.log(
            `[INFQ] TODO REMOVE wasIntersecting_before=${wasIntersectingRef.current}`
        );
        if (wasIntersectingRef.current) return;
        wasIntersectingRef.current = true;


        console.log(
            `[INFQ] TODO REMOVE maybeLoadNext called ` +
                `isIntersecting=${isIntersecting} ` +
                `wasIntersecting=${wasIntersectingRef.current} ` +
                `hasMore=${hasMore} ` +
                `requestedCount=${state.requestedCount} ` +
                `queueLength=${state.queue.length}`
        );
        if (!hasMore) return;


        const nextRequested = clampRequestedCount(
            state.requestedCount + 1,
            state.queue.length
        );
        console.log(
            `[INFQ] TODO REMOVE dispatch request_more requestedCount=${nextRequested}`
        );
        dispatch({
            type: "request_more",
            payload: { requestedCount: nextRequested },
        });
    }, [hasMore, isIntersecting, state.queue.length, state.requestedCount]);


    useEffect(() => {
        // Поднимаем одну категорию за раз, пока requestedCount > preparedCount.
        if (state.inFlight) {
            console.log(
                `[INFQ] loadEffect req=${state.requestedCount} ` +
                    `prep=${preparedCount} inFlight=${state.inFlight} ` +
                    `q=${state.queue.length} next=null status=null reason=inFlight`
            );
            return;
        }
        if (state.requestedCount <= preparedCount) {
            console.log(
                `[INFQ] loadEffect req=${state.requestedCount} ` +
                    `prep=${preparedCount} inFlight=${state.inFlight} ` +
                    `q=${state.queue.length} next=null status=null reason=requested<=prepared`
            );
            return;
        }


        const nextName = findPendingCategory(
            state.queue,
            state.statuses,
            state.requestedCount
        );
        if (!nextName) {
            console.log(
                `[INFQ] loadEffect req=${state.requestedCount} ` +
                    `prep=${preparedCount} inFlight=${state.inFlight} ` +
                    `q=${state.queue.length} next=null status=null reason=nextName_null`
            );
            return;
        }

        console.log(
            `[INFQ] loadEffect req=${state.requestedCount} ` +
                `prep=${preparedCount} inFlight=${state.inFlight} ` +
                `q=${state.queue.length} next=${nextName} ` +
                `status=${state.statuses[nextName]?.status ?? "null"} reason=continue`
        );


        console.log(`[INFQ] TODO REMOVE start load category ${nextName}`);


        dispatch({ type: "category_loading", payload: { name: nextName } });


        const run = async () => {
            const candidates = sortWidgets(state.candidates[nextName] || []);
            const valid: WidgetWithPrefetch[] = [];


            for (const widget of candidates) {
                const resolved = await resolveWidget(
                    widget,
                    abortControllerRef.current
                );
                if (resolved) valid.push(resolved);
            }


            return valid;
        };


        const abortSignal = abortControllerRef.current.signal;


        let finishStatus: "ok" | "error" | "aborted" = "ok";
        run()
            .then((valid) => {
                if (abortSignal.aborted) {
                    finishStatus = "aborted";
                    return;
                }
                if (!valid) {
                    finishStatus = "error";
                    return;
                }


                const validCount = valid.length;
                const nextStatus: CategoryStatus = {
                    status: validCount > 0 ? "ready" : "empty",
                    validWidgets: valid,
                    validCount,
                };
                const nextStatuses: Record<string, CategoryStatus> = {
                    ...state.statuses,
                    [nextName]: nextStatus,
                };


                dispatch({
                    type: "category_resolved",
                    payload: {
                        name: nextName,
                        status: nextStatus,
                        preparedCount: countPrepared(state.queue, nextStatuses),
                    },
                });


                if (!hasShownWidgetsRef.current && valid.length > 0) {
                    hasShownWidgetsRef.current = true;
                    widgetsShowChanged();
                }
            })
            .catch(() => {
                if (abortSignal.aborted) {
                    finishStatus = "aborted";
                    return;
                }
                finishStatus = "error";
                dispatch({ type: "category_failed" });
            })
            .finally(() => {
                console.log(
                    `[INFQ] TODO REMOVE finish load category ${nextName} status=${finishStatus}`
                );
                console.log(
                    `[INFQ] TODO REMOVE lock state after finish inFlight_expected=false inFlight_now=${state.inFlight}`
                );
            });
    }, [
        preparedCount,
        state.candidates,
        state.inFlight,
        state.queue,
        state.requestedCount,
        state.statuses,
    ]);


    useEffect(() => {
        // Гарантированно отменяем запросы при размонтаже.
        return () => {
            abortControllerRef.current.abort();
        };
    }, []);


    const preparedCategories = useMemo(
        () => collectPrepared(state.queue, state.statuses, preparedCount),
        [preparedCount, state.queue, state.statuses]
    );


    return {
        preparedCategories,
        hasMore,
        loadMoreObserverRef,
    };
};
