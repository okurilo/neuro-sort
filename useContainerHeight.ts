import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useEventListener, useResizeObserver } from "usehooks-ts";

// @todo КОСТЫЛЬ! ВРЕМЕННОЕ РЕШЕНИЕ! NEUROUI-629
export const useContainerHeight = ({
    gridRef,
    updateHeightOn,
}: {
    gridRef: React.RefObject<HTMLDivElement>;
    updateHeightOn: Array<unknown>;
}) => {
    const [containerHeight, setContainerHeight] = useState<number | null>(null);

    const rafRef = useRef<number | null>(null);

    const measure = useCallback(() => {
        const node = gridRef.current;
        if (!node) return;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            const next = node.getBoundingClientRect().height;

            setContainerHeight((prev) => {
                if (next <= 0.5 && prev !== null) return prev;
                if (prev === null || Math.abs(prev - next) > 0.5) return next;
                return prev;
            });
            rafRef.current = null;
        });
    }, [gridRef]);

    // Базовый пересчет по сигналам (как было), но зависим от значений, а не от ссылки на массив
    useLayoutEffect(() => {
        measure();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...updateHeightOn]);

    // Пересчет при ресайзе окна (как было)
    useEventListener("resize", measure);

    // Пересчет при любом изменении размеров DOM-контента внутри грида
    const { height: observedHeight } = useResizeObserver({ ref: gridRef });
    useEffect(() => {
        if (typeof observedHeight !== "number") return;
        measure();
    }, [observedHeight, measure]);

    useEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, []);

    return { containerHeight };
};
