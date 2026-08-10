import { Card, CardContent } from './ui';
import { cn } from '../lib/utils';

const colorVariants = {
  blue: 'bg-blue-50 text-blue-600',
  emerald: 'bg-primary-50 text-primary-700',
  amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-violet-50 text-violet-600',
};

export function StatCard({
  label,
  value,
  trend,
  icon: Icon,
  color = 'blue',
  compact = false,
  className,
}) {
  const colorClass = colorVariants[color] || colorVariants.blue;
  const isTrending = trend && typeof trend === 'string';
  const isNegative = isTrending && trend.includes('-');

  return (
    <Card
      className={cn(
        'group relative overflow-hidden cursor-default',
        'transition-[transform,box-shadow,border-color] duration-300 ease-[cubic-bezier(.16,1,.3,1)]',
        'hover:-translate-y-1 hover:shadow-md hover:border-primary-200',
        // Brand underline that wipes in on hover, as in the reference.
        'after:absolute after:inset-x-0 after:bottom-0 after:h-[3px] after:origin-left after:scale-x-0',
        'after:bg-gradient-to-r after:from-primary-400 after:to-primary-600',
        'after:transition-transform after:duration-[350ms] after:ease-[cubic-bezier(.16,1,.3,1)] hover:after:scale-x-100',
        className
      )}
    >
      <CardContent className={compact ? 'h-full p-5' : 'p-6'}>
        {compact ? (
          <div className="flex h-full w-full flex-col items-start gap-3 text-left">
            <div className="flex items-center gap-3">
              {Icon && (
                <div
                  className={cn(
                    'flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl',
                    'transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-110 group-hover:-rotate-[4deg]',
                    colorClass
                  )}
                >
                  <Icon size={20} className="flex-shrink-0" />
                </div>
              )}
              <p className="m-0 text-3xl font-extrabold text-foreground font-display tracking-tight tabular-nums">
                {typeof value === 'number' ? value.toLocaleString() : value}
              </p>
            </div>
            <p className="m-0 min-h-4 text-[11px] font-semibold leading-4 text-secondary-500 uppercase tracking-wider">
              {label}
            </p>
            {trend && (
              <p className={cn(
                'm-0 inline-flex max-w-full items-center rounded-full px-2 py-[3px] text-[10px] font-bold leading-4 whitespace-normal',
                isNegative ? 'bg-danger-bg text-danger' : 'bg-primary-50 text-primary-700'
              )}>
                {trend}
              </p>
            )}
          </div>
        ) : (
        <div className="flex w-full items-start justify-between gap-4">
          {/* Icon */}
          {Icon && (
            <div
              className={cn(
                'flex h-12 w-12 items-center justify-center rounded-xl flex-shrink-0',
                'transition-transform duration-300 ease-[cubic-bezier(.16,1,.3,1)] group-hover:scale-110 group-hover:-rotate-[4deg]',
                colorClass
              )}
            >
              <Icon size={20} className="flex-shrink-0" />
            </div>
          )}

          {/* Content */}
          <div className="w-full flex-1 min-w-0 text-left">
            <p className={cn(
              'font-semibold text-secondary-500 uppercase tracking-wider',
              'text-xs'
            )}>
              {label}
            </p>
            <p className="text-3xl font-extrabold text-foreground font-display tracking-tight mt-1 tabular-nums">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {trend && (
              <p className={cn(
                'inline-flex items-center gap-1 font-bold mt-2 px-2 py-[3px] rounded-full',
                'text-[11px]',
                isNegative ? 'bg-danger-bg text-danger' : 'bg-primary-50 text-primary-700'
              )}>
                {trend}
              </p>
            )}
          </div>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

export default StatCard;
