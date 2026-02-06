import { FC, lazy, Suspense, useEffect, useRef, useState } from "react";
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

const widgetModulePreload = import("./Widget");
const LazyWidget = lazy(() =>
    widgetModulePreload.then(({ Widget }) => ({ default: Widget }))
);

const LoadingMoreIndicator: FC = () => {
    return (
        <div style={{ padding: "16px", textAlign: "center" }}>
            <Text variant="bodyMRegular">Загрузка…</Text>
        </div>
    );
};

const Grid: FC<{
    widgets: WidgetWithPrefetch[];
    sendAnalyticsBatch: (events: unknown[]) => void;
}> = ({ widgets, sendAnalyticsBatch }) => {
    const gridRef = useRef<HTMLDivElement>(null);

    useGridScale({ gridRef });

    return (
        <div>
            <WrapperGridStyled ref={gridRef}>
                {widgets.map((widget, index) => {
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

export const WidgetsShelves = () => {
    const widgets = useStore($widgets);
    const isShowWidgets = useStore($widgetsShow);

    useEffect(() => {
        resetWidgetsShow();
    }, []);

    const { addToBatch } = useBatchAnalytics();

    const { preparedCategories, hasMore, loadMoreObserverRef, debug } =
        useWidgetsWithPrefetch(widgets);

    const [isWidgetModuleReady, setIsWidgetModuleReady] = useState(false);

    useEffect(() => {
        let mounted = true;

        widgetModulePreload
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

    useEffect(() => {
        if (!isShowWidgets) {
            console.log(
                `[INFQ] ui_lock show=${isShowWidgets} ` +
                    `inFlight=${debug.inFlight} req=${debug.requestedCount} ` +
                    `prep=${debug.preparedCount} q=${debug.queueLength} ` +
                    `hasMore=${hasMore} isIntersecting=${debug.isIntersecting}`
            );
        }
    }, [debug, hasMore, isShowWidgets]);

    const renderCategory = (category: { title: string; widgets: WidgetWithPrefetch[] }) => {
        if (!isWidgetModuleReady) return null;

        return (
            <div key={category.title}>
                <div style={{ marginTop: 16, marginBottom: 16 }}>
                    <Text variant="h3Semibold">{category.title}</Text>
                </div>

                <Grid widgets={category.widgets} sendAnalyticsBatch={addToBatch} />
            </div>
        );
    };

    return (
        <WidgetsContainerStyled $show={isShowWidgets}>
            {preparedCategories.map(renderCategory)}

            {hasMore && (
                <div ref={loadMoreObserverRef}>
                    {(() => {
                        const reason =
                            debug.nextPendingName === null
                                ? "nextName_null"
                                : debug.nextPendingStatus === "loading"
                                    ? "status_loading"
                                    : debug.nextPendingStatus === "pending"
                                        ? "status_pending"
                                        : debug.nextPendingStatus === "ready"
                                            ? "status_ready"
                                            : debug.nextPendingStatus === "empty"
                                                ? "status_empty"
                                                : "status_undefined";
                        console.log(
                            `[INFQ] render_category name=${debug.nextPendingName ?? "null"} ` +
                                `status=${debug.nextPendingStatus ?? "undefined"} ` +
                                `validCount=NA ` +
                                `candidatesLen=${debug.nextCandidatesLen} ` +
                                `reason=${reason}`
                        );
                        return <LoadingMoreIndicator />;
                    })()}
                </div>
            )}
        </WidgetsContainerStyled>
    );
};
