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
 * dateCreated: only historical (past) - dateTo = today
 * dateStart: uses period (Week/Month/Year/Quarter)
 */
export function getDateRange(mode, periodType, customFrom, customTo) {
  const today = getToday();

  // Custom period - user selected dates
  if (periodType === 'custom' && customFrom && customTo) {
    return { dateFrom: customFrom, dateTo: customTo };
  }

  if (mode === 'date_created') {
    // Historical only - never include future dates
    const from = customFrom || addMonths(today, -12);
    let to = customTo || today;
    if (to > today) to = today;
    return { dateFrom: from, dateTo: to };
  }

  // date_start mode with presets
  const now = new Date();
  switch (periodType) {
    case 'week':
      return {
        dateFrom: addDays(now, -7),
        dateTo: addDays(now, 7)
      };
    case 'month':
      return {
        dateFrom: addDays(now, -30),
        dateTo: addDays(now, 30)
      };
    case 'year':
      return {
        dateFrom: addMonths(now, -12),
        dateTo: addMonths(now, 6)
      };
    case 'quarter':
      return {
        dateFrom: addMonths(now, -4),
        dateTo: addMonths(now, 4)
      };
    default:
      return {
        dateFrom: addDays(now, -7),
        dateTo: addDays(now, 7)
      };
  }
}
