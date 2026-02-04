import { FC, useCallback, useRef, useState } from "react";
import { IEvent } from "@sber-hrp-neuro/renderer/components/Renderer/utils/types";
import { EventTypeEnum } from "@sber-hrp-core/analytics";
import { useStore } from "@nanostores/react";
import { useUserJProfileSettingsLanguage } from "@sber-hrp-core/api-user/hooks";
import { ActionPanel } from "./ActionPanel";
import { WidgetWrapper, WrapperStyled } from "./styled";
import { IWidgetProps } from "./types";
import { ImportedWidget } from "../../../../components/ImportedWidget";
import { AnalyticsSingleton } from "../../../../analytics/NeuroAnalytics";
import { getGridValues } from "./utils";
import { useHoverAnalytics, useRecAnalytics, useViewAnalytics } from "./hooks";
import { CATEGORY_WIDGETS } from "../../../../analytics/constants";
import { Embedding } from "./Embedding";
import { Renderer } from "../../../../components/Renderer";
import { $userPID } from "../../../../stores/user";
import { useGigaBox } from "./hooks/useGigaBox";
import { normalizeSize } from "../../../../helpers/normalizeSize";
import { MAIN_SHOW_ONBOARDING } from "../../../../modules/event-emitter/constants";
import { useSubscribeEvent } from "../../../../hooks/useSubscribeEvent";

export const Widget: FC<IWidgetProps> = ({
  widget,
  $prefetchMode,
  observerRef,
  sendAnalyticsBatch,
  index,
}) => {
  const gigaBoxState = useGigaBox();
  const userPID = useStore($userPID);
  const profileSettings = useUserJProfileSettingsLanguage();
  const [forceShow, setForceShow] = useState(false);

  useSubscribeEvent(MAIN_SHOW_ONBOARDING, ({ show }) => {
    if (show && index === 1) {
      setForceShow(true);
    } else {
      setForceShow(false);
    }
  });

  const widgetSize = normalizeSize(widget.availableSizes);

  const sendAnalytics = useCallback(
    (props: IEvent) => {
      AnalyticsSingleton.sendEvent({
        personId: userPID,
        applicationId: "dashboard",
        event:
          props.event.toUpperCase() === "CLICK"
            ? "BUTTON"
            : props.event.toUpperCase(),
        widgetId: widget.id,
        value: props.value,
        elementType: props.type,
        index,
        score: widget.score,
        modelName: widget.modelName,
      });
    },
    [index, userPID, widget.id, widget.modelName, widget.score]
  );

  const wrapperRef = useRef(null);

  const isMicroapp = widget.body.type === "ImportedWidget";
  useRecAnalytics(
    widget,
    sendAnalyticsBatch,
    index,
    widget.score,
    widget.modelName
  );

  useViewAnalytics(
    wrapperRef?.current,
    sendAnalyticsBatch,
    widget.id,
    index,
    widget.score,
    widget.modelName
  );

  useHoverAnalytics(
    wrapperRef?.current,
    sendAnalyticsBatch,
    widget.id,
    index,
    widget.score,
    widget.modelName
  );

  const { gRow: gridRow, gColumn: gridColumn } = getGridValues(widgetSize);

  const isEmbedding = widget.body.type === "Embedding";
  const $bannerMode = widget.code.startsWith("banner:");
  const isRenderer = !isEmbedding && !isMicroapp;

  const dataTourIndex =
    {
      0: "tour_2",
      1: "tour_3",
    }[index] || "";

  return (
    <WidgetWrapper
      ref={wrapperRef}
      data-testid="widget"
      data-tour={dataTourIndex}
      $gRow={gridRow}
      $gColumn={gridColumn}
      $hideActionPanel={
        gigaBoxState.hasGigaBox && gigaBoxState.state !== "idle"
      }
      className={$prefetchMode ? "prefetchMode" : ""}
      key={widget.id}
      onMouseDown={() => {
        AnalyticsSingleton.clickStream(
          EventTypeEnum.CLICK,
          `${CATEGORY_WIDGETS}/${widget.code}/Клик на виджет`
        );
      }}
    >
      <WrapperStyled
        data-widgetid={widget.id}
        data-prefetch={$prefetchMode}
        data-microapp={widget.body.type === "ImportedWidget"}
        $bannerMode={$bannerMode}
        ref={observerRef}
        size={widgetSize}
        $prefetchMode={$prefetchMode}
      >
        {isEmbedding && <Embedding widget={widget} />}
        {isMicroapp && (
          <ImportedWidget
            widget={widget.body.props.widget}
            isService={false}
            focusToggle={() => console.warn("focusToggle is deprecated")}
            WID={widget.id}
            hostApp="dashboard"
          />
        )}
        {isRenderer && (
          <Renderer
            // @ts-expect-error TODO
            body={widget.body}
            data={widget.data}
            dataSource={widget.dataSource}
            dataTransform={widget.dataTransform}
            // Этот костыль делался для демо ГО 2025-09-12 для виджетов опросов
            // на главной (в составе хотфикса 2025-09-11)
            // Снести к херам костыль когда снесем эти виджеты или
            // когда переделаем их по нормальному, с использованием форм
            initialState={{
              demoMotivation: "Покажи мои активности и волонтёрство",
              demoBook: "Покажи ТОП 10 книг по версии Германа Грефа",
              demoOffice: "Покажи мои рабочие предпочтения в профиле",
            }}
            locale={profileSettings?.language ?? "ru-RU"}
            onTrigger={sendAnalytics}
            {...gigaBoxState}
          />
        )}
      </WrapperStyled>

      <ActionPanel
        WID={widget.id}
        pinned={widget.pinned}
        showAnalise={gigaBoxState.state === "idle"}
        performAnalysis={gigaBoxState.performAnalysis}
        code={widget.code}
        forceShow={forceShow}
      />
    </WidgetWrapper>
  );
};