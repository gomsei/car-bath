# 카바스 세차장 예약 현황 조회

네이버 예약 페이지의 비공식 GraphQL API를 통해 카바스 실내셀프세차장 예약 현황을 조회합니다.

- 예약 페이지: https://m.booking.naver.com/booking/10/bizes/193155
- businessId: `193155`

## 주의사항

- 네이버 공식 API가 아닙니다. 언제든 차단되거나 스펙이 바뀔 수 있습니다.
- 회원 전용 업체입니다. 비회원 예약은 취소될 수 있습니다.
- 공개 API로는 **베이별 일 단위 예약 수**만 확인 가능합니다. 정확한 예약 시간대는 확인되지 않습니다.

## 베이 목록

| bizItemId | 이름 |
|-----------|------|
| 2913817 | 1번 게러지 |
| 2913823 | 2번 게러지 |
| 2913825 | 3번 게러지 |
| 2913827 | 4번 게러지 |
| 2913828 | 5번 게러지 |
| 5411549 | 세차예약 |

## 사용법

```bash
python3 fetch_availability.py
python3 fetch_availability.py --date 2026-07-16
python3 fetch_availability.py --days 7
```

## API 엔드포인트

```
POST https://m.booking.naver.com/graphql
```

### 베이 목록 조회

```graphql
query searchBizItem($bizItemSearchParams: BizItemSearchParams) {
  searchBizItem(input: $bizItemSearchParams) {
    bizItems { bizItemId name }
  }
}
```

### 날짜별 예약 현황

```graphql
query schedule($scheduleParams: ScheduleParams) {
  schedule(input: $scheduleParams) {
    bizItemSchedule {
      daily { date }
    }
  }
}
```

variables 예시:

```json
{
  "scheduleParams": {
    "businessId": "193155",
    "bizItemId": "2913817",
    "startDateTime": "2026-07-16T00:00:00",
    "endDateTime": "2026-07-16T23:59:59"
  }
}
```

응답 필드:

- `stock`: 하루 총 슬롯 수 (24 = 1시간 단위)
- `bookingCount`: 예약된 슬롯 수
- `occupiedBookingCount`: 점유 중인 슬롯 수
- 잔여 = `stock - bookingCount - occupiedBookingCount`
