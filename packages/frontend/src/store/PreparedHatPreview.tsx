import React, {
  createContext,
  type ReactNode,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {createPortal} from 'react-dom';
import {features} from '../featureFlags';
import HatPreview, {type HatPreviewStatus} from './HatPreview';

const PreparationContext = createContext(false);

export function useHatPreviewPreparing() {
  return useContext(PreparationContext);
}

const PreviewContext = createContext<{
  container: HTMLDivElement;
  parking: React.RefObject<HTMLDivElement | null>;
  setPresentation: (value: {name: string; active: boolean}) => void;
} | null>(null);

function PreparedPreview({children}: {children: ReactNode}) {
  const [container] = useState(() => document.createElement('div'));
  const [status, setStatus] = useState<HatPreviewStatus>('loading');
  const parking = useRef<HTMLDivElement>(null);
  const [presentation, setPresentation] = useState({
    name: 'Hat',
    active: false,
  });
  const preview = useMemo(
    () => ({container, parking, setPresentation}),
    [container]
  );

  useLayoutEffect(() => {
    // A direct Store visit may already have attached the canvas to its slot.
    if (!container.parentNode) parking.current?.appendChild(container);
    return () => container.remove();
  }, [container]);

  return (
    <PreviewContext.Provider value={preview}>
      {/* Keep a measurable canvas so model construction, texture upload and
          the first GPU render all finish before navigation. Clipping and
          inert keep the parked preview out of view and keyboard navigation. */}
      <div
        ref={parking}
        aria-hidden="true"
        inert
        style={{
          height: 0,
          overflow: 'hidden',
          opacity: 0,
          pointerEvents: 'none',
        }}
      />
      {createPortal(
        <HatPreview {...presentation} onStatusChange={setStatus} />,
        container
      )}
      <PreparationContext.Provider value={status === 'loading'}>
        {children}
      </PreparationContext.Provider>
    </PreviewContext.Provider>
  );
}

export function HatPreviewProvider({children}: {children: ReactNode}) {
  return features.store ? (
    <PreparedPreview>{children}</PreparedPreview>
  ) : (
    children
  );
}

export default function PreparedHatPreview({name}: {name: string}) {
  const preview = useContext(PreviewContext);
  const slot = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!preview) return;
    slot.current?.appendChild(preview.container);
    preview.setPresentation({name, active: true});
    return () => {
      preview.parking.current?.appendChild(preview.container);
      preview.setPresentation({name, active: false});
    };
  }, [preview, name]);

  return <div ref={slot} style={{width: 'min(100%, 640px)'}} />;
}
