import clsx from 'clsx';
import { useInView, useReducedMotion } from '../../lib/hooks';

/**
 * Scroll-triggered reveal.
 *
 * Implemented with a CSS transition driven by an IntersectionObserver rather
 * than a per-frame scroll handler, so a long page of artwork cards costs
 * nothing while scrolling. When motion is reduced the content is simply
 * present from the start.
 */
export const Reveal = ({
  as: Component = 'div',
  delay = 0,
  distance = 20,
  direction = 'up',
  className,
  children,
  ...props
}) => {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView();

  if (reduced) {
    return (
      <Component className={className} {...props}>
        {children}
      </Component>
    );
  }

  const offsets = {
    up: `translate3d(0, ${distance}px, 0)`,
    down: `translate3d(0, -${distance}px, 0)`,
    left: `translate3d(${distance}px, 0, 0)`,
    right: `translate3d(-${distance}px, 0, 0)`,
  };

  return (
    <Component
      ref={ref}
      className={clsx('will-change-[opacity,transform]', className)}
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translate3d(0, 0, 0)' : offsets[direction],
        transition: `opacity 700ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform 700ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
      }}
      {...props}
    >
      {children}
    </Component>
  );
};

/** Staggers its children, so a grid resolves row by row rather than at once. */
export const RevealGroup = ({ children, step = 70, className, ...props }) => (
  <div className={className} {...props}>
    {Array.isArray(children)
      ? children.map((child, index) => (
          <Reveal key={child?.key ?? index} delay={index * step}>
            {child}
          </Reveal>
        ))
      : children}
  </div>
);

/**
 * A soft parallax drift for decorative imagery. Driven by the observer plus a
 * passive scroll listener that only runs while the element is on screen.
 */
export const Parallax = ({ children, strength = 0.12, className }) => {
  const reduced = useReducedMotion();
  const [ref, inView] = useInView({ once: false, threshold: 0 });

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      className={className}
      style={{
        // A cheap, GPU-friendly approximation: translate by a fraction of the
        // element's own offset from the viewport centre, recomputed by CSS.
        transform: inView ? undefined : 'none',
        willChange: inView ? 'transform' : 'auto',
        '--parallax-strength': strength,
      }}
    >
      {children}
    </div>
  );
};
