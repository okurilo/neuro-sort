import { FC, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@nanostores/react";
import { Text } from "@pulse/ui/components/Text";

import { WidgetsContainerStyled, WrapperGridStyled } from "./styled";
import { useBatchAnalytics } from "./hooks/useBatchAnalytics";
import { useGridScale } from "./hooks/useGridScale";
import { $widgets } from "../stores/widgets";
import { $widgetsShow, resetWidgetsShow } from "../stores/widgets-show";

import {
    useWidgetsWithPrefetch,
    WidgetWithPrefetch,
} from "./hooks/useWidgetsWithPrefetch";

const widgetModulePromise = import("./Widget");
const LazyWidget = lazy(() =>
    widgetModulePromise.then(({ Widget }) => ({ default: Widget }))
);

const canRenderCategory = (
    status: { status: "pending" | "loading" | "ready" | "empty"; validCount: number },
    isWidgetModuleReady: boolean
) => {
    if (status.status !== "ready") return false;
    if (status.validCount <= 0) return false;
    return isWidgetModuleReady;
};

const SingleCategoryLoader: FC = () => {
    return (
        <div style={{ padding: "16px", textAlign: "center" }}>
            <Text variant="bodyMRegular">Загрузка…</Text>
        </div>
    );
};

const Grid: FC<{
    value: WidgetWithPrefetch[];
    sendAnalyticsBatch: (events: unknown[]) => void;
}> = ({ value, sendAnalyticsBatch }) => {
    const gridRef = useRef<HTMLDivElement>(null);

    useGridScale({ gridRef });

    return (
        <div>
            <WrapperGridStyled ref={gridRef}>
                {value.map((widget, index) => {
                    return (
                        <Suspense key={widget.id} fallback={null}>
                            {/* Widget.tsx ожидает observerRef, но для текущей схемы он не нужен */}
                            {/* @ts-expect-error TODO */}
                            <LazyWidget
                                $prefetchMode={!!widget.$prefetchMode}
                                widget={widget}
                                observerRef={null}
                                sendAnalyticsBatch={sendAnalyticsBatch}
                                index={index}
                            />
                        </Suspense>
                    );
                })}
            </WrapperGridStyled>
        </div>
    );
};

export const Widgets = () => {
    const widgets = useStore($widgets);
    const isShowWidgets = useStore($widgetsShow);
    const DEBUG = true;

    useEffect(() => {
        resetWidgetsShow();
    }, []);

    const { addToBatch } = useBatchAnalytics();

    const {
        categoriesStatus,
        categoryQueue,
        visibleCategoriesCount,
        hasMore,
        isLoadingCategory,
        loadMoreObserverRef,
    } = useWidgetsWithPrefetch(widgets);

    const [isWidgetModuleReady, setIsWidgetModuleReady] = useState(false);

    useEffect(() => {
        let mounted = true;

        widgetModulePromise
            .then(() => {
                if (mounted) setIsWidgetModuleReady(true);
            })
            .catch(() => {
                if (mounted) setIsWidgetModuleReady(true);
            });

        return () => {
            mounted = false;
        };
    }, []);

    const visibleCategories = useMemo(() => {
        return categoryQueue.slice(0, visibleCategoriesCount);
    }, [categoryQueue, visibleCategoriesCount]);

    const renderCategory = (categoryName: string) => {
        const status = categoriesStatus[categoryName];
        if (!status) return null;
        if (!canRenderCategory(status, isWidgetModuleReady)) return null;

        return (
            <div key={categoryName}>
                <div style={{ marginTop: 16, marginBottom: 16 }}>
                    <Text variant="h3Semibold">{categoryName}</Text>
                </div>

                <Grid value={status.validWidgets} sendAnalyticsBatch={addToBatch} />
            </div>
        );
    };

    useEffect(() => {
        if (!DEBUG) return;
        console.log("[WIDGETS]", {
            visibleCategoriesCount,
            hasMore,
            isLoadingCategory,
            renderedCategories: categoryQueue.slice(0, visibleCategoriesCount),
        });
    }, [DEBUG, visibleCategoriesCount, hasMore, isLoadingCategory, categoryQueue]);

    return (
        <WidgetsContainerStyled $show={isShowWidgets}>
            {visibleCategories.map(renderCategory)}

            {(hasMore || isLoadingCategory) && (
                <div ref={loadMoreObserverRef}>
                    <SingleCategoryLoader />
                </div>
            )}
        </WidgetsContainerStyled>
    );
};
