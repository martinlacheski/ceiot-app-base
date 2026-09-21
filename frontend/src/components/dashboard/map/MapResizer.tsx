import { useMap } from "react-leaflet";
import { useCallback, useRef } from "react";

// Component to handle map resizing
export function MapResizer() {
  const map = useMap();
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback(
    (node: HTMLDivElement | null) => {
      if (node) {
        // Mount: Create and attach observer
        observerRef.current = new ResizeObserver(() => {
          map.invalidateSize();
        });
        observerRef.current.observe(map.getContainer());
      } else {
        // Unmount: Cleanup
        if (observerRef.current) {
          observerRef.current.disconnect();
          observerRef.current = null;
        }
      }
    },
    [map]
  );

  // Render a hidden element to serve as the lifecycle hook via its ref
  return <div ref={ref} className="hidden" aria-hidden="true" />;
}
