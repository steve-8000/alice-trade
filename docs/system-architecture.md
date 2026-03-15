# Clab Trading Center 시스템 아키텍처

## 개요

Clab Trading Center(코드명: OpenAlice)는 **파일 기반 AI 트레이딩 에이전트**입니다. 모든 상태(세션, 설정, 로그)가 파일로 저장되며 데이터베이스가 필요 없습니다.

- **배포 URL:** https://trade.clab.one
- **소스 코드:** https://github.com/steve-8000/alice-trade
- **K8s 매니페스트:** https://github.com/steve-8000/k8s-stg (`workloads/alice-trade/`)
- **기술 스택:** Node.js 22, TypeScript, Hono, Vercel AI SDK, pnpm monorepo

---

## 1. 전체 아키텍처

### Composition Root 패턴

`src/main.ts`가 모든 컴포넌트를 생성하고 연결하는 **구성 루트** 역할을 합니다.

```
main.ts (구성 루트)
  ├── Config 로딩 (data/config/*.json, Zod 검증)
  ├── Trading 계정 초기화 (CCXT, 백그라운드)
  ├── Brain 상태 복원 (persona, 전두엽, 감정)
  ├── ToolCenter 등록 (모든 확장 도구)
  ├── AI Provider 체인 구성
  ├── Connector 플러그인 시작 (Web, Telegram, MCP)
  └── 백그라운드 서비스 (Cron, Heartbeat, News Collector)
```

### 2계층 구조: AgentCenter → GenerateRouter → AIProvider

```
┌─────────────────────────────────────────────┐
│ AgentCenter (최상위 AI 오케스트레이션)         │
│  - 세션 관리, 압축, 히스토리 구성              │
│  - ask() (단발성) / askWithSession() (세션)    │
└────────────────┬────────────────────────────┘
                 │
┌────────────────▼────────────────────────────┐
│ GenerateRouter (프로바이더 라우팅)             │
│  - 매 요청마다 ai-provider-manager.json 읽기  │
│  - 활성 프로바이더 결정                        │
│  - 요청별 오버라이드 지원                      │
└────────────────┬────────────────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐ ┌──────────┐ ┌──────────┐
│ Vercel │ │ Claude   │ │ Agent    │
│ AI SDK │ │ Code CLI │ │ SDK      │
└────────┘ └──────────┘ └──────────┘
```

---

## 2. AI 프로바이더 시스템

### 세 가지 백엔드

| 백엔드 | 입력 형식 | 특징 |
|--------|----------|------|
| **VercelAIProvider** (기본) | `ModelMessage[]` | ToolLoopAgent, 모델 캐싱, 핫리로드 |
| **ClaudeCodeProvider** | 텍스트 | CLI 서브프로세스, evolution mode |
| **AgentSdkProvider** | 텍스트 | 인프로세스 MCP 브릿지 |

### 설정 파일 (`ai-provider-manager.json`)

```json
{
  "backend": "vercel-ai-sdk",
  "provider": "openai",
  "model": "gpt-5.3-codex-spark",
  "baseUrl": "http://219.255.103.226:8317/v1",
  "apiKeys": {
    "openai": "clp_..."
  }
}
```

### 모델 선택 흐름

1. 요청별 오버라이드 (`AskOptions.provider`) — 최우선
2. 글로벌 설정 (`ai-provider-manager.json`) — 기본값
3. 매 요청마다 설정 파일을 다시 읽음 (핫리로드, 재시작 불필요)

### StreamableResult (이중 인터페이스)

```typescript
// await로 최종 결과 얻기
const result = await agentCenter.askWithSession(prompt, session)

// for-await로 스트리밍 이벤트 받기
for await (const event of agentCenter.askWithSession(prompt, session)) {
  // tool_use, tool_result, text, done
}
```

---

## 3. 도구(Tool) 시스템

### ToolCenter — 중앙 레지스트리

모든 확장이 도구를 등록하고, AI가 사용할 수 있도록 Vercel + MCP 두 가지 형식으로 내보냅니다.

```typescript
toolCenter.register(tools, 'group-name')  // 그룹 단위 등록
toolCenter.getVercelTools()                // Vercel AI SDK 형식
toolCenter.getMcpTools()                   // MCP 프로토콜 형식
```

### 등록된 도구 그룹

| 그룹 | 설명 | 주요 도구 |
|------|------|----------|
| **thinking** | 추론, 계산 | calculate, analyze, summarize |
| **trading** | 통합 거래 | searchContracts, placeOrder, tradingCommit, tradingPush |
| **trading-ccxt** | CCXT 전용 | CCXT 프로바이더 도구 |
| **brain** | 인지 상태 | getFrontalLobe, updateEmotion |
| **browser** | 브라우저 자동화 | OpenClaw 브릿지 |
| **cron** | 스케줄 관리 | addJob, removeJob, listJobs |
| **news** | OpenBB 뉴스 | newsGetWorld |
| **news-archive** | RSS 아카이브 | searchArchive |
| **analysis** | 기술적 분석 | SMA, EMA, RSI, MACD, Bollinger, Fibonacci 등 |

### 도구 필터링

`tools.json`에 비활성화할 도구 목록을 지정하면, 매 요청마다 자동으로 필터링됩니다.

---

## 4. 세션 & 히스토리 시스템

### JSONL 세션 저장소

각 대화는 `data/sessions/{connector}/{sessionId}.jsonl` 파일에 한 줄씩 추가됩니다.

```
data/sessions/
├── web/
│   ├── default.jsonl        # 기본 채팅
│   └── {subChannel}.jsonl   # 서브채널
├── telegram/
│   └── {chatId}.jsonl
└── heartbeat.jsonl           # 하트비트 세션
```

### 엔트리 구조

```typescript
{
  type: 'user' | 'assistant' | 'system',
  message: { role, content: ContentBlock[] },
  uuid: string,
  parentUuid: string | null,    // 체인 형성
  sessionId: string,
  timestamp: ISO string,
  provider: 'vercel-ai' | 'claude-code' | ...,
  subtype?: 'compact_boundary'  // 압축 마커
}
```

### 컨텍스트 압축 (Compaction)

토큰 수가 `maxContextTokens`(기본 200k)에 근접하면 자동 압축:

1. AI에게 요약 요청
2. 압축 경계 마커 + 요약 삽입
3. 이전 엔트리 삭제
4. 이후 요청은 마커 이후 엔트리만 사용

---

## 5. 커넥터 시스템

### ConnectorCenter — 다채널 메시지 라우팅

```
┌──────────────────────────────────────┐
│ ConnectorCenter                      │
│  - 마지막 상호작용 채널 추적           │
│  - notify() → 마지막 채널로 전송       │
│  - broadcast() → 모든 채널로 전송      │
└──┬───────────┬───────────┬───────────┘
   │           │           │
   ▼           ▼           ▼
┌──────┐  ┌─────────┐  ┌─────────┐
│ Web  │  │Telegram │  │MCP Ask  │
│(Hono)│  │(grammY) │  │(HTTP)   │
│:3002 │  │Bot API  │  │Optional │
└──────┘  └─────────┘  └─────────┘
```

### Web 커넥터 (주요)

| 경로 | 기능 |
|------|------|
| `/api/chat/*` | 채팅 (SSE 스트리밍) |
| `/api/config/*` | 설정 CRUD |
| `/api/trading/*` | 거래 조회 |
| `/api/cron/*` | 크론 잡 관리 |
| `/api/media/*` | 미디어 파일 |
| `/*` | Vite UI (React SPA) |

### SSE 스트리밍

실시간 AI 응답을 SSE(Server-Sent Events)로 브라우저에 스트리밍합니다.

```
클라이언트 → POST /api/chat → agentCenter.askWithSession()
                                    │
                    ProviderEvent 스트림 (tool_use, text, done)
                                    │
                              SSE → 브라우저 실시간 표시
```

---

## 6. 거래 시스템

### 멀티 계정 구조

```
AccountManager (레지스트리)
  ├── CcxtAccount (binance-main)  ← 현재 활성
  └── CcxtAccount (bybit-sub)    ← 추가 가능
```

### Git 방식 거래 (Trading-as-Git)

거래를 Git 커밋처럼 관리합니다:

```
1. placeOrder()        → 스테이징 영역에 추가
2. tradingCommit(msg)  → 커밋 생성 (해시 체인)
3. tradingPush()       → 실제 브로커에 주문 실행
4. tradingSync()       → 주문 상태 업데이트 (filled/pending/rejected)
```

**상태 저장:** `data/trading/{accountId}/commit.json`

각 커밋은 해시, 부모해시, 타임스탬프, 작업 내역을 포함하며 체인을 형성합니다.

### 가드 파이프라인

주문 전 안전장치:

| 가드 | 역할 |
|------|------|
| MaxPositionSize | 심볼당 최대 포지션 크기 제한 |
| Cooldown | 거래 간 최소 대기 시간 |
| SymbolWhitelist | 허용된 심볼만 거래 |

---

## 7. 브레인 시스템

### 인지 상태 관리

```
data/brain/
├── commit.json          # 해시 체인 상태
├── persona.md           # AI 페르소나 (시스템 프롬프트)
├── frontal-lobe.md      # 작업 기억 (AI가 업데이트)
└── emotion-log.md       # 감정 변화 기록
```

### 도구

| 도구 | 설명 |
|------|------|
| `getFrontalLobe()` | 현재 기억 읽기 |
| `updateFrontalLobe(content)` | 기억 저장 |
| `getEmotion()` | 감정 상태 읽기 |
| `updateEmotion(emotion, reason)` | 감정 업데이트 (이유 포함) |
| `getBrainLog(limit)` | 인지 변화 히스토리 |

페르소나는 시스템 프롬프트로 주입되어 AI의 성격을 결정합니다.

---

## 8. 데이터 레이어 (OpenBB)

### 이중 백엔드

| 백엔드 | 방식 | 장점 |
|--------|------|------|
| **SDK** (기본) | 인프로세스 TypeScript | 빠름, 단일 프로세스 |
| **OpenBB HTTP** | 외부 Python API 호출 | 더 많은 기능 |

### 현재 활성 클라이언트

- **SDKCryptoClient** — 암호화폐 가격, 펀딩레이트
- **SDKNewsClient** — 뉴스 소스

### OpenBB API 서버

내장 HTTP 서버(포트 6901)로 외부 클라이언트가 데이터 엔드포인트를 호출할 수 있습니다.

---

## 9. 스케줄링 시스템

### Cron 엔진

```json
{ "kind": "at", "at": "2025-03-01T09:00:00Z" }     // 일회성
{ "kind": "every", "every": "2h" }                  // 반복
{ "kind": "cron", "cron": "0 9 * * 1-5" }           // 크론 표현식
```

**상태:** `data/cron/jobs.json`

작업 실행 시 → EventLog에 이벤트 기록 → 리스너가 AI 호출 → 결과 전송

### 하트비트

주기적으로 AI를 호출하여 자체 점검 및 사용자에게 알림을 보냅니다.

```json
{
  "enabled": true,
  "every": "30m",
  "activeHours": { "start": "09:00", "end": "17:00" }
}
```

---

## 10. 설정 시스템

### 설정 파일 목록 (`data/config/`)

| 파일 | 용도 |
|------|------|
| `engine.json` | 거래쌍, 간격, 포트 |
| `agent.json` | maxSteps, maxTokens, Claude Code 설정 |
| `ai-provider-manager.json` | AI 백엔드, 모델, API 키 |
| `platforms.json` | 거래소 플랫폼 정의 |
| `accounts.json` | 거래 계정 + 가드 |
| `openbb.json` | 데이터 소스, API 키 |
| `compaction.json` | 토큰 제한, 버퍼 크기 |
| `heartbeat.json` | 하트비트 스케줄 |
| `connectors.json` | Web, Telegram, MCP 포트 |
| `tools.json` | 비활성화 도구 목록 |
| `news-collector.json` | RSS 피드 설정 |

### 핫리로드

대부분의 설정은 매 요청마다 디스크에서 다시 읽히므로 **재시작 없이 즉시 적용**됩니다:
- AI 프로바이더/모델 변경
- 도구 활성화/비활성화
- 커넥터 재연결

---

## 11. 이벤트 로그

### 추가 전용 이벤트 로그 (`data/events.jsonl`)

| 이벤트 | 설명 |
|--------|------|
| `message.received` | 사용자 입력 |
| `cron.fire` | 크론 작업 실행 |
| `heartbeat.done` | 하트비트 전송 |
| `trade.open` | 주문 실행 |
| `trade.close` | 포지션 종료 |

- 단조 증가 시퀀스 번호
- 메모리 링 버퍼 (최근 500건) + 디스크 영구 저장
- Pub/Sub: 이벤트 타입별 구독 가능

---

## 12. 배포 아키텍처

### Docker 이미지 빌드 (서버 직접 빌드)

```
Node 22 Alpine
  ├── deps: pnpm install --frozen-lockfile
  ├── build: pnpm build (opentypebb → UI → backend)
  └── runtime: node dist/main.js (포트 3002)
```

### Kubernetes 배포

```
┌─────────────────────────────────────────────┐
│ K3s 클러스터 (219.255.103.189)               │
│                                             │
│  ┌─────────────────────────────────────┐    │
│  │ Namespace: alice-trade               │    │
│  │                                     │    │
│  │  Deployment (1 replica)             │    │
│  │    └── alice-trade:v7               │    │
│  │        ├── 포트 3002 (HTTP)          │    │
│  │        └── Volume Mounts:           │    │
│  │            ├── /app/data/config     │    │
│  │            ├── /app/data/sessions   │    │
│  │            ├── /app/data/brain      │    │
│  │            ├── /app/data/trading    │    │
│  │            ├── /app/data/news       │    │
│  │            └── /app/logs            │    │
│  │                                     │    │
│  │  Service (ClusterIP:80 → 3002)      │    │
│  │                                     │    │
│  │  Ingress (trade.clab.one)           │    │
│  │    ├── TLS (Let's Encrypt)          │    │
│  │    └── nginx proxy                  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  ArgoCD (GitOps 자동 싱크)                   │
│    └── k8s-stg/workloads/alice-trade/       │
└─────────────────────────────────────────────┘
```

### 데이터 영속성 (HostPath)

```
/opt/alice-trade/
├── config/       # 설정 파일 (JSON)
├── sessions/     # 대화 히스토리 (JSONL)
├── brain/        # 인지 상태
├── trading/      # 거래 커밋 체인
├── news/         # 뉴스 아카이브
└── logs/         # 애플리케이션 로그
```

### 배포 워크플로우

```bash
# 1. 서버에서 소스 업데이트 및 빌드
ssh root@219.255.103.189
cd /opt/alice-trade && git pull
docker build -t alice-trade:vN .
docker save alice-trade:vN | k3s ctr images import -

# 2. k8s-stg에서 이미지 태그 업데이트
# workloads/alice-trade/deployment.yaml → image: alice-trade:vN
git commit && git push

# 3. ArgoCD 싱크 (자동 또는 수동)
kubectl patch application alice-trade -n argocd ...
```

---

## 13. 메시지 처리 흐름 (전체)

```
사용자 메시지 입력 (Web UI / Telegram)
        │
        ▼
    Connector 수신 → ConnectorCenter 이벤트 발행
        │
        ▼
    agentCenter.askWithSession(prompt, session)
        │
        ├── 1. session.appendUser(prompt)     # 히스토리에 추가
        ├── 2. 컨텍스트 압축 체크               # 토큰 초과 시 자동 압축
        ├── 3. GenerateRouter.resolve()       # 프로바이더 결정
        │
        ▼
    Provider.generate(entries, prompt)
        │
        ├── tool_use  → 도구 호출 로그 + SSE 전송
        ├── tool_result → 미디어 추출 + SSE 전송
        ├── text      → 텍스트 누적 + SSE 전송
        └── done      → 세션 영속화 + 최종 결과
        │
        ▼
    SSE → 브라우저 실시간 렌더링
    또는
    Telegram → Bot API로 응답 전송
```

---

## 14. 핵심 설계 원칙

| 원칙 | 설명 |
|------|------|
| **파일 기반 영속성** | 데이터베이스 없음, 모든 상태를 파일로 저장 |
| **핫리로드** | 설정/도구/커넥터가 재시작 없이 업데이트 |
| **구성 루트 패턴** | main.ts가 모든 의존성을 생성하고 연결 |
| **Git 방식 거래** | 커밋/푸시 패턴으로 거래 추적성 확보 |
| **이중 인터페이스** | 도구를 Vercel AI SDK + MCP 두 형식으로 내보냄 |
| **다채널 라우팅** | 마지막 상호작용 채널로 자동 응답 |
| **추가 전용 로그** | 이벤트 로그로 감사 추적 |
| **Zod 검증** | 모든 설정에 스키마 검증 + 기본값 자동 생성 |
