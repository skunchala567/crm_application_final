import { cn } from '../lib/utils';

export function PageContainer({
  children,
  className,
  variant = 'default',
  ...props
}) {
  const variantClasses = {
    default: 'px-6 md:px-8 py-8 md:py-10',
    compact: 'px-6 md:px-8 py-6 md:py-8',
    full: '',
  };

  return (
    <div
      className={cn(
        'w-full max-w-7xl mx-auto',
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export default PageContainer;
