import { useEffect, useState } from "react";

// @todo КОСТЫЛЬ! ВРЕМЕННОЕ РЕШЕНИЕ! NEUROUI-629
export const useContainerHeight = ({
    gridRef,
    updateHeightOn,
}: {
    gridRef: React.RefObject<HTMLDivElement>;
    updateHeightOn: Array<unknown>;
}) => {
    const [containerHeight, setContainerHeight] = useState(0);

    useEffect(() => {
        if (gridRef.current) {
            setContainerHeight(gridRef.current.getBoundingClientRect().height);
        }
    }, [updateHeightOn]);

    useEffect(() => {
        const onResize = () => {
            if (gridRef.current) {
                setContainerHeight(gridRef.current.getBoundingClientRect().height);
            }
        };

        window.addEventListener("resize", onResize);

        return () => {
            window.removeEventListener("resize", onResize);
        };
    }, []);

    return { containerHeight };
};