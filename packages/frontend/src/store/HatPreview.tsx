import React, {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import styled, {keyframes} from 'styled-components';

import type {createHatViewer} from './hatViewer';

const whiteStar = '/static/image/white-star-only.svg';

const Preview = styled.div`
  width: min(100%, 640px);
`;

const Stage = styled.div`
  position: relative;
  aspect-ratio: 612 / 390;

  canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  canvas { cursor: grab; }
  canvas:active { cursor: grabbing; }
  canvas:focus-visible { outline: 1px solid #aaa; outline-offset: 4px; }
`;

// A sixth of a turn lands the six-pointed mark on the same silhouette.
const turn = keyframes`
  0% { transform: rotate(0deg) scale(0.94); opacity: 0.65; }
  50% { transform: rotate(30deg) scale(1); opacity: 1; }
  100% { transform: rotate(60deg) scale(0.94); opacity: 0.65; }
`;

const PreviewStatus = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
`;

const UnavailableMessage = styled.span`
  position: absolute;
  bottom: 0;
  left: 0;
  width: 100%;
  margin: 0;
  color: #aaa;
  font-size: 12px;
`;

const Announcement = styled.span`
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
`;

const LoadingStar = styled.span`
  position: relative;
  display: grid;
  place-items: center;
  width: 52px;
  height: 52px;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border: 1px solid #ffffff24;
    border-radius: 50%;
  }

  img {
    display: block;
    width: 40px;
    height: 40px;
    animation: ${turn} 1.8s ease-in-out infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    img { animation: none; }
  }
`;

export type HatPreviewStatus = 'loading' | 'ready' | 'unavailable';
const modelLoadTimeoutMs = 15_000;

export default function HatPreview({
  name,
  active,
  onStatusChange,
}: {
  name: string;
  active: boolean;
  onStatusChange?: (status: HatPreviewStatus) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewerRef = useRef<Awaited<ReturnType<typeof createHatViewer>> | null>(
    null
  );
  const [status, setStatus] = useState<HatPreviewStatus>('loading');
  const [attempt, setAttempt] = useState(0);
  const wasActive = useRef(active);
  const ready = status === 'ready';
  const [announcement, setAnnouncement] = useState('');
  const instructions = useId();

  useEffect(() => {
    onStatusChange?.(status);
  }, [onStatusChange, status]);

  // Mount an empty live region before filling it, and retain it after loading.
  useEffect(() => {
    setAnnouncement(
      `${name}: ${
        status === 'loading'
          ? 'loading preview.'
          : ready
            ? '3D preview ready.'
            : '3D preview unavailable.'
      }`
    );
  }, [name, status, ready]);

  useEffect(() => {
    const entering = active && !wasActive.current;
    wasActive.current = active;
    // A failed background attempt must not poison every subsequent visit.
    // Retry once on entry, never in a loop on devices without WebGL support.
    if (entering && status === 'unavailable') {
      setStatus('loading');
      setAttempt(current => current + 1);
    }
  }, [active, status]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const controller = new AbortController();
    let timeout: number | undefined;
    let remainingTimeout = modelLoadTimeoutMs;
    let timeoutStartedAt = performance.now();
    let settled = false;
    const updateStatus = (nextStatus: HatPreviewStatus) => {
      if (nextStatus !== 'loading' && timeout !== undefined) {
        window.clearTimeout(timeout);
        timeout = undefined;
      }
      if (nextStatus !== 'loading') settled = true;
      setStatus(nextStatus);
    };
    setStatus('loading');
    const dispose = () => {
      viewerRef.current?.dispose();
      viewerRef.current = null;
    };
    const contextLost = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      dispose();
      updateStatus('unavailable');
    };
    canvas.addEventListener('webglcontextlost', contextLost);
    const loadArtwork = (path: string) =>
      fetch(path, {signal: controller.signal}).then(response => {
        if (!response.ok) throw new Error('Could not load the hat artwork.');
        return response.text();
      });
    const timeoutPreview = () => {
      if (controller.signal.aborted || settled) return;
      console.warn('3D hat preview timed out while building the model.');
      controller.abort();
      dispose();
      updateStatus('unavailable');
    };
    const startTimeout = () => {
      if (controller.signal.aborted || settled || document.hidden) return;
      if (timeout !== undefined) window.clearTimeout(timeout);
      timeoutStartedAt = performance.now();
      timeout = window.setTimeout(timeoutPreview, remainingTimeout);
    };
    const visibilityChange = () => {
      if (document.hidden) {
        if (timeout !== undefined) {
          remainingTimeout -= performance.now() - timeoutStartedAt;
          window.clearTimeout(timeout);
          timeout = undefined;
        }
      } else if (!controller.signal.aborted) {
        startTimeout();
      }
    };
    document.addEventListener('visibilitychange', visibilityChange);
    if (!document.hidden) startTimeout();
    void Promise.all([
      import('./hatViewer'),
      loadArtwork('/static/image/store/5950.svg'),
      loadArtwork('/static/image/store/new-era-flag.svg'),
      loadArtwork('/static/image/store/mlb-batterman.svg'),
    ])
      .then(async ([{createHatViewer}, front, side, rear]) => {
        if (controller.signal.aborted) return;
        const viewer = await createHatViewer(
          canvas,
          {front, side, rear},
          controller.signal
        );
        if (controller.signal.aborted) {
          viewer.dispose();
          return;
        }
        viewerRef.current = viewer;
        updateStatus('ready');
      })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn('Could not load the 3D hat preview:', error);
          updateStatus('unavailable');
          controller.abort();
          dispose();
        }
      });
    return () => {
      if (timeout !== undefined) window.clearTimeout(timeout);
      document.removeEventListener('visibilitychange', visibilityChange);
      canvas.removeEventListener('webglcontextlost', contextLost);
      controller.abort();
      dispose();
    };
  }, [attempt]);

  // Moving the already-built canvas into the Store may change its dimensions.
  // Paint at the final size before the browser reveals it, without rebuilding.
  useLayoutEffect(() => {
    if (active && ready) viewerRef.current?.resize();
  }, [active, ready]);

  return (
    <Preview>
      <Stage>
        {status === 'loading' && (
          <PreviewStatus data-hat-loading aria-hidden="true">
            <LoadingStar>
              <img src={whiteStar} alt="" draggable={false} />
            </LoadingStar>
          </PreviewStatus>
        )}
        {status === 'unavailable' && (
          <UnavailableMessage aria-hidden="true">
            3D preview unavailable
          </UnavailableMessage>
        )}
        <canvas
          key={attempt}
          ref={canvasRef}
          style={{visibility: ready ? 'visible' : 'hidden'}}
          tabIndex={ready ? 0 : -1}
          role="img"
          aria-label={`${name}, interactive 3D preview`}
          aria-describedby={ready ? instructions : undefined}
          aria-hidden={!ready}
          onKeyDown={event => {
            const step = Math.PI / 12;
            switch (event.key) {
              case 'ArrowLeft':
                viewerRef.current?.rotate(-step);
                break;
              case 'ArrowRight':
                viewerRef.current?.rotate(step);
                break;
              case 'ArrowUp':
                viewerRef.current?.rotate(0, -step);
                break;
              case 'ArrowDown':
                viewerRef.current?.rotate(0, step);
                break;
              case 'Home':
                viewerRef.current?.reset();
                break;
              default:
                return;
            }
            event.preventDefault();
          }}
        />
      </Stage>
      <Announcement
        data-hat-preview-status
        role={active ? 'status' : undefined}
      >
        {announcement}
      </Announcement>
      <span id={instructions} hidden>
        Drag or use arrow keys to rotate. Press Home to reset the view.
      </span>
    </Preview>
  );
}
