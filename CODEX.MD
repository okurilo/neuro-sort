# CODEX

## Источник контекста
- Базовая информация перенесена из вводного сообщения пользователя о ленте виджетов Pulse.

## Ключевые принятые решения
- Держать UX-цели: 2 категории сразу, затем по одной при подходе к sentinel (≈200px), категория появляется “одним кадром”.
- Сохранить надёжный пересчёт высоты контейнера (`ResizeObserver` + `requestAnimationFrame`).
- Предзагрузка `./Widget` модуля и условия рендера категории (ready + validCount + module loaded).
- Оркестрация загрузки категорий по одной, с защитой от “залипания” `IntersectionObserver` через `pendingTriggerRef` и `cooldownRef`.
- Prefetch данных: фильтрация “пустых” виджетов, но ошибки запросов не скрывают виджет.
- `$prefetchMode` — только визуальный режим, в финальных валидных виджетах всегда `false`.
- Для `renderer`: при успешном prefetch можно положить `data`, но убрать `dataSource`.
- Для `importedWidget`: всегда `data: undefined`, `$prefetchMode: false`.

## Ошибочные подходы (не повторять)
- Возврат к логике, где `React.lazy`/`Suspense` и измерение высоты дают нулевую высоту и приводят к наложению контента.
- Прогрузка категориями пачками или без защиты от “залипания” `IntersectionObserver`.

## Последние изменения
- Рефакторинг `useWidgetsWithPrefetch.ts`: объединена инициализация, добавлены локальные helpers, упрощены `patchCategory`/`finalizeCategory`, `prefetchWidget`.
- Рефакторинг `utils.ts`: добавлены `isRecord`/`getRecord`, вынесен `CODE_TO_CATEGORY`, упрощён `getDataSource`.
- Рефакторинг `Widgets.tsx`: добавлен `canRenderCategory`, выделен `renderCategory`, упрощён ref для sentinel.
