import type { IWidget } from "../../types";

type CategoryLoadStatus = "pending" | "loading" | "ready" | "empty";

export interface WidgetWithPrefetch extends IWidget {
    $prefetchMode: boolean;
}

export interface CategoryStatus {
    status: CategoryLoadStatus;
    validWidgets: WidgetWithPrefetch[];
    validCount: number;
}
