import { instance as httpClient } from "@sber-hrp-core/http-client/web";
import { RootProps } from "@sber-hrp-neuro/renderer/components/Renderer/types";
import URI from "urijs";
import URITemplate from "urijs/src/URITemplate";

import type { IWidget } from "../../types";

type RendererDataSource = NonNullable<RootProps["dataSource"]>;

/**
 * Проверяет, что значение является объектом-словарём.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

/**
 * Безопасно приводит значение к Record.
 */
const toRecord = (value: unknown): Record<string, unknown> | null =>
    isRecord(value) ? value : null;

/**
 * Собирает URL для renderer-данных из template + options.
 */
const buildRendererUrl = (
    uriTemplate: string,
    options: RendererDataSource["options"]
): string => {
    const { pathVariables, requestParams } = options ?? {};
    const template = new URITemplate(uriTemplate);
    return new URI(template.expand(pathVariables ?? {}))
        .query(requestParams ?? {})
        .valueOf();
};

/**
 * Загружает данные для renderer-виджета через dataSource.
 */
export const loadRendererData = async (
    dataSource: RendererDataSource,
    abortController: AbortController
) => {
    const { method, options = {}, url: uriTemplate } = dataSource;
    const url = buildRendererUrl(uriTemplate, options);

    const response = await httpClient(url, {
        body: options.requestBody,
        headers: options.headers,
        method: method ?? "get",
        signal: abortController.signal,
    });

    return response.json();
};

/**
 * Ищет первый http.* action в onMount.
 */
const findHttpActionIndex = (actions: unknown[]): number => {
    for (let i = 0; i < actions.length; i++) {
        const action = actions[i];
        const actionObj = toRecord(action);
        if (!actionObj) {
            // no-op
        } else {
            const type = actionObj.type;
            if (typeof type === "string" && type.startsWith("http.")) {
                return i;
            }
        }
    }

    return -1;
};

/**
 * Превращает onMount action в dataSource.
 */
const toDataSourceFromAction = (action: Record<string, unknown>): RendererDataSource => {
    const actionType = typeof action.type === "string" ? action.type : "";
    const method = actionType.split(".")[1];

    return {
        url: action.url as string,
        method,
        options: {
            requestBody: action.body,
            headers: action.headers,
            requestParams: action.params,
            pathVariables: action.pathVariables,
        },
    };
};

/**
 * Переносит http.* onMount в dataSource и чистит triggers.
 */
export const migrateOnMountToDataSource = (body: unknown) => {
    const bodyObj = toRecord(body);
    if (!bodyObj) return body;

    const triggers = toRecord(bodyObj.triggers);
    const onMount = toRecord(triggers?.onMount);
    const onMountAction = onMount?.action;

    if (!Array.isArray(onMountAction)) return body;

    const requestIndex = findHttpActionIndex(onMountAction);
    if (requestIndex === -1) return body;

    const requestAction = onMountAction[requestIndex] as Record<string, unknown>;
    const dataSource = toDataSourceFromAction(requestAction);

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

/**
 * Валидирует бизнес-данные: пустые строки/массивы/объекты считаем невалидными.
 */
export const validateBusinessData = (data: unknown): boolean => {
    if (data === null || data === undefined) return false;

    if (typeof data === "string") return data.trim().length > 0;
    if (Array.isArray(data)) return data.length > 0;

    if (typeof data === "object") return Object.keys(data).length > 0;

    return true;
};

/**
 * Достаёт dataSource из renderer-виджета (включая миграцию).
 */
const getRendererDataSource = (widget: IWidget): RendererDataSource | null => {
    if (widget.type !== "renderer") return null;

    const body = toRecord(widget.body);
    if (body?.dataSource) {
        return body.dataSource as RendererDataSource;
    }

    const migratedBody = migrateOnMountToDataSource(widget.body);
    const migratedRecord = toRecord(migratedBody);
    if (migratedRecord?.dataSource) {
        return migratedRecord.dataSource as RendererDataSource;
    }

    return null;
};

/**
 * Достаёт dataSource из importedWidget.
 */
const getImportedWidgetDataSource = (widget: IWidget): RendererDataSource | null => {
    if (widget.type !== "importedWidget") return null;
    const record = toRecord(widget as unknown);
    if (!record?.dataSource) return null;
    return record.dataSource as RendererDataSource;
};

/**
 * Унифицированно возвращает dataSource для виджета, если есть.
 */
export const getDataSource = (widget: IWidget): RendererDataSource | null => {
    return getRendererDataSource(widget) ?? getImportedWidgetDataSource(widget);
};

/**
 * Раскладывает виджеты по категориям, лишние уходят в FALLBACK_CATEGORY.
 */
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
