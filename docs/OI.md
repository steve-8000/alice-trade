핵심은 가격 변화 + OI 변화 조합으로 포지션 성격을 분류하는 전략입니다. OI는 미결제약정 수량이고, 일반적으로
가격↑ + OI↑ = 신규 롱 유입,
가격↓ + OI↑ = 신규 숏 유입,
가격↑ + OI↓ = 숏 커버링,
가격↓ + OI↓ = 롱 청산으로 해석하는 프레임이 가장 실무적입니다.

1) 전략 컨셉: OI-Price Regime Strategy

바이낸스 선물 BTCUSDT Perp 기준으로 이렇게 바꾸면 됩니다.

상태 분류

5분봉 또는 15분봉마다 다음을 계산합니다.

ret = (close_t / close_{t-1}) - 1

oi_delta = (OI_t / OI_{t-1}) - 1

vol_z = 거래량 z-score

oi_z = OI delta z-score

그 다음 4가지 상태로 분류합니다.

Long Build-up

가격 상승

OI 상승

거래량 평균 이상
→ 추세 지속형 롱 후보

Short Build-up

가격 하락

OI 상승

거래량 평균 이상
→ 추세 지속형 숏 후보

Short Covering

가격 상승

OI 하락
→ 강한 추세 진입보다 숏 청산 반등 가능성. 추격 롱보다 익절/관망 쪽

Long Unwinding

가격 하락

OI 하락
→ 패닉성 하락 뒤 되돌림 가능성. 추격 숏보다 후속 시그널 대기

즉, 실제 엔트리는 OI가 늘어나는 방향만 따라간다가 핵심입니다.
이 전략은 “움직임이 진짜 신규 포지션 유입인지, 단순 청산인지”를 구분하려는 구조입니다. OI는 바로 그 구분에 쓰는 지표입니다.

2) 바이낸스 선물용 엔트리 규칙
롱 진입

아래를 모두 만족할 때만 롱:

15분봉 종가 기준 ret > +0.25%

15분 OI 변화율 oi_delta > +0.4%

15분 거래량 z-score > 1

가격이 1시간 VWAP 또는 1시간 EMA(20) 위

직전 3개 봉 고점 돌파

이건 의미상
“가격이 오르는데, OI도 증가하고, 거래량도 붙고, 상위 타임프레임도 롱 방향”
= 신규 롱 빌드업 추종입니다.

숏 진입

아래를 모두 만족할 때만 숏:

15분봉 종가 기준 ret < -0.25%

15분 OI 변화율 oi_delta > +0.4%

15분 거래량 z-score > 1

가격이 1시간 VWAP 또는 1시간 EMA(20) 아래

직전 3개 봉 저점 이탈

이건 신규 숏 빌드업 추종입니다.

3) 절대 하면 안 되는 진입

다음은 진입 금지로 두는 게 좋습니다.

가격 급등인데 OI 급감
→ 숏 커버링일 수 있음. 추격 롱 금지

가격 급락인데 OI 급감
→ 롱 언와인딩일 수 있음. 바닥에서 추격 숏 금지

OI는 늘지만 거래량이 너무 약함
→ 시그널 품질 낮음

펀딩비가 극단값인데 같은 방향 추격
→ 이미 crowded trade 가능성

즉 이 전략은 모든 캔들을 거래하는 게 아니라, OI가 “새 포지션 유입”을 확인해 주는 구간만 거래해야 합니다.

4) 청산 규칙

가장 실전적인 구조는 3단계입니다.

손절

ATR(15m, 14) 기준 1.2~1.5 ATR

또는 진입봉 저점/고점 이탈

1차 익절

+1R에서 30~50% 청산

손절을 BE로 이동

최종 청산

아래 중 하나면 전량 정리:

가격은 유리한데 OI가 반대로 급감

반대 방향 engulfing + 거래량 급증

15분 기준 추세 꺾임

최대 보유시간 초과

OI 전략은 가격만 보는 전략보다 “추세가 끝났는지”를 더 빨리 감지할 수 있다는 장점이 있습니다.
예를 들어 롱 보유 중 가격은 버티는데 OI가 빠르게 줄면, 신규 매수 유입이 끊기고 있다는 뜻일 수 있어 후행적으로 청산하는 데 유리합니다.

5) 추천 타임프레임

너 프로젝트 기준으로는 이 조합이 가장 맞습니다.

1시간: 방향 필터

15분: 메인 시그널

5분: 실행 타이밍

즉:

1시간에서 추세 방향 결정

15분에서 OI build-up 확인

5분에서 돌파/리테스트 진입

이렇게 하면 노이즈를 줄이면서도 진입은 너무 늦지 않습니다.

6) 시스템 구조

바이낸스 선물용으로는 다음 파이프라인이 맞습니다.

입력 데이터

Binance futures klines

Binance open interest

Binance funding rate

Binance taker buy/sell volume

가능하면 liquidation 데이터도 추가

피처

price_return_5m/15m/1h

oi_change_5m/15m

volume_zscore

taker_buy_sell_imbalance

funding_percentile

distance_from_vwap

ATR, EMA slope

시그널 엔진

regime classifier:

long buildup

short buildup

short covering

long unwinding

execution filter:

spread

slippage

funding extreme

event blackout

실행

reduce-only 청산

post-only 우선, 실패 시 marketable limit

max leverage 고정

1회 손실 허용치 고정

7) 바로 쓸 수 있는 룰셋

아주 단순하게 시작하면 이 버전이 좋습니다.

Long

1h EMA20 > EMA50

15m close > previous high

15m OI delta > +0.5%

15m volume z-score > 1.2

funding not extreme

Short

1h EMA20 < EMA50

15m close < previous low

15m OI delta > +0.5%

15m volume z-score > 1.2

funding not extreme

Exit

stop = 1.3 ATR

tp1 = 1R

tp2 = 2.2R

if OI reverses sharply against position, force exit

8) 이 전략의 장점 / 약점
장점

단순 가격 돌파보다 훨씬 낫다

“진짜 추세”와 “청산성 급등락”을 구분하는 데 유리

BTC 선물처럼 레버리지 포지셔닝이 중요한 시장에 잘 맞음

약점

OI 데이터 지연/갱신 주기 이슈가 있으면 성능 저하

횡보장에서 false build-up이 자주 나올 수 있음

대형 뉴스 캔들에서는 OI 해석이 왜곡될 수 있음

그래서 실전에서는 OI 단독 전략이 아니라, 가격 구조 + 거래량 + 상위 타임프레임 필터와 같이 써야 합니다.