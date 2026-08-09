import { cn } from '../lib/utils';

export function PageContainer({
  children,
  className,
  variant = 'default',
  ...props
}) {
  // The area between the sidebar and the viewport edge IS the workspace, so
  // this container spans it. Horizontal padding scales with the viewport
  // instead of the container being centred inside a fixed max-width.
  const variantClasses = {
    default: 'px-5 md:px-7 xl:px-9 py-7 md:py-9',
    compact: 'px-5 md:px-7 xl:px-9 py-5 md:py-7',
    full: '',
    // Opt-in for reading-width content: long-form copy, narrow forms.
    narrow: 'px-5 md:px-7 py-7 md:py-9 max-w-3xl',
  };

  return (
    <div
      className={cn(
        'w-full',
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
