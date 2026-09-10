import { useEffect, useRef, useState } from 'react';

/**
 * Fade-and-rise a section into view once, when it first becomes visible.
 *
 * IntersectionObserver rather than a scroll listener: the browser does the
 * work off the main thread, and the observer unhooks itself after firing so
 * nothing keeps running once the page has been read. The animation itself is
 * disabled by the prefers-reduced-motion rule in index.css.
 */
export default function Reveal({ children, delay = 0, className = '', as: Tag = 'div' }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // No observer (or an old browser): show the content rather than hide it.
    if (typeof IntersectionObserver === 'undefined') return setVisible(true);

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setVisible(true);
        io.disconnect();
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? 'is-visible' : ''} ${className}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </Tag>
  );
}
