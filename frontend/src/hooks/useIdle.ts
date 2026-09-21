import { useEffect, useState, useRef } from "react";

interface UseIdleOptions {
  timeout: number;
  onIdle?: () => void;
  onActive?: () => void;
}

/**
 * Hook to detect user inactivity.
 * @param options Configuration options.
 * @returns boolean true if idle, false otherwise.
 */
export const useIdle = ({
  timeout,
  onIdle,
  onActive,
}: UseIdleOptions): boolean => {
  const [isIdle, setIsIdle] = useState(false);

  // Use refs for callbacks to avoid re-binding effect on callback change
  const onIdleRef = useRef(onIdle);
  const onActiveRef = useRef(onActive);

  // Update refs to ensure callbacks are fresh without resetting the main timer effect
  useEffect(() => {
    onIdleRef.current = onIdle;
    onActiveRef.current = onActive;
  }, [onIdle, onActive]);

  // Main effect: Synchronization with external system (Window Events/Timers) - Compliant with Agents.md Exception
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout>;

    const handleActivity = () => {
      // If we were idle, trigger active callback
      setIsIdle((prevIsIdle) => {
        if (prevIsIdle && onActiveRef.current) {
          onActiveRef.current();
        }
        return false;
      });

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      timeoutId = setTimeout(() => {
        setIsIdle(true);
        if (onIdleRef.current) {
          onIdleRef.current();
        }
      }, timeout);
    };

    // Events to listen for
    const events = [
      "mousedown",
      "mousemove",
      "keydown",
      "scroll",
      "touchstart",
    ];

    // Initialize timer
    handleActivity();

    // Add event listeners
    events.forEach((event) => {
      window.addEventListener(event, handleActivity);
    });

    // Cleanup
    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
    };
  }, [timeout]);

  return isIdle;
};
