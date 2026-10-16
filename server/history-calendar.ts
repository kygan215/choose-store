/** Calendar facts for a completed activity. Dates are inclusive, in China local calendar days. */

type LeavePeriod = { year: number; name: string; start: string; end: string };

// State Council annual notices. Add a year only after its official notice is published.
// 2023 https://app.www.gov.cn/govdata/gov/202212/08/495070/article.html
// 2024 https://www.gov.cn/zhengce/content/202310/content_6911527.htm
// 2025 https://www.forestry.gov.cn/c/www/szxx/594663.jhtml
// 2026 https://zwfw.gansu.gov.cn/wenxian/zczx/zwdt/art/2025/art_f430743a887f45109bc8850775c1d89e.html
const OFFICIAL_LEAVE: readonly LeavePeriod[] = [
  { year: 2023, name: "元旦", start: "2022-12-31", end: "2023-01-02" },
  { year: 2023, name: "春节", start: "2023-01-21", end: "2023-01-27" },
  { year: 2023, name: "清明节", start: "2023-04-05", end: "2023-04-05" },
  { year: 2023, name: "劳动节", start: "2023-04-29", end: "2023-05-03" },
  { year: 2023, name: "端午节", start: "2023-06-22", end: "2023-06-24" },
  { year: 2023, name: "中秋节", start: "2023-09-29", end: "2023-10-06" },
  { year: 2023, name: "国庆节", start: "2023-09-29", end: "2023-10-06" },
  { year: 2024, name: "元旦", start: "2023-12-30", end: "2024-01-01" },
  { year: 2024, name: "春节", start: "2024-02-10", end: "2024-02-17" },
  { year: 2024, name: "清明节", start: "2024-04-04", end: "2024-04-06" },
  { year: 2024, name: "劳动节", start: "2024-05-01", end: "2024-05-05" },
  { year: 2024, name: "端午节", start: "2024-06-08", end: "2024-06-10" },
  { year: 2024, name: "中秋节", start: "2024-09-15", end: "2024-09-17" },
  { year: 2024, name: "国庆节", start: "2024-10-01", end: "2024-10-07" },
  { year: 2025, name: "元旦", start: "2025-01-01", end: "2025-01-01" },
  { year: 2025, name: "春节", start: "2025-01-28", end: "2025-02-04" },
  { year: 2025, name: "清明节", start: "2025-04-04", end: "2025-04-06" },
  { year: 2025, name: "劳动节", start: "2025-05-01", end: "2025-05-05" },
  { year: 2025, name: "端午节", start: "2025-05-31", end: "2025-06-02" },
  { year: 2025, name: "中秋节", start: "2025-10-01", end: "2025-10-08" },
  { year: 2025, name: "国庆节", start: "2025-10-01", end: "2025-10-08" },
  { year: 2026, name: "元旦", start: "2026-01-01", end: "2026-01-03" },
  { year: 2026, name: "春节", start: "2026-02-15", end: "2026-02-23" },
  { year: 2026, name: "清明节", start: "2026-04-04", end: "2026-04-06" },
  { year: 2026, name: "劳动节", start: "2026-05-01", end: "2026-05-05" },
  { year: 2026, name: "端午节", start: "2026-06-19", end: "2026-06-21" },
  { year: 2026, name: "中秋节", start: "2026-09-25", end: "2026-09-27" },
  { year: 2026, name: "国庆节", start: "2026-10-01", end: "2026-10-07" },
];

const DAY = 86_400_000;
const chineseCalendar = new Intl.DateTimeFormat("zh-CN-u-ca-chinese", {
  month: "long",
  day: "numeric",
  timeZone: "Asia/Shanghai",
});
const LUNAR_FESTIVALS = new Map([
  ["正月-1", "春节"],
  ["正月-15", "元宵节"],
  ["五月-5", "端午节"],
  ["七月-7", "七夕节"],
  ["八月-15", "中秋节"],
  ["九月-9", "重阳节"],
]);

function dateNumber(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("活动日期无效");
  const number = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(number) || new Date(number).toISOString().slice(0, 10) !== value) {
    throw new Error("活动日期无效");
  }
  return number;
}

/**
 * Tag an activity if it includes any weekend, an official leave period, or the
 * day of a traditional festival. Leave and festival tags are separate facts:
 * a nearby leave day does not imply that the activity itself was named for it.
 */
export function calendarTags(start: string, end: string): string[] {
  const first = dateNumber(start);
  const last = dateNumber(end);
  if (last < first || last - first > 3660 * DAY) throw new Error("活动日期范围无效或跨度超过十年");

  const tags = new Set<string>();
  for (const leave of OFFICIAL_LEAVE) {
    if (start <= leave.end && end >= leave.start) {
      tags.add(`含${leave.year}年${leave.name}假期`);
    }
  }

  for (let time = first; time <= last; time += DAY) {
    const date = new Date(time);
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) tags.add("含周末");
    const lunar = chineseCalendar.formatToParts(date);
    const month = lunar.find((part) => part.type === "month")?.value;
    const day = lunar.find((part) => part.type === "day")?.value;
    const festival = LUNAR_FESTIVALS.get(`${month}-${day}`);
    if (festival) tags.add(`含${date.getUTCFullYear()}年${festival}`);
  }

  return [...tags];
}
