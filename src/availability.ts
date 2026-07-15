const GRAPHQL_URL = "https://m.booking.naver.com/graphql";
const BUSINESS_ID = "193155";
const BUSINESS_TYPE_ID = 10;
const BOOKING_URL = "https://m.booking.naver.com/booking/10/bizes/193155";
const GARAGE_BAY_COUNT = 5;
const SEOUL_TZ = "Asia/Seoul";
const BUSINESS_DAY_START_HOUR = 6;

const BUSINESS_HOURS = [
  ...Array.from({ length: 24 - BUSINESS_DAY_START_HOUR }, (_, index) => ({
    hour: BUSINESS_DAY_START_HOUR + index,
    nextDay: false,
  })),
  ...Array.from({ length: BUSINESS_DAY_START_HOUR }, (_, index) => ({
    hour: index,
    nextDay: true,
  })),
];

const SEARCH_BIZ_ITEMS = `
query searchBizItem($bizItemSearchParams: BizItemSearchParams) {
  searchBizItem(input: $bizItemSearchParams) {
    bizItems { bizItemId name }
  }
}
`;

const HOURLY_QUERY = `
query hourlySchedule($scheduleParams: ScheduleParams) {
  schedule(input: $scheduleParams) {
    bizItemSchedule {
      hourly {
        unitStartDateTime
        unitStartTime
        unitStock
        unitBookingCount
        occupiedBookingCount
        isSaleDay
        isUnitSaleDay
        isBusinessDay
        isUnitBusinessDay
      }
    }
  }
}
`;

type SlotStatus = "available" | "booked" | "closed";

interface BizItem {
  bizItemId: string;
  name: string;
}

interface HourlySlot {
  unitStartDateTime: string;
  unitStartTime?: string;
  unitStock?: number | null;
  unitBookingCount?: number | null;
  occupiedBookingCount?: number | null;
  isSaleDay?: boolean;
  isUnitSaleDay?: boolean;
  isBusinessDay?: boolean;
  isUnitBusinessDay?: boolean;
}

interface MatrixSlot {
  hour: number;
  nextDay: boolean;
  status: SlotStatus;
  bookingUrl?: string;
}

interface MatrixRow {
  bizItemId: string;
  name: string;
  hours: MatrixSlot[];
}

async function graphql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://m.booking.naver.com",
      referer: BOOKING_URL,
      "user-agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 500)}`);
  }

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((err) => err.message).join("; "));
  }

  if (!payload.data) {
    throw new Error("Empty GraphQL response");
  }

  return payload.data;
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: SEOUL_TZ });
}

function weekdayLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function addDays(dateStr: string, offset: number): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return date.toISOString().slice(0, 10);
}

function seoulDateHour(iso: string): { date: string; hour: number } {
  const date = new Date(iso);
  return {
    date: date.toLocaleDateString("en-CA", { timeZone: SEOUL_TZ }),
    hour: Number(
      date.toLocaleString("en-US", {
        timeZone: SEOUL_TZ,
        hour: "numeric",
        hour12: false,
      }),
    ),
  };
}

async function fetchBizItems(): Promise<BizItem[]> {
  const data = await graphql<{
    searchBizItem: { bizItems: BizItem[] };
  }>(SEARCH_BIZ_ITEMS, {
    bizItemSearchParams: { businessId: BUSINESS_ID, lang: "ko" },
  });
  return data.searchBizItem.bizItems;
}

function garageBizItems(bizItems: BizItem[]): BizItem[] {
  return bizItems
    .filter((item) => item.name.includes("번 게러지"))
    .sort((a, b) => a.name.localeCompare(b.name, "ko"))
    .slice(0, GARAGE_BAY_COUNT);
}

async function fetchHourlySlots(bizItemId: string, day: string): Promise<HourlySlot[]> {
  const dayStart = `${day}T00:00:00`;
  const data = await graphql<{
    schedule: { bizItemSchedule: { hourly: HourlySlot[] | null } };
  }>(HOURLY_QUERY, {
    scheduleParams: {
      businessId: BUSINESS_ID,
      businessTypeId: BUSINESS_TYPE_ID,
      bizItemId,
      startDateTime: dayStart,
      endDateTime: dayStart,
    },
  });
  return data.schedule.bizItemSchedule.hourly ?? [];
}

function buildBookingUrl(bizItemId: string, unitStartTime: string): string {
  const startDateTime = unitStartTime.trim().replace(" ", "T");
  const base = `https://m.booking.naver.com/booking/${BUSINESS_TYPE_ID}/bizes/${BUSINESS_ID}/items/${bizItemId}`;
  return `${base}?startDateTime=${encodeURIComponent(startDateTime)}`;
}

function buildBookingUrlFromSlot(
  bizItemId: string,
  targetDate: string,
  hour: number,
  nextDay: boolean,
): string {
  const date = nextDay ? addDays(targetDate, 1) : targetDate;
  const startDateTime = `${date}T${String(hour).padStart(2, "0")}:00:00`;
  return buildBookingUrl(bizItemId, startDateTime);
}

function slotStatus(slot: HourlySlot): SlotStatus {
  const unitStock = slot.unitStock ?? 0;
  const unitBooked = slot.unitBookingCount ?? 0;
  const occupied = slot.occupiedBookingCount ?? 0;
  const isSale = slot.isUnitSaleDay ?? slot.isSaleDay ?? false;
  const isBusiness = slot.isUnitBusinessDay ?? slot.isBusinessDay ?? false;

  if (!isSale || !isBusiness || unitStock <= 0) {
    return "closed";
  }
  if (unitBooked + occupied >= unitStock) {
    return "booked";
  }
  return "available";
}

interface HourSlotInfo {
  status: SlotStatus;
  unitStartTime?: string;
}

function hourlySlotsByHour(slots: HourlySlot[], day: string): Record<number, HourSlotInfo> {
  const byHour: Record<number, HourSlotInfo> = Object.fromEntries(
    Array.from({ length: 24 }, (_, hour) => [hour, { status: "closed" as SlotStatus }]),
  ) as Record<number, HourSlotInfo>;

  for (const slot of slots) {
    const { date, hour } = seoulDateHour(slot.unitStartDateTime);
    if (date !== day) {
      continue;
    }
    byHour[hour] = {
      status: slotStatus(slot),
      unitStartTime: slot.unitStartTime,
    };
  }

  return byHour;
}

async function fetchDayMatrix(targetDate: string, bizItems?: BizItem[]) {
  const bays = garageBizItems(bizItems ?? (await fetchBizItems()));
  const nextDate = addDays(targetDate, 1);
  const rows: MatrixRow[] = await Promise.all(
    bays.map(async (item) => {
      const [slotsToday, slotsTomorrow] = await Promise.all([
        fetchHourlySlots(item.bizItemId, targetDate),
        fetchHourlySlots(item.bizItemId, nextDate),
      ]);
      const byToday = hourlySlotsByHour(slotsToday, targetDate);
      const byTomorrow = hourlySlotsByHour(slotsTomorrow, nextDate);

      return {
        bizItemId: item.bizItemId,
        name: item.name.replace(" 게러지", ""),
        hours: BUSINESS_HOURS.map((slot) => {
          const info = slot.nextDay ? byTomorrow[slot.hour] : byToday[slot.hour];
          const matrixSlot: MatrixSlot = {
            hour: slot.hour,
            nextDay: slot.nextDay,
            status: info.status,
          };
          if (info.status === "available") {
            matrixSlot.bookingUrl = info.unitStartTime
              ? buildBookingUrl(item.bizItemId, info.unitStartTime)
              : buildBookingUrlFromSlot(
                  item.bizItemId,
                  targetDate,
                  slot.hour,
                  slot.nextDay,
                );
          }
          return matrixSlot;
        }),
      };
    }),
  );

  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return {
    date: targetDate,
    nextDate,
    weekday: weekdayLabel(targetDate),
    hours: BUSINESS_HOURS,
    rows,
  };
}

export async function fetchAvailability(start: string) {
  const bizItems = await fetchBizItems();
  return {
    businessId: BUSINESS_ID,
    businessName: "카바스 실내셀프세차장",
    bookingUrl: BOOKING_URL,
    view: "matrix",
    matrix: await fetchDayMatrix(start, bizItems),
  };
}

export function parseAvailabilityParams(date: string | null) {
  const start = date ?? todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    throw new Error("date는 YYYY-MM-DD 형식이어야 합니다.");
  }

  return { start };
}
