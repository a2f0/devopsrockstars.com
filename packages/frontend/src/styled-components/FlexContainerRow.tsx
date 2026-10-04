// biome-ignore lint: style/useImportType
import React from 'react';
import styled from 'styled-components';

const StyledRow = styled.div`
  display: flex;
  justify-content: center;
  flex-direction: row;
  width: 100%;
`;

interface IProps {
  children: React.ReactNode;
}

const FlexContainerRow = ({children}: IProps) => (
  <StyledRow>{children}</StyledRow>
);
export default FlexContainerRow;
