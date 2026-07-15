#!/usr/bin/env python3
"""카바스 세차장 네이버 예약 현황 조회."""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

from urllib.parse import quote

GRAPHQL_URL = "https://m.booking.naver.com/graphql"
BUSINESS_ID = "193155"
BUSINESS_TYPE_ID = 10
BOOKING_URL = "https://m.booking.naver.com/booking/10/bizes/193155"
SEOUL = ZoneInfo("Asia/Seoul")
GARAGE_BAY_COUNT = 5
BUSINESS_DAY_START_HOUR = 6

BUSINESS_HOURS = [
    *[{"hour": hour, "nextDay": False} for hour in range(BUSINESS_DAY_START_HOUR, 24)],
    *[{"hour": hour, "nextDay": True} for hour in range(0, BUSINESS_DAY_START_HOUR)],
]

SEARCH_BIZ_ITEMS = """
query searchBizItem($bizItemSearchParams: BizItemSearchParams) {
  searchBizItem(input: $bizItemSearchParams) {
    bizItems { bizItemId name }
  }
}
"""

SCHEDULE_QUERY = """
query schedule($scheduleParams: ScheduleParams) {
  schedule(input: $scheduleParams) {
    bizItemSchedule {
      daily { date }
    }
  }
}
"""

HOURLY_QUERY = """
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
"""


def graphql(query: str, variables: dict) -> dict:
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = urllib.request.Request(
        GRAPHQL_URL,
        data=body,
        headers={
            "content-type": "application/json",
            "origin": "https://m.booking.naver.com",
            "referer": BOOKING_URL,
            "user-agent": "Mozilla/5.0",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}: {exc.read().decode()[:500]}") from exc

    if payload.get("errors"):
        messages = "; ".join(err["message"] for err in payload["errors"])
        raise RuntimeError(messages)
    return payload["data"]


def fetch_biz_items() -> list[dict]:
    data = graphql(
        SEARCH_BIZ_ITEMS,
        {"bizItemSearchParams": {"businessId": BUSINESS_ID, "lang": "ko"}},
    )
    return data["searchBizItem"]["bizItems"]


def garage_biz_items(biz_items: list[dict]) -> list[dict]:
    bays = [item for item in biz_items if "번 게러지" in item["name"]]
    bays.sort(key=lambda item: item["name"])
    return bays[:GARAGE_BAY_COUNT]


def fetch_hourly_slots(biz_item_id: str, day: date) -> list[dict]:
    day_start = f"{day.isoformat()}T00:00:00"
    data = graphql(
        HOURLY_QUERY,
        {
            "scheduleParams": {
                "businessId": BUSINESS_ID,
                "businessTypeId": BUSINESS_TYPE_ID,
                "bizItemId": biz_item_id,
                "startDateTime": day_start,
                "endDateTime": day_start,
            }
        },
    )
    return data["schedule"]["bizItemSchedule"]["hourly"] or []


def build_booking_url(biz_item_id: str, unit_start_time: str) -> str:
    start_date_time = unit_start_time.strip().replace(" ", "T")
    base = (
        f"https://m.booking.naver.com/booking/{BUSINESS_TYPE_ID}"
        f"/bizes/{BUSINESS_ID}/items/{biz_item_id}"
    )
    return f"{base}?startDateTime={quote(start_date_time)}"


def slot_status(slot: dict) -> str:
    unit_stock = slot.get("unitStock") or 0
    unit_booked = slot.get("unitBookingCount") or 0
    occupied = slot.get("occupiedBookingCount") or 0
    is_sale = slot.get("isUnitSaleDay", slot.get("isSaleDay", False))
    is_business = slot.get("isUnitBusinessDay", slot.get("isBusinessDay", False))

    if not is_sale or not is_business or unit_stock <= 0:
        return "closed"
    if unit_booked + occupied >= unit_stock:
        return "booked"
    return "available"


def hourly_slots_by_hour(slots: list[dict], day: date) -> dict[int, dict]:
    by_hour: dict[int, dict] = {
        hour: {"status": "closed"} for hour in range(24)
    }
    for slot in slots:
        dt = datetime.fromisoformat(
            slot["unitStartDateTime"].replace("Z", "+00:00")
        ).astimezone(SEOUL)
        if dt.date() != day:
            continue
        by_hour[dt.hour] = {
            "status": slot_status(slot),
            "unitStartTime": slot.get("unitStartTime"),
        }
    return by_hour


def _matrix_slot(
    biz_item_id: str,
    target_date: date,
    next_date: date,
    slot: dict,
    by_today: dict[int, dict],
    by_tomorrow: dict[int, dict],
) -> dict:
    info = by_tomorrow[slot["hour"]] if slot["nextDay"] else by_today[slot["hour"]]
    result = {
        "hour": slot["hour"],
        "nextDay": slot["nextDay"],
        "status": info["status"],
    }
    if info["status"] == "available":
        unit_start_time = info.get("unitStartTime")
        if unit_start_time:
            result["bookingUrl"] = build_booking_url(biz_item_id, unit_start_time)
        else:
            date_str = next_date.isoformat() if slot["nextDay"] else target_date.isoformat()
            result["bookingUrl"] = build_booking_url(
                biz_item_id,
                f"{date_str}T{slot['hour']:02d}:00:00",
            )
    return result


def fetch_day_matrix(target_date: date, biz_items: list[dict] | None = None) -> dict:
    bays = garage_biz_items(biz_items or fetch_biz_items())
    next_date = target_date + timedelta(days=1)
    rows: list[dict] = []

    def fetch_bay_row(item: dict) -> dict:
        slots_today = fetch_hourly_slots(item["bizItemId"], target_date)
        slots_tomorrow = fetch_hourly_slots(item["bizItemId"], next_date)
        by_today = hourly_slots_by_hour(slots_today, target_date)
        by_tomorrow = hourly_slots_by_hour(slots_tomorrow, next_date)
        return {
            "bizItemId": item["bizItemId"],
            "name": item["name"].replace(" 게러지", ""),
            "hours": [
                _matrix_slot(
                    item["bizItemId"],
                    target_date,
                    next_date,
                    slot,
                    by_today,
                    by_tomorrow,
                )
                for slot in BUSINESS_HOURS
            ],
        }

    with ThreadPoolExecutor(max_workers=GARAGE_BAY_COUNT) as executor:
        rows = list(executor.map(fetch_bay_row, bays))

    rows.sort(key=lambda row: row["name"])
    return {
        "date": target_date.isoformat(),
        "nextDate": next_date.isoformat(),
        "weekday": target_date.strftime("%a"),
        "hours": BUSINESS_HOURS,
        "rows": rows,
    }


def fetch_day_status(biz_item_id: str, day: date) -> dict:
    day_str = day.isoformat()
    data = graphql(
        SCHEDULE_QUERY,
        {
            "scheduleParams": {
                "businessId": BUSINESS_ID,
                "bizItemId": biz_item_id,
                "startDateTime": f"{day_str}T00:00:00",
                "endDateTime": f"{day_str}T23:59:59",
            }
        },
    )
    return data["schedule"]["bizItemSchedule"]["daily"]["date"][day_str]


def bay_status(item: dict, target_date: date) -> dict:
    status = fetch_day_status(item["bizItemId"], target_date)
    stock = status["stock"]
    booked = status["bookingCount"] + status["occupiedBookingCount"]
    return {
        "bizItemId": item["bizItemId"],
        "name": item["name"],
        "stock": stock,
        "booked": booked,
        "remain": stock - booked,
    }


def fetch_availability(start: date, days: int = 1) -> dict:
    biz_items = fetch_biz_items()
    result: dict = {
        "businessId": BUSINESS_ID,
        "businessName": "카바스 실내셀프세차장",
        "bookingUrl": BOOKING_URL,
        "days": [],
    }

    if days == 1:
        result["view"] = "matrix"
        result["matrix"] = fetch_day_matrix(start, biz_items)
        return result

    for offset in range(days):
        target = start + timedelta(days=offset)
        result["days"].append(
            {
                "date": target.isoformat(),
                "weekday": target.strftime("%a"),
                "bays": [bay_status(item, target) for item in biz_items],
            }
        )
    result["view"] = "summary"
    return result


def print_status(target_date: date, biz_items: list[dict]) -> None:
    print(f"\n{target_date.isoformat()} ({target_date.strftime('%a')})")
    print("-" * 48)
    for item in biz_items:
        status = bay_status(item, target_date)
        print(
            f"  {status['name']:10s}  예약 {status['booked']:2d} / "
            f"잔여 {status['remain']:2d} (총 {status['stock']})"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="카바스 세차장 예약 현황 조회")
    parser.add_argument("--date", help="조회 날짜 (YYYY-MM-DD), 기본값: 오늘")
    parser.add_argument("--days", type=int, default=1, help="조회 일수 (기본 1)")
    args = parser.parse_args()

    start = date.fromisoformat(args.date) if args.date else date.today()
    biz_items = fetch_biz_items()

    print(f"카바스 실내셀프세차장 (businessId: {BUSINESS_ID})")
    print(f"베이 {len(biz_items)}개")

    for offset in range(args.days):
        print_status(start + timedelta(days=offset), biz_items)

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, KeyError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        raise SystemExit(1)
