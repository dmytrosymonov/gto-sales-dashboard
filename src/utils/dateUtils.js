export function formatDate(d) {
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toISOString().split('T')[0];
}

export function addDays(date, days) {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

export function addMonths(date, months) {
  const d = typeof date === 'string' ? new Date(date) : new Date(date);
  d.setMonth(d.getMonth() + months);
  return formatDate(d);
}

export function getToday() {
  return formatDate(new Date());
}

export function getDateStart(dateStr) {
  const d = new Date(dateStr);
  return formatDate(d);
}

/**
 * Get date range based on mode and period type
 * Both modes use same period logic (last N days including today)
 */
export function getDateRange(mode, periodType, customFrom, customTo) {
  const today = getToday();

  // Custom period - user selected dates
  if (periodType === 'custom' && customFrom && customTo) {
    return { dateFrom: customFrom, dateTo: customTo };
  }

  // Both modes use same presets (last N days including today)
  switch (periodType) {
    case 'week':
      return {
        dateFrom: addDays(today, -6),
        dateTo: today
      };
    case 'month':
      return {
        dateFrom: addDays(today, -29),
        dateTo: today
      };
    case 'year':
      return {
        dateFrom: addDays(today, -364),
        dateTo: today
      };
    default:
      return {
        dateFrom: addDays(today, -6),
        dateTo: today
      };
  }
}
