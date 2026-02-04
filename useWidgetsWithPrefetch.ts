import { useEffect, useMemo, useRef, useState } from "react";
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

type CategoryLoadStatus = "pending" | "loading" | "ready" | "empty";

export interface WidgetWithPrefetch extends IWidget {
    $prefetchMode: boolean;
}

export interface CategoryStatus {
    status: CategoryLoadStatus;
    validWidgets: WidgetWithPrefetch[];
    validCount: number;
}

export interface PreparedCategory {
    title: string;
    widgets: WidgetWithPrefetch[];
}

const INITIAL_VISIBLE_CATEGORIES = 2;
const LOAD_MORE_ROOT_MARGIN = "200px 0px";

/**
 * LEGACY: НЕ ТРОГАЕМ
 */
const splitMinorsAndOthers = <T extends { availableSizes: unknown }>(widgets: T[]) => {
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

const sortWidgets = <T extends { availableSizes: unknown }>(widgets: T[]): T[] => {
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

const toFinalWidget = (
    widget: IWidget,
    overrides?: Partial<WidgetWithPrefetch>
): WidgetWithPrefetch => ({
    ...widget,
    data: undefined,
    $prefetchMode: false,
    ...overrides,
});

const buildCategoryQueue = (categorized: Record<string, IWidget[]>): string[] => {
    const ordered = Object.entries(CATEGORY_MAPPING)
        .map(([name, config]) => ({ name, ordering: config.ordering }))
        .sort((a, b) => a.ordering - b.ordering)
        .map((item) => item.name);

    if ((categorized[FALLBACK_CATEGORY] || []).length > 0) {
        ordered.push(FALLBACK_CATEGORY);
    }

    return ordered;
};

const buildInitialStatus = (
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

const findNextPendingCategory = (
    queue: string[],
    statuses: Record<string, CategoryStatus>
): string | null => {
    for (let i = 0; i < queue.length; i++) {
        const name = queue[i];
        const status = statuses[name];
        if (status && status.status === "pending") {
            return name;
        }
    }

    return null;
};

const clampRequestedCount = (value: number, max: number): number => {
    if (value < 0) return 0;
    if (value > max) return max;
    return value;
};

const getPreparedCount = (
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

const getPreparedCategories = (
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
    const [categoriesStatus, setCategoriesStatus] = useState<Record<string, CategoryStatus>>({});
    const [categoryQueue, setCategoryQueue] = useState<string[]>([]);
    const [requestedCount, setRequestedCount] = useState(0);

    const abortControllerRef = useRef<AbortController>(new AbortController());
    const inFlightRef = useRef(false);
    const hasShownWidgetsRef = useRef(false);
    const categorizedCandidatesRef = useRef<Record<string, IWidget[]>>({});
    const wasIntersectingRef = useRef(false);

    const widgetsKey = useMemo(
        () => widgets.map((w) => String(w.code)).sort().join("|"),
        [widgets]
    );

    useEffect(() => {
        abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        inFlightRef.current = false;
        hasShownWidgetsRef.current = false;
        wasIntersectingRef.current = false;

        const categorized = categorizeWidgets(widgets);
        categorizedCandidatesRef.current = categorized;

        const queue = buildCategoryQueue(categorized);
        const initial = buildInitialStatus(queue, categorized);
        const initialRequests = clampRequestedCount(INITIAL_VISIBLE_CATEGORIES, queue.length);

        setCategoryQueue(queue);
        setCategoriesStatus(initial);
        setRequestedCount(initialRequests);
    }, [widgetsKey]);

    const preparedCount = useMemo(
        () => getPreparedCount(categoryQueue, categoriesStatus),
        [categoryQueue, categoriesStatus]
    );
    const hasMore = preparedCount < categoryQueue.length;

    const { ref: loadMoreObserverRef, isIntersecting } = useIntersectionObserver({
        threshold: 0,
        rootMargin: LOAD_MORE_ROOT_MARGIN,
    });

    useEffect(() => {
        if (!isIntersecting) {
            wasIntersectingRef.current = false;
            return;
        }

        if (wasIntersectingRef.current) return;
        wasIntersectingRef.current = true;

        if (!hasMore) return;

        setRequestedCount((prev) => {
            const next = prev + 1;
            return clampRequestedCount(next, categoryQueue.length);
        });
    }, [isIntersecting, hasMore, categoryQueue.length]);

    useEffect(() => {
        if (inFlightRef.current) return;
        if (requestedCount <= preparedCount) return;

        const nextName = findNextPendingCategory(categoryQueue, categoriesStatus);
        if (!nextName) return;

        inFlightRef.current = true;

        setCategoriesStatus((prev) => {
            const prevItem = prev[nextName];
            if (!prevItem) return prev;
            if (prevItem.status !== "pending") return prev;
            return {
                ...prev,
                [nextName]: { ...prevItem, status: "loading" },
            };
        });

        const run = async () => {
            const candidates = sortWidgets(categorizedCandidatesRef.current[nextName] || []);
            const valid: WidgetWithPrefetch[] = [];

            for (const widget of candidates) {
                if (widget.type === "importedWidget") {
                    valid.push(toFinalWidget(widget));
                } else {
                    const dataSource = getDataSource(widget);
                    if (!dataSource) {
                        valid.push(toFinalWidget(widget));
                    } else {
                        try {
                            const data = await loadRendererData(
                                dataSource,
                                abortControllerRef.current
                            );
                            if (validateBusinessData(data)) {
                                valid.push(
                                    toFinalWidget(widget, { data, dataSource: undefined })
                                );
                            }
                        } catch {
                            valid.push(toFinalWidget(widget));
                        }
                    }
                }
            }

            return valid;
        };

        run()
            .then((valid) => {
                if (!valid) return;
                const validCount = valid.length;

                setCategoriesStatus((prev) => {
                    const prevItem = prev[nextName];
                    if (!prevItem) return prev;
                    const nextItem: CategoryStatus = {
                        ...prevItem,
                        status: validCount > 0 ? "ready" : "empty",
                        validWidgets: valid,
                        validCount,
                    };
                    return { ...prev, [nextName]: nextItem };
                });

                if (!hasShownWidgetsRef.current && validCount > 0) {
                    hasShownWidgetsRef.current = true;
                    widgetsShowChanged();
                }
            })
            .catch(() => {})
            .finally(() => {
                inFlightRef.current = false;
            });
    }, [categoryQueue, categoriesStatus, preparedCount, requestedCount]);

    useEffect(() => {
        return () => {
            abortControllerRef.current.abort();
        };
    }, []);

    const preparedCategories = useMemo(
        () => getPreparedCategories(categoryQueue, categoriesStatus, preparedCount),
        [categoryQueue, categoriesStatus, preparedCount]
    );

    return {
        preparedCategories,
        hasMore,
        loadMoreObserverRef,
    };
};
