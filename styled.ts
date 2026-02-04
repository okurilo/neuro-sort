export const WrapperGridStyled = styled.div`
  margin-top: 32px;
  display: grid;
  gap: 16px;
  box-sizing: border-box;
  width: fit-content;

  grid-template-columns: 1fr 1fr;
  grid-auto-rows: 280px;
  transform-origin: top left;

  // @todo КОСТЫЛЬ! ВРЕМЕННОЕ РЕШЕНИЕ! NEUROUI-629
  @media screen and (min-width: 768px) {
    grid-template-columns: repeat(3, 296px);
  }

  @media screen and (min-width: 809px) {
    grid-template-columns: repeat(3, 294px);
  }

  @media screen and (min-width: 819px) {
    grid-template-columns: repeat(3, 294px);
  }

  @media screen and (min-width: 833px) {
    grid-template-columns: repeat(3, 294px);
  }

  @media screen and (min-width: 976px) {
    grid-template-columns: repeat(4, 294px);
  }

  @media screen and (min-width: 1023px) {
    grid-template-columns: repeat(4, 294px);
  }

  @media screen and (min-width: 1179px) {
    grid-template-columns: repeat(4, 294px);
  }

  @media screen and (min-width: 1193px) {
    grid-template-columns: repeat(4, 294px);
  }

  @media screen and (min-width: 1209px) {
    grid-template-columns: repeat(4, 294px);
  }

  @media screen and (min-width: 1280px) {
    transform: scale(1);
    grid-template-columns: repeat(4, 294px);
    gap: 24px;
    grid-auto-rows: 280px;
    width: 1248px;
  }
  grid-auto-flow: row dense;
`;

interface WidgetsContainerProps {
    $show: boolean;
}

export const WidgetsContainerStyled = styled.div<WidgetsContainerProps>`
  opacity: ${({ $show }) => ($show ? "1" : "0")};
  transition: opacity 0.5s ease;
`;