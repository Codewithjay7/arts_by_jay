import { useEffect, useRef, useState } from 'react';

/**
 * Tracks the OS "reduce motion" preference and keeps tracking it, so a visitor
 * who changes the setting does not have to reload. Every animated surface in
 * the app — including the 3D gallery — reads this.
 */
export const useReducedMotion = () => {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (event) => setReduced(event.matches);

    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
};

export const useMediaQuery = (query) => {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (!window.matchMedia) return undefined;

    const list = window.matchMedia(query);
    const onChange = (event) => setMatches(event.matches);
    setMatches(list.matches);

    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
};

export const useIsMobile = () => useMediaQuery('(max-width: 767px)');

/**
 * Reports whether the device can reasonably run the full 3D gallery. A phone
 * with few cores and no pointer gets the lighter scene rather than a slideshow.
 */
export const useDeviceTier = () => {
  const isMobile = useIsMobile();
  const coarsePointer = useMediaQuery('(pointer: coarse)');

  const [tier, setTier] = useState('high');

  useEffect(() => {
    const cores = navigator.hardwareConcurrency ?? 4;
    const memory = navigator.deviceMemory ?? 4;

    if (isMobile || coarsePointer || cores <= 4 || memory <= 2) setTier('low');
    else if (cores <= 8) setTier('medium');
    else setTier('high');
  }, [isMobile, coarsePointer]);

  return tier;
};

export const useDebouncedValue = (value, delay = 300) => {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
};

/**
 * Reveal-on-scroll. Uses IntersectionObserver rather than a scroll listener so
 * nothing runs on every frame, and resolves immediately when motion is reduced.
 */
export const useInView = ({ threshold = 0.15, once = true, rootMargin = '0px 0px -8% 0px' } = {}) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.disconnect();
        } else if (!once) {
          setInView(false);
        }
      },
      { threshold, rootMargin },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold, once, rootMargin]);

  return [ref, inView];
};

/** A per-tab value, used for the checkout idempotency key. */
export const useSessionValue = (key, factory) => {
  const [value] = useState(() => {
    try {
      const existing = sessionStorage.getItem(key);
      if (existing) return existing;
      const created = factory();
      sessionStorage.setItem(key, created);
      return created;
    } catch {
      // Private browsing, or storage blocked. A fresh value still works.
      return factory();
    }
  });

  const clear = () => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* nothing to clean up */
    }
  };

  return [value, clear];
};

export const useDocumentTitle = (title) => {
  useEffect(() => {
    if (!title) return undefined;

    const previous = document.title;
    document.title = `${title} · Arts by Jay`;
    return () => {
      document.title = previous;
    };
  }, [title]);
};
