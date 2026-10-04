import styled from 'styled-components';

const FlexFullHeightMin = styled.div`
  display: flex;
  width: min(960px, calc(100% - 20px));
  min-height: 100vh;
  min-height: 100dvh;
  min-width: 0;
  margin-left: 10px;
  margin-right: 10px;
`;

export default FlexFullHeightMin;
