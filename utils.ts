import { instance as httpClient } from "@sber-hrp-core/http-client/web";
import { RootProps } from "@sber-hrp-neuro/renderer/components/Renderer/types";
import URI from "urijs";
import URITemplate from "urijs/src/URITemplate";

import type { IWidget } from "../../types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const getRecord = (value: unknown): Record<string, unknown> | null =>
    isRecord(value) ? value : null;

const buildUrl = (
    url: NonNullable<RootProps["dataSource"]>["url"],
    options: NonNullable<RootProps["dataSource"]>["options"]
) => {
    if (options) {
        const { pathVariables, requestParams } = options;

        const template = new URITemplate(url);
        const uri = new URI(template.expand(pathVariables ?? {}));

        return uri.query(requestParams ?? {}).valueOf();
    }

    return url;
};

export const loadRendererData = async (
    dataSource: NonNullable<RootProps["dataSource"]>,
    abortController: AbortController
) => {
    const { method, options = {}, url: uri } = dataSource;

    const url = buildUrl(uri, options);
    const response = await httpClient(url, {
        body: options.requestBody,
        headers: options.headers,
        method: method ?? "get",
        signal: abortController.signal,
    });

    const data = await response.json();
    return data;
};

export const migrateOnMountToDataSource = (body: unknown) => {
    const bodyObj = getRecord(body);
    if (!bodyObj) return body;

    const triggers = getRecord(bodyObj.triggers);
    const onMount = getRecord(triggers?.onMount);
    const onMountAction = onMount?.action;

    if (!Array.isArray(onMountAction)) {
        return body;
    }

    const requestIndex = onMountAction.findIndex((action: unknown) => {
        if (typeof action !== "object" || action === null) return false;
        const actionObj = action as Record<string, unknown>;
        return typeof actionObj.type === "string" && actionObj.type.startsWith("http.");
    });

    if (requestIndex === -1) {
        return body;
    }

    const requestAction = onMountAction[requestIndex] as Record<string, unknown>;
    const actionType = requestAction.type as string;
    const method = actionType.split(".")[1];

    const dataSource = {
        url: requestAction.url as string,
        method,
        options: {
            requestBody: requestAction.body,
            headers: requestAction.headers,
            requestParams: requestAction.params,
            pathVariables: requestAction.pathVariables,
        },
    };

    onMountAction.splice(requestIndex, 1);

    if (onMountAction.length === 0 && onMount && triggers) {
        delete onMount.action;
        if (Object.keys(onMount).length === 0) delete triggers.onMount;
        if (Object.keys(triggers).length === 0) delete bodyObj.triggers;
    }

    return {
        ...bodyObj,
        dataSource,
    };
};

export interface CategoryConfig {
    codes: string[];
    ordering: number;
}

export const CATEGORY_MAPPING: Record<string, CategoryConfig> = {
    важно: {
        codes: ["app-perftracker:neuro-tasks"],
        ordering: 1,
    },
    "для меня": {
        codes: [
            "absences:vacations",
            "absences:working-days",
            "app-health-api:health",
            "app-income:normative_wage",
            "app-income:current_month_income",
            "spine-ui-launchpad:launchpad",
        ],
        ordering: 2,
    },
    "моя команда": {
        codes: [
            "spine-ui-people:people-v2",
            "spine-ui-dates:events",
            "app-web-cloud-analytics:macroWidget",
        ],
        ordering: 3,
    },
    развитие: {
        codes: [
            "spine-feed:continue-ai-native",
            "spine-feed:recommendation-ai-native",
            "app-web-growth:advertising-banner-ai-native",
            "app-web-growth:daily-card-ai-native",
            "app-web-growth:events-poster-all-events-ai-native",
        ],
        ordering: 4,
    },
    эффективность: {
        codes: [
            "app-smart-profile:social-circle",
            "smartcalendar:maindash",
            "app-web-smartcalendar:habits",
        ],
        ordering: 5,
    },
    "обучение/дайджесты": {
        codes: [
            "app-web-growth:p2p-recommendations-ai-native",
            "app-web-growth:favorite-collection-ai-native",
            "app-web-growth:events-poster-my-events-ai-native",
            "app-web-growth:quarterly-results-ai-native",
            "app-web-growth:annual-results-ai-native",
        ],
        ordering: 6,
    },
    "профиль/кадры": {
        codes: [
            "app-smart-profile:skills",
            "app-smart-profile:fullnessWidget",
            "app-smart-profile:useful-contacts",
            "execution-management:group-issues-widget",
            "execution-management:my-issues-widget",
        ],
        ordering: 7,
    },
    "сервисные/расчёты": {
        codes: [
            "app-income:last_paid_calculation",
            "app-income:app_income",
            "app-income:last_regular_calculation",
            "app-web-learning-requests:learning-requests-ai-native",
            "app-web-self-drm:user-privileges-widget",
        ],
        ordering: 8,
    },
    прочие: {
        codes: ["spine-ui-posts:posts"],
        ordering: 99,
    },
};

export const FALLBACK_CATEGORY = "разное";

const CODE_TO_CATEGORY: Record<string, string> = Object.entries(CATEGORY_MAPPING).reduce(
    (acc, [categoryName, config]) => {
        for (const code of config.codes) acc[code] = categoryName;
        return acc;
    },
    {} as Record<string, string>
);

export const validateBusinessData = (data: unknown): boolean => {
    if (data === null || data === undefined) return false;

    if (typeof data === "string") return data.trim().length > 0;
    if (Array.isArray(data)) return data.length > 0;

    if (typeof data === "object") return Object.keys(data).length > 0;

    return true;
};

const getRendererDataSource = (
    widget: IWidget
): NonNullable<RootProps["dataSource"]> | null => {
    if (widget.type !== "renderer") return null;

    const body = getRecord(widget.body);
    if (body?.dataSource) {
        return body.dataSource as NonNullable<RootProps["dataSource"]>;
    }

    const migratedBody = migrateOnMountToDataSource(widget.body);
    const migratedRecord = getRecord(migratedBody);
    if (migratedRecord?.dataSource) {
        return migratedRecord.dataSource as NonNullable<RootProps["dataSource"]>;
    }

    return null;
};

const getImportedDataSource = (
    widget: IWidget
): NonNullable<RootProps["dataSource"]> | null => {
    if (widget.type !== "importedWidget") return null;

    const record = getRecord(widget as unknown);
    const dataSource = record?.dataSource;
    return dataSource
        ? (dataSource as NonNullable<RootProps["dataSource"]>)
        : null;
};

export const getDataSource = (
    widget: IWidget
): NonNullable<RootProps["dataSource"]> | null => {
    return getRendererDataSource(widget) ?? getImportedDataSource(widget);
};

export const categorizeWidgets = (widgets: IWidget[]): Record<string, IWidget[]> => {
    const result: Record<string, IWidget[]> = {};
    const fallback: IWidget[] = [];

    for (const widget of widgets) {
        const categoryName = CODE_TO_CATEGORY[widget.code];
        if (categoryName) {
            if (!result[categoryName]) result[categoryName] = [];
            result[categoryName].push(widget);
        } else {
            fallback.push(widget);
        }
    }

    if (fallback.length > 0) {
        result[FALLBACK_CATEGORY] = fallback;
    }

    return result;
};
