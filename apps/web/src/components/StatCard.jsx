import { Card, CardContent } from './ui';
import { cn } from '../lib/utils';

const colorVariants = {
  blue: 'bg-blue-50 text-blue-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  amber: 'bg-amber-50 text-amber-700',
  purple: 'bg-purple-50 text-purple-700',
};

export function StatCard({
  label,
  value,
  trend,
  icon: Icon,
  color = 'blue',
  className,
}) {
  const colorClass = colorVariants[color] || colorVariants.blue;
  const isTrending = trend && typeof trend === 'string';
  const isNegative = isTrending && trend.includes('-');

  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-6">
        <div className="flex items-start justify-between gap-4">
          {/* Icon */}
          {Icon && (
            <div className={cn('flex items-center justify-center w-12 h-12 rounded-lg', colorClass)}>
              <Icon size={20} className="flex-shrink-0" />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-secondary-600 uppercase tracking-wider">
              {label}
            </p>
            <p className="text-3xl font-bold text-foreground mt-1">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {trend && (
              <p className={cn(
                'text-xs font-semibold mt-1.5',
                isNegative ? 'text-red-600' : 'text-emerald-600'
              )}>
                {trend}
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default StatCard;
