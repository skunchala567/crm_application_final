import { useState, forwardRef, createContext, useContext } from 'react';
import { cn } from '../../lib/utils';

const TabsContext = createContext();

const useTabsContext = () => {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error('Tab components must be used within Tabs');
  }
  return context;
};

/**
 * Supports both modes:
 *   uncontrolled -> <Tabs defaultValue="a">
 *   controlled   -> <Tabs value={x} onValueChange={fn}>   (e.g. URL-driven)
 *
 * `value` and `onValueChange` are destructured out so they never land on the
 * DOM node as invalid attributes.
 */
const Tabs = ({ value: controlledValue, defaultValue, onValueChange, children, className, ...props }) => {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolledValue;

  const setValue = (nextValue) => {
    if (!isControlled) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  };

  return (
    <TabsContext.Provider value={{ value, setValue }}>
      <div className={cn('w-full', className)} {...props}>
        {children}
      </div>
    </TabsContext.Provider>
  );
};

const TabsList = forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-lg bg-secondary-100 p-1',
      className
    )}
    {...props}
  >
    {children}
  </div>
));
TabsList.displayName = 'TabsList';

const TabsTrigger = ({ value, children, className, ...props }) => {
  const { value: activeValue, setValue } = useTabsContext();
  const isActive = value === activeValue;

  return (
    <button
      onClick={() => setValue(value)}
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
        isActive
          ? 'bg-white text-foreground shadow-xs'
          : 'text-secondary-600 hover:text-foreground',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
};
TabsTrigger.displayName = 'TabsTrigger';

const TabsContent = ({ value, children, className, ...props }) => {
  const { value: activeValue } = useTabsContext();

  if (value !== activeValue) return null;

  return (
    <div className={cn('mt-2', className)} {...props}>
      {children}
    </div>
  );
};
TabsContent.displayName = 'TabsContent';

export { Tabs, TabsList, TabsTrigger, TabsContent };
