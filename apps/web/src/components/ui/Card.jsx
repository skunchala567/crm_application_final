import { forwardRef } from 'react';
import { cn } from '../../lib/utils';

/*
 * Padding, and the one knob a screen can turn.
 *
 * Card padding is 24px everywhere, which reads well on a page of two or three
 * cards and is far too generous on a dashboard of a dozen. Rather than every
 * dashboard widget passing its own padding class, the value comes from
 * --card-pad, which a container sets once for everything inside it. Unset, it
 * is the 24px these cards have always had, so nothing else on the app moves.
 */
const CARD_PAD = 'p-[var(--card-pad,1.5rem)]';
const CARD_TITLE = 'text-[length:var(--card-title,1.5rem)]';
const CARD_DESC = 'text-[length:var(--card-desc,0.875rem)]';

const Card = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'rounded-xl border border-border bg-card shadow-xs',
      className
    )}
    {...props}
  />
));
Card.displayName = 'Card';

const CardHeader = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex flex-col space-y-1.5 border-b border-border', CARD_PAD, className)}
    {...props}
  />
));
CardHeader.displayName = 'CardHeader';

const CardTitle = forwardRef(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn(
      'font-bold leading-none tracking-tight text-foreground', CARD_TITLE,
      className
    )}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

const CardDescription = forwardRef(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn('text-muted', CARD_DESC, className)}
    {...props}
  />
));
CardDescription.displayName = 'CardDescription';

const CardContent = forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn(CARD_PAD, 'pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

const CardFooter = forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('flex items-center border-t border-border pt-0', CARD_PAD, className)}
    {...props}
  />
));
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
