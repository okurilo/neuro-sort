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

const DEBUG = true;
const debugLog = (...args: unknown[]) => {
    if (!DEBUG) return;
    console.log("[PREFETCH]", ...args);
};

type CategoryLoadStatus = "pending" | "loading" | "ready" | "empty";

export interface WidgetWithPrefetch extends IWidget {
    $prefetchMode: boolean;
}

export interface CategoryStatus {
    status: CategoryLoadStatus;
    validWidgets: WidgetWithPrefetch[];
    validCount: number;
}

const INITIAL_VISIBLE_CATEGORIES = 2;

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

export const useWidgetsWithPrefetch = (widgets: IWidget[]) => {
    const [categoriesStatus, setCategoriesStatus] = useState<Record<string, CategoryStatus>>({});
    const [categoryQueue, setCategoryQueue] = useState<string[]>([]);
    const [visibleCategoriesCount, setVisibleCategoriesCount] = useState(INITIAL_VISIBLE_CATEGORIES);
    const [isLoadingCategory, setIsLoadingCategory] = useState(false);

    const runIdRef = useRef(0);
    const abortControllerRef = useRef<AbortController>(new AbortController());
    const inFlightRef = useRef(false);
    const hasShownWidgetsRef = useRef(false);
    const categorizedCandidatesRef = useRef<Record<string, IWidget[]>>({});
    const sentinelInViewRef = useRef(false);

    const widgetsKey = useMemo(
        () => widgets.map((w) => String(w.code)).sort().join("|"),
        [widgets]
    );

    useEffect(() => {
        runIdRef.current += 1;
        const runId = runIdRef.current;

        abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        inFlightRef.current = false;
        hasShownWidgetsRef.current = false;
        sentinelInViewRef.current = false;

        const categorized = categorizeWidgets(widgets);
        categorizedCandidatesRef.current = categorized;

        const queue = Object.entries(CATEGORY_MAPPING)
            .map(([name, config]) => ({ name, ordering: config.ordering }))
            .sort((a, b) => a.ordering - b.ordering)
            .map((x) => x.name);

        if ((categorized[FALLBACK_CATEGORY] || []).length > 0) {
            queue.push(FALLBACK_CATEGORY);
        }

        const initial: Record<string, CategoryStatus> = {};
        for (const name of queue) {
            const candidates = categorized[name] || [];
            initial[name] = {
                status: candidates.length > 0 ? "pending" : "empty",
                validWidgets: [],
                validCount: 0,
            };
        }

        const initialVisibleCount = Math.min(INITIAL_VISIBLE_CATEGORIES, queue.length);
        setCategoryQueue(queue);
        setVisibleCategoriesCount(initialVisibleCount);
        setCategoriesStatus(initial);
        setIsLoadingCategory(false);
        if (DEBUG) {
            const statusMap = Object.fromEntries(
                Object.entries(initial).map(([name, st]) => [name, st.status])
            );
            debugLog("init", {
                runId,
                widgetsKey,
                queueLength: queue.length,
                initialVisibleCount,
                statusMap,
            });
        }
    }, [widgetsKey]);

    const hasMore = visibleCategoriesCount < categoryQueue.length;

    const { ref: loadMoreObserverRef, isIntersecting } = useIntersectionObserver({
        threshold: 0,
        rootMargin: "200px 0px",
    });

    useEffect(() => {
        sentinelInViewRef.current = isIntersecting;
        debugLog("observer", {
            isIntersecting,
            hasMore,
            visibleCategoriesCount,
            queueLength: categoryQueue.length,
        });
    }, [isIntersecting, hasMore, visibleCategoriesCount, categoryQueue.length]);

    useEffect(() => {
        if (!isIntersecting) return;
        if (!hasMore) return;
        if (inFlightRef.current) return;

        setVisibleCategoriesCount((prev) =>
            prev < categoryQueue.length ? prev + 1 : prev
        );
    }, [isIntersecting, hasMore, categoryQueue.length]);

    useEffect(() => {
        if (inFlightRef.current) return;

        let nextName: string | null = null;
        const maxIndex = Math.min(visibleCategoriesCount, categoryQueue.length);
        for (let i = 0; i < maxIndex; i++) {
            const name = categoryQueue[i];
            const st = categoriesStatus[name];
            if (st && st.status === "pending") {
                nextName = name;
                break;
            }
        }
        if (!nextName) return;

        const runId = runIdRef.current;
        inFlightRef.current = true;
        setIsLoadingCategory(true);
        debugLog("start-category", {
            runId,
            nextName,
            visibleCategoriesCount,
            inFlight: inFlightRef.current,
        });

        const run = async () => {
            const candidates = sortWidgets(categorizedCandidatesRef.current[nextName] || []);
            const valid: WidgetWithPrefetch[] = [];

            for (const widget of candidates) {
                if (runId !== runIdRef.current) return;

                if (widget.type === "importedWidget") {
                    debugLog("prefetch-widget", {
                        code: widget.code,
                        type: widget.type,
                        dataSource: false,
                        valid: true,
                    });
                    valid.push(toFinalWidget(widget));
                } else {
                    const ds = getDataSource(widget);
                    if (!ds) {
                        debugLog("prefetch-widget", {
                            code: widget.code,
                            type: widget.type,
                            dataSource: false,
                            valid: true,
                        });
                        valid.push(toFinalWidget(widget));
                    } else {
                        try {
                            const data = await loadRendererData(ds, abortControllerRef.current);
                            const ok = validateBusinessData(data);
                            debugLog("prefetch-widget", {
                                code: widget.code,
                                type: widget.type,
                                dataSource: true,
                                valid: ok,
                            });
                            if (ok) {
                                valid.push(toFinalWidget(widget, { data, dataSource: undefined }));
                            }
                        } catch (error) {
                            debugLog("prefetch-error", {
                                code: widget.code,
                                type: widget.type,
                                error,
                            });
                            valid.push(toFinalWidget(widget));
                        }
                    }
                }
            }

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
            debugLog("finish-category", {
                runId,
                nextName,
                validCount,
                status: validCount > 0 ? "ready" : "empty",
            });

            if (!hasShownWidgetsRef.current && validCount > 0) {
                hasShownWidgetsRef.current = true;
                widgetsShowChanged();
            }
        };

        run()
            .catch(() => {})
            .finally(() => {
                if (runId !== runIdRef.current) return;
                inFlightRef.current = false;
                setIsLoadingCategory(false);

                if (sentinelInViewRef.current) {
                    setVisibleCategoriesCount((prev) => {
                        const next = prev < categoryQueue.length ? prev + 1 : prev;
                        debugLog("auto-advance", {
                            runId,
                            sentinelInView: sentinelInViewRef.current,
                            prev,
                            next,
                            queueLength: categoryQueue.length,
                        });
                        return next;
                    });
                } else {
                    debugLog("no-auto-advance", {
                        runId,
                        sentinelInView: sentinelInViewRef.current,
                        visibleCategoriesCount,
                    });
                }
            });
    }, [categoryQueue, categoriesStatus, visibleCategoriesCount]);

    useEffect(() => {
        return () => {
            abortControllerRef.current.abort();
        };
    }, []);

    return {
        categoriesStatus,
        categoryQueue,
        visibleCategoriesCount,
        hasMore,
        isLoadingCategory,
        loadMoreObserverRef,
    };
};
