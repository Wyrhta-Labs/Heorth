/** Parse an ISO 8601 duration like P1W / P3M / P1Y / PT1H and add it to a date. */
export function addDuration(date: Date, duration: string): Date {
  const result = new Date(date);
  const weekMatch = duration.match(/^P(\d+)W$/);
  if (weekMatch) {
    result.setDate(result.getDate() + Number(weekMatch[1]) * 7);
    return result;
  }
  const match = duration.match(
    /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/,
  );
  if (!match) throw new Error(`Invalid ISO 8601 duration: ${duration}`);
  const [, years, months, days, hours, minutes, seconds] = match.map((v) => (v ? Number(v) : 0));
  if (years) result.setFullYear(result.getFullYear() + years);
  if (months) result.setMonth(result.getMonth() + months);
  if (days) result.setDate(result.getDate() + days);
  if (hours) result.setHours(result.getHours() + hours);
  if (minutes) result.setMinutes(result.getMinutes() + minutes);
  if (seconds) result.setSeconds(result.getSeconds() + seconds);
  return result;
}
