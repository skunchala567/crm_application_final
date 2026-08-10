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
    // `ui-tabs`/`ui-tab` opt these into the shared pill tab styling in
    // design-system.css, so every tab bar in the app looks the same.
    className={cn('ui-tabs inline-flex items-center gap-1.5', className)}
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
      data-state={isActive ? 'active' : 'inactive'}
      className={cn(
        'ui-tab justify-center ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
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
