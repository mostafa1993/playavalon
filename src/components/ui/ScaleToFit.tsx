'use client';

/**
 * ScaleToFit — scales children to fit the container height without scrolling
 */

import { useRef, useState, useEffect, type ReactNode } from 'react';

interface ScaleToFitProps {
  children: ReactNode;
  className?: string;
}

export function ScaleToFit({ children, className }: ScaleToFitProps) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const scaleRef = useRef(1);

  useEffect(() => {
    const update = () => {
      const outer = outerRef.current;
      const inner = innerRef.current;
      if (!outer || !inner) return;

      const availableHeight = outer.clientHeight;
      const currentScale = scaleRef.current;
      const scaledHeight = inner.getBoundingClientRect().height;
      const naturalHeight = scaledHeight / currentScale;

      if (naturalHeight > availableHeight && naturalHeight > 0) {
        const newScale = Math.max(0.4, availableHeight / naturalHeight);
        scaleRef.current = newScale;
        setScale(newScale);
      } else if (naturalHeight < availableHeight * 0.95) {
        const newScale = Math.min(1, availableHeight / naturalHeight);
        scaleRef.current = newScale;
        setScale(newScale);
      }
    };

    const timer = setTimeout(update, 100);
    const observer = new ResizeObserver(() => setTimeout(update, 50));
    // Observe both container and content — content may change size on phase transitions
    if (outerRef.current) observer.observe(outerRef.current);
    if (innerRef.current) observer.observe(innerRef.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [children]);

  return (
    <div ref={outerRef} className={`overflow-hidden ${className || ''}`}>
      <div
        ref={innerRef}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          width: `${100 / scale}%`,
        }}
      >
        {children}
      </div>
    </div>
  );
}
