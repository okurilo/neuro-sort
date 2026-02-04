import { lazy, Suspense, useEffect, useRef } from "react";
import { useStore } from "@nanostores/react";
import { WidgetsContainerStyled, WrapperGridStyled } from "./styled";
import { useInfiniteSortedWidgets } from "../hooks/useSortWidgets";
import { useBatchAnalytics } from "../hooks/useBatchAnalytics";
import { useContainerHeight } from "../hooks/useContainerHeight";
import { useGridScale } from "../hooks/useGridScale";
import { $widgets } from "../stores/widgets";
import { $widgetsShow, resetWidgetsShow } from "../stores/widgets-show";

const LazyWidget = lazy(() =>
    import("./Widget").then(({ Widget }) => ({ default: Widget }))
);

export const Widgets = () => {
    const widgets = useStore($widgets);
    const isShowWidgets = useStore($widgetsShow);
    const gridRef = useRef<HTMLDivElement>(null);

    const { finalDisplayedList, observerRef, observerElementIndex } =
        useInfiniteSortedWidgets(widgets);

    const { containerHeight } = useContainerHeight({
        gridRef,
        updateHeightOn: [finalDisplayedList.length],
    });

    useGridScale({ gridRef });

    useEffect(() => resetWidgetsShow, []);

    const { addToBatch } = useBatchAnalytics();

    const renderWidget = (widget: typeof finalDisplayedList[number], index: number) => {
        return (
            <Suspense key={widget.id}>
                {/* Suspense без fallback намеренно: ждём модуль, не показываем "пустышку". */}
                {/* @ts-expect-error TODO */}
                <LazyWidget
                    $prefetchMode={!!widget.$prefetchMode}
                    widget={widget}
                    observerRef={index === observerElementIndex ? observerRef : null}
                    $endAnalyticsBatch={addToBatch}
                    index={index}
                />
            </Suspense>
        );
    };

    return (
        <WidgetsContainerStyled $show={isShowWidgets}>
            <div style={{ height: containerHeight }}>
                <WrapperGridStyled ref={gridRef}>
                    {finalDisplayedList.map(renderWidget)}
                </WrapperGridStyled>
            </div>
        </WidgetsContainerStyled>
    );
};
