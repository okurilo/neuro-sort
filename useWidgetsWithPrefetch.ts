import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const computeWidgetsKey = (widgets: IWidget[]) => {
    const parts = widgets.map((w) => `${String(w.id)}:${String(w.code)}`);
    parts.sort();
    return parts.join("|");
};

const buildCategoryQueue = (categorizedCandidates: Record<string, IWidget[]>) => {
    const base = Object.entries(CATEGORY_MAPPING)
        .map(([name, config]) => ({ name, ordering: config.ordering }))
        .sort((a, b) => a.ordering - b.ordering)
        .map((x) => x.name);

    if ((categorizedCandidates[FALLBACK_CATEGORY] || []).length > 0) {
        base.push(FALLBACK_CATEGORY);
    }

    return base;
};

const initCategoryStatus = (
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

const isTerminal = (s: CategoryLoadStatus) => s === "ready" || s === "empty";

const findNextPending = (
    queue: string[],
    statusMap: Record<string, CategoryStatus>,
    visibleCount: number
) => {
    const maxIndex = Math.min(visibleCount, queue.length);
    for (let i = 0; i < maxIndex; i++) {
        const name = queue[i];
        const st = statusMap[name];
        if (st && st.status === "pending") return name;
    }
    return null;
};

export const useWidgetsWithPrefetch = (widgets: IWidget[]) => {
    const [categoriesStatus, setCategoriesStatus] = useState<Record<string, CategoryStatus>>({});
    const [categoryQueue, setCategoryQueue] = useState<string[]>([]);
    const [visibleCategoriesCount, setVisibleCategoriesCount] = useState(INITIAL_VISIBLE_CATEGORIES);
    const [isLoadingCategory, setIsLoadingCategory] = useState(false);
    const [hasUserScrolled, setHasUserScrolled] = useState(false);

    // --- stability / anti-race ---
    const runIdRef = useRef(0);
    const abortControllerRef = useRef<AbortController>(new AbortController());
    const isProcessingRef = useRef(false);
    const hasShownWidgetsRef = useRef(false);

    // --- derived cached ---
    const categorizedCandidatesRef = useRef<Record<string, IWidget[]>>({});
    const queueLenRef = useRef(0);

    // --- sentinel controller ---
    const observerRef = useRef<IntersectionObserver | null>(null);
    const sentinelInViewRef = useRef(false);
    const pendingTriggerRef = useRef(false); // “пересёкся во время загрузки”
    const cooldownRef = useRef(false); // “уже догрузили 1 шаг, ждём следующего скролла”
    const revealInFlightRef = useRef(false);

    const widgetsKey = useMemo(() => computeWidgetsKey(widgets), [widgets]);

    // compute candidates/queue on widgets change
    useEffect(() => {
        const sorted = sortWidgets(widgets);
        const categorized = categorizeWidgets(sorted);
        categorizedCandidatesRef.current = categorized;

        const queue = buildCategoryQueue(categorized);
        queueLenRef.current = queue.length;
        setCategoryQueue(queue);
    }, [widgetsKey]);

    // INIT (не по производным объектам!)
    useEffect(() => {
        runIdRef.current += 1;

        abortControllerRef.current.abort();
        abortControllerRef.current = new AbortController();

        isProcessingRef.current = false;
        hasShownWidgetsRef.current = false;

        sentinelInViewRef.current = false;
        pendingTriggerRef.current = false;
        cooldownRef.current = false;
        revealInFlightRef.current = false;

        setHasUserScrolled(false);

        const queue = buildCategoryQueue(categorizedCandidatesRef.current);
        queueLenRef.current = queue.length;
        setCategoryQueue(queue);
        setVisibleCategoriesCount(Math.min(INITIAL_VISIBLE_CATEGORIES, queue.length));
        setCategoriesStatus(initCategoryStatus(queue, categorizedCandidatesRef.current));
        setIsLoadingCategory(false);
    }, [widgetsKey]);

    const hasMore = visibleCategoriesCount < categoryQueue.length;

    const isInitialBatchTerminal = useMemo(() => {
        const count = Math.min(INITIAL_VISIBLE_CATEGORIES, categoryQueue.length);
        if (count === 0) return false;

        for (let i = 0; i < count; i++) {
            const name = categoryQueue[i];
            const st = categoriesStatus[name];
            if (!st) return false;
            if (!isTerminal(st.status)) return false;
        }

        return true;
    }, [categoryQueue, categoriesStatus]);

    const canAutoLoadBySentinel = hasUserScrolled && isInitialBatchTerminal;

    // one listener: arm first scroll + re-arm cooldown when user keeps scrolling near bottom
    useEffect(() => {
        const onScroll = () => {
            if (!hasUserScrolled) setHasUserScrolled(true);

            if (sentinelInViewRef.current) {
                cooldownRef.current = false;
            }
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("wheel", onScroll, { passive: true });
        window.addEventListener("touchmove", onScroll, { passive: true });

        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("wheel", onScroll);
            window.removeEventListener("touchmove", onScroll);
        };
    }, [hasUserScrolled]);

    const safePatch = useCallback((runId: number, name: string, patch: Partial<CategoryStatus>) => {
        if (runId !== runIdRef.current) return;

        setCategoriesStatus((prev) => {
            const prevItem = prev[name];
            if (!prevItem) return prev;
            const nextItem: CategoryStatus = { ...prevItem, ...patch };
            return { ...prev, [name]: nextItem };
        });

        if (!hasShownWidgetsRef.current && typeof patch.validCount === "number") {
            if (patch.validCount > 0) {
                hasShownWidgetsRef.current = true;
                widgetsShowChanged();
            }
        }
    }, []);

    const finalize = useCallback(
        (runId: number, name: string, list: WidgetWithPrefetch[]) => {
            if (list.length > 0) {
                safePatch(runId, name, { status: "ready", validWidgets: list, validCount: list.length });
            } else {
                safePatch(runId, name, { status: "empty", validWidgets: [], validCount: 0 });
            }
        },
        [safePatch]
    );

    const prefetchWidget = useCallback(
        async (runId: number, widget: IWidget) => {
            if (runId !== runIdRef.current) return null;

            // IMPORTANT: $prefetchMode НЕ должен скрывать виджет в финальном UI => всегда false.
            // IMPORTANT: data не должен “протекать” в обычном режиме => data: undefined.

            // ImportedWidget: никаких prefetched-data, никаких скрывающих режимов
            if (widget.type === "importedWidget") {
                return {
                    ...widget,
                    data: undefined,
                    $prefetchMode: false,
                } as WidgetWithPrefetch;
            }

            const ds = getDataSource(widget);

            // нет dataSource -> виджет валидный, обычный режим
            if (!ds) {
                return {
                    ...widget,
                    data: undefined,
                    $prefetchMode: false,
                } as WidgetWithPrefetch;
            }

            try {
                const data = await loadRendererData(ds, abortControllerRef.current);
                const ok = validateBusinessData(data);
                if (!ok) return null;

                // есть prefetched data -> кладём data, но УБИРАЕМ dataSource (чтобы Renderer не дергал второй раз)
                return {
                    ...widget,
                    data,
                    dataSource: undefined,
                    $prefetchMode: false,
                } as WidgetWithPrefetch;
            } catch {
                // сеть/парсинг не должны “убивать” категорию — обычный режим
                return {
                    ...widget,
                    data: undefined,
                    $prefetchMode: false,
                } as WidgetWithPrefetch;
            }
        },
        []
    );

    const processCategory = useCallback(
        async (runId: number, categoryName: string) => {
            if (runId !== runIdRef.current) return;

            const candidates = categorizedCandidatesRef.current[categoryName] || [];
            if (candidates.length === 0) {
                finalize(runId, categoryName, []);
                return;
            }

            safePatch(runId, categoryName, { status: "loading" });

            const valid: WidgetWithPrefetch[] = [];

            for (const w of candidates) {
                if (runId !== runIdRef.current) return;

                const item = await prefetchWidget(runId, w);
                if (item) valid.push(item);
            }

            const finalList = sortWidgets(valid);
            finalize(runId, categoryName, finalList);
        },
        [finalize, prefetchWidget, safePatch]
    );

    // orchestrator: strictly one pending within visible window
    useEffect(() => {
        if (isProcessingRef.current) return;

        const nextName = findNextPending(categoryQueue, categoriesStatus, visibleCategoriesCount);
        if (!nextName) return;

        const runId = runIdRef.current;

        isProcessingRef.current = true;
        setIsLoadingCategory(true);

        processCategory(runId, nextName).finally(() => {
            if (runId !== runIdRef.current) return;
            isProcessingRef.current = false;
            setIsLoadingCategory(false);
        });
    }, [categoryQueue, categoriesStatus, visibleCategoriesCount, processCategory]);

    const requestNextCategory = useCallback(() => {
        if (revealInFlightRef.current) return;
        if (!hasMore) return;

        revealInFlightRef.current = true;

        setVisibleCategoriesCount((prev) => {
            const limit = queueLenRef.current;
            const next = Math.min(prev + 1, limit);
            if (next === prev) {
                revealInFlightRef.current = false;
            }
            return next;
        });
    }, [hasMore]);

    useEffect(() => {
        revealInFlightRef.current = false;
    }, [visibleCategoriesCount]);

    // anti-stuck: sentinel был в зоне во время загрузки -> после окончания грузим +1 (но не пачкой)
    useEffect(() => {
        if (!canAutoLoadBySentinel) return;
        if (!hasMore) return;
        if (isLoadingCategory) return;

        if (sentinelInViewRef.current && pendingTriggerRef.current && !cooldownRef.current) {
            pendingTriggerRef.current = false;
            cooldownRef.current = true;
            requestNextCategory();
        }
    }, [canAutoLoadBySentinel, hasMore, isLoadingCategory, requestNextCategory]);

    // ref callback: гарантированно навешивает observer на актуальную ноду
    const loadMoreObserverRef = useCallback(
        (node: Element | null) => {
            if (observerRef.current) {
                observerRef.current.disconnect();
                observerRef.current = null;
            }

            if (!node) return;

            const obs = new IntersectionObserver(
                (entries) => {
                    const isIntersecting = Boolean(entries[0]?.isIntersecting);
                    sentinelInViewRef.current = isIntersecting;

                    if (!isIntersecting) {
                        pendingTriggerRef.current = false;
                        cooldownRef.current = false;
                        return;
                    }

                    if (!canAutoLoadBySentinel) return;
                    if (!hasMore) return;

                    if (cooldownRef.current) return;

                    if (isLoadingCategory || isProcessingRef.current) {
                        pendingTriggerRef.current = true;
                        return;
                    }

                    cooldownRef.current = true;
                    requestNextCategory();
                },
                { threshold: 0, rootMargin: "200px 0px" }
            );

            obs.observe(node);
            observerRef.current = obs;
        },
        [canAutoLoadBySentinel, hasMore, isLoadingCategory, requestNextCategory]
    );

    useEffect(() => {
        return () => {
            abortControllerRef.current.abort();
            if (observerRef.current) observerRef.current.disconnect();
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
