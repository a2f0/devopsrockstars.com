import {mountSkyline} from '@a2f0/skyline';
import React, {useEffect, useRef} from 'react';
import styled from 'styled-components';
import {features} from './featureFlags';
import {useHatPreviewPreparing} from './store/PreparedHatPreview';

const skyline = '/static/image/skyline.svg';

const FullScreenSkyline = styled.div`
  z-index: -1337;
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100vh;
  height: 100dvh;
  align-items: flex-end;
  display: flex;
`;

const FillContainerImg = styled.img`
  width: 100%;
  max-height: 100%;
  object-fit: contain;
  object-position: bottom;
  display: block;
`;

const InteractiveSkyline = styled(FullScreenSkyline)`
  pointer-events: auto;
`;

function Skyline3d() {
  const container = useRef<HTMLDivElement>(null);
  const preparingHat = useHatPreviewPreparing();
  useEffect(() => {
    // Avoid two expensive model builds competing for CPU/GPU startup time.
    // The SVG stays visible until the parked hat settles, including failure.
    if (preparingHat || !container.current) return;
    const viewer = mountSkyline(container.current, {
      assetsUrl: '/static/skyline/',
    });
    return () => viewer.destroy();
  }, [preparingHat]);
  if (preparingHat) return <OriginalSkyline />;
  return <InteractiveSkyline id="skyline" ref={container} />;
}

function OriginalSkyline() {
  return (
    <FullScreenSkyline>
      <FillContainerImg src={skyline} alt="skyline" id="skyline" />
    </FullScreenSkyline>
  );
}

const Skyline = React.memo(() =>
  features.skyline3d ? <Skyline3d /> : <OriginalSkyline />
);

export default Skyline;
