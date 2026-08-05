import { cn } from '../lib/utils';

export function Divider({ className, children, variant = 'line', ...props }) {
  if (variant === 'with-text') {
    return (
      <div className={cn('flex items-center gap-4 my-6', className)} {...props}>
        <div className="flex-1 h-px bg-border" />
        {children && <span className="text-sm text-secondary-600">{children}</span>}
        <div className="flex-1 h-px bg-border" />
      </div>
    );
  }

  return (
    <div
      className={cn('h-px bg-border my-6', className)}
      {...props}
    />
  );
}

export default Divider;
