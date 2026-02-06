import { instance as httpClient } from "@sber-hrp-core/http-client/web";
import { RootProps } from "@sber-hrp-neuro/renderer/components/Renderer/types";
import URI from "urijs";
import URITemplate from "urijs/src/URITemplate";


import type { IWidget } from "../../types";


type RendererDataSource = NonNullable<RootProps["dataSource"]>;


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
 * Функция для миграции запросов из старого формата onMount в новый формат dataSource.
 * Выполняет поиск первого HTTP-запроса, перекладывает его в корень конфига
 * и удаляет из списка триггеров.
 */
export const migrateOnMountToDataSource = (
    body: any
): Pick<IWidget, "body" | "dataSource"> => {
    const onMountAction = body?.triggers?.onMount?.action;


    if (!Array.isArray(onMountAction)) {
        return body;
    }


    // Находим индекс первого действия, которое является HTTP-запросом
    const requestIndex = onMountAction.findIndex((action: any) =>
        action.type?.startsWith("http.")
    );


    if (requestIndex === -1) {
        return body;
    }


    const requestAction = onMountAction[requestIndex];


    // Извлекаем метод из типа (например, 'http.get' -> 'get')
    const method = requestAction.type.split(".")[1];


    // Формируем объект dataSource по контракту
    const dataSource = {
        url: requestAction.url,
        method,
        options: {
            // Маппинг полей из старого формата в новый
            requestBody: requestAction.body,
            headers: requestAction.headers,
            requestParams: requestAction.params,
            pathVariables: requestAction.pathVariables,
        },
    };


    // Удаляем найденный запрос из массива onMount.action
    onMountAction.splice(requestIndex, 1);


    // Очищаем пустые узлы, чтобы не оставлять мусор в конфиге
    if (onMountAction.length === 0) {
        delete body.triggers.onMount;
        if (Object.keys(body.triggers).length === 0) {
            delete body.triggers;
        }
    }


    return {
        ...body,
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


const CODE_TO_CATEGORY: Record<string, string> = Object.entries(
    CATEGORY_MAPPING
).reduce((acc, [categoryName, config]) => {
    for (const code of config.codes) acc[code] = categoryName;
    return acc;
}, {} as Record<string, string>);


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
 * Унифицированно возвращает dataSource для виджета, если есть.
 */
export const getDataSource = (widget: IWidget): IWidget["dataSource"] => {
    return migrateOnMountToDataSource(widget).dataSource;
};


/**
 * Раскладывает виджеты по категориям, лишние уходят в FALLBACK_CATEGORY.
 */
export const categorizeWidgets = (
    widgets: IWidget[]
): Record<string, IWidget[]> => {
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