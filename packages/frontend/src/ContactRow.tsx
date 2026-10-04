import React from 'react';
import styled from 'styled-components';
import SVG from './SVG';

const Row = styled.a`
  display: flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  min-height: 44px;
  text-decoration: none;

  .svg {
    fill: var(--foreground-color);
  }

  &:hover .svg,
  &:focus-visible .svg {
    fill: var(--hover-color);
  }
`;

const Icon = styled.span`
  display: flex;
  flex-shrink: 0;
`;

const Description = styled.span`
  min-width: 0;
  overflow-wrap: anywhere;
`;

interface IProps {
  svgWidth: number;
  svgHeight: number;
  svgPath: string;
  rowDescription: string;
  uri: string;
}

const ContactRow = React.memo(
  ({svgWidth, svgHeight, svgPath, rowDescription, uri}: IProps) => (
    <Row href={uri}>
      <Icon>
        <SVG
          height={svgHeight}
          width={svgWidth}
          path={svgPath}
          initialGrayscale={0}
        />
      </Icon>
      <Description>{rowDescription}</Description>
    </Row>
  )
);

export default ContactRow;
