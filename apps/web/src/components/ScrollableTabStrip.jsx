import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Keeps a tab row on one line: the tabs scroll sideways and arrows appear at
 * either end, but only once they are actually needed. Same behaviour as the
 * Leads stage tabs, wrapped so any tab bar can use it.
 *
 * The strip keeps whatever class the tab bar already had, so its own styling
 * carries over untouched -- this only adds the scrolling frame around it.
 *
 * `as` lets a caller keep the original element (Business Units used a <nav>).
 */
export default function ScrollableTabStrip({
  className = '',
  shellClassName = '',
  label = 'tabs',
  as: Element = 'div',
  children,
  ...props
}) {
  const stripRef = useRef(null);
  const [scroll, setScroll] = useState({ left: false, right: false, overflow: false });

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return undefined;
    const update = () => {
      const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
      setScroll({
        overflow: max > 2,
        left: strip.scrollLeft > 2,
        right: strip.scrollLeft < max - 2,
      });
    };
    update();
    strip.addEventListener('scroll', update, { passive: true });
    // Watch the children too: tabs carry counts that change width as data loads.
    const observer = new ResizeObserver(update);
    observer.observe(strip);
    Array.from(strip.children).forEach(child => observer.observe(child));
    return () => {
      strip.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [children]);

  const move = direction => {
    const strip = stripRef.current;
    if (!strip) return;
    strip.scrollBy({
      left: direction * Math.max(220, strip.clientWidth * 0.55),
      behavior: 'smooth',
    });
  };

  return (
    <div className={`tab-scroll-shell ${shellClassName} ${scroll.overflow ? 'has-overflow' : ''}`}>
      <button
        type="button"
        className="tab-scroll-button previous"
        aria-label={`Show previous ${label}`}
        disabled={!scroll.left}
        onClick={() => move(-1)}
      >
        <ChevronLeft size={15} />
      </button>
      <Element ref={stripRef} className={`tab-scroll-strip ${className}`} {...props}>
        {children}
      </Element>
      <button
        type="button"
        className="tab-scroll-button next"
        aria-label={`Show more ${label}`}
        disabled={!scroll.right}
        onClick={() => move(1)}
      >
        <ChevronRight size={15} />
      </button>
    </div>
  );
}
