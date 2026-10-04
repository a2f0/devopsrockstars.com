import React, {useLayoutEffect, useRef} from 'react';
import {Link} from 'react-router';
import styled from 'styled-components';
import {features} from './environment';
import FlexContainerLeft from './styled-components/FlexContainerLeft';
import FlexContainerRight from './styled-components/FlexContainerRight';
import FlexContainerRow from './styled-components/FlexContainerRow';
import FlexHeader from './styled-components/FlexHeader';
import MenuItemLeft from './styled-components/MenuItemLeft';
import MenuItemRight from './styled-components/MenuItemRight';

const MenuLink = styled(Link)`
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: clamp(20px, 6vw, 24px);
`;

const MenuNav = styled.nav`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0 clamp(12px, 3vw, 20px);
`;

const Header = React.memo(() => {
  const header = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = header.current;
    if (!element) return;
    const updateHeight = () =>
      document.documentElement.style.setProperty(
        '--header-height',
        `${element.getBoundingClientRect().height}px`
      );
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty('--header-height');
    };
  }, []);

  return (
    <FlexHeader ref={header}>
      <FlexContainerRow>
        <FlexContainerLeft>
          <MenuItemLeft />
        </FlexContainerLeft>
        <FlexContainerRight>
          <MenuItemRight>
            <MenuNav aria-label="Main navigation">
              {features.search ? (
                <MenuLink to="/search">search</MenuLink>
              ) : null}
              {features.store ? <MenuLink to="/store">store</MenuLink> : null}
              <MenuLink to="/company">company</MenuLink>
            </MenuNav>
          </MenuItemRight>
        </FlexContainerRight>
      </FlexContainerRow>
    </FlexHeader>
  );
});

export default Header;
