import styled from 'styled-components';

const FlexFooter = styled.footer`
  display: flex;
  padding: 12px 0 max(12px, env(safe-area-inset-bottom));

  a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
`;

export default FlexFooter;
