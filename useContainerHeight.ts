import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

// @todo КОСТЫЛЬ! ВРЕМЕННОЕ РЕШЕНИЕ! NEUROUI-629
export const useContainerHeight = ({
    gridRef,
    updateHeightOn,
}: {
    gridRef: React.RefObject<HTMLDivElement>;
    updateHeightOn: Array<unknown>;
}) => {
    const [containerHeight, setContainerHeight] = useState(0);

    const rafRef = useRef<number | null>(null);

    const measure = useCallback(() => {
        const node = gridRef.current;
        if (!node) return;

        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
            const next = node.getBoundingClientRect().height;

            setContainerHeight((prev) => (Math.abs(prev - next) > 0.5 ? next : prev));
            rafRef.current = null;
        });
    }, [gridRef]);

    // Базовый пересчет по сигналам (как было), но зависим от значений, а не от ссылки на массив
    useLayoutEffect(() => {
        measure();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [...updateHeightOn]);

    // Пересчет при ресайзе окна (как было)
    useEffect(() => {
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [measure]);

    // НОВОЕ: пересчет при любом изменении размеров DOM-контента внутри грида
    useEffect(() => {
        const node = gridRef.current;
        if (!node) return;

        if (typeof ResizeObserver === "undefined") {
            measure();
            return;
        }

        const ro = new ResizeObserver(() => {
            measure();
        });

        ro.observe(node);

        return () => {
            ro.disconnect();
        };
    }, [gridRef, measure]);

    useEffect(() => {
        return () => {
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
            }
        };
    }, []);

    return { containerHeight };
};