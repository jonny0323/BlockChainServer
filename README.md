# 가격 예측 마켓 DApp — Backend

> 자산 가격이 정해진 시각에 **목표가 이상일지/미만일지** 예측해 참여하고,
> 결과는 **Chainlink 가격 오라클**로 확정·정산하는 **Polygon 메인넷** 기반 예측 마켓의 백엔드 서버

| 구분 | 레포 |
|---|---|
| **Backend (이 레포)** | Node.js · Express 5 · MySQL · ethers.js · Lit Protocol |
| Frontend | [BlockChainFront](https://github.com/jonny0323/BlockChainFront) (React + Vite) |
| 스마트 컨트랙트 | Solidity — `BetFactory`, `BettingMarket` (ABI: `src/shared/abi`) <!-- TODO: 컨트랙트 소스 레포가 있으면 링크 --> |

---

## 1. 문제

- 블록체인 서비스는 **지갑 설치·시드 문구 관리**가 진입 장벽이라 일반 사용자가 써 보기 어렵다.
- 예측 결과를 운영자가 판정하면 **결과 조작 의심**이 생긴다.

→ **Google 로그인만으로 지갑을 자동 발급**하고, 결과 판정은 **온체인 오라클 가격**에 맡겼다.

## 2. 주요 기능

| 기능 | 설명 |
|---|---|
| 소셜 로그인 → 지갑 자동 발급 | Google OAuth 로그인 시 Lit Protocol **PKP**(Programmable Key Pair)를 민팅해 사용자별 지갑 생성. 사용자는 개인키를 직접 다루지 않음 |
| 마켓 생성 (관리자) | 자산·목표가·정산 시각을 받아 `BetFactory`로 마켓 컨트랙트를 배포하고 DB에 기록 |
| 예측 참여 | 서버가 `placeBet(isAbove)` 트랜잭션을 만들고 사용자 PKP로 서명해 Polygon에 전송 → tx hash 저장 |
| 일괄 정산 (관리자) | 정산 시각이 지난 마켓을 모아 순차적으로 확정 트랜잭션 전송, 마켓별 성공/실패 결과 반환 |
| 출금 | 사용자 지갑 잔액을 외부 주소로 출금 |

## 3. 아키텍처

```
[React Front] ──HTTPS──▶ [Nginx] ──▶ [Express API] ──▶ MySQL (유저·마켓·참여 기록)
                                         │
                       ┌─────────────────┼──────────────────┐
                       ▼                 ▼                  ▼
               Lit Protocol PKP     Polygon Mainnet     Chainlink Price Feed
               (사용자 서명)        (BettingMarket)     (정산 기준 가격)

배포: GitHub Actions → Docker 이미지 빌드 → Oracle Cloud
```

## 4. 기술 선택 이유

| 선택 | 이유 |
|---|---|
| **Polygon 메인넷** | 이더리움 호환(EVM)이면서 수수료가 낮아 소액 참여가 현실적. 테스트넷이 아닌 메인넷에서 실제 트랜잭션으로 검증 |
| **Chainlink Price Feed** | 정산 가격을 운영자가 아니라 탈중앙 오라클이 제공 → 결과의 신뢰성 확보 |
| **Lit Protocol PKP** | 소셜 로그인만으로 지갑을 만들고 서명할 수 있어 지갑 설치 없는 UX 구현 |
| **온체인 + DB 이중 기록** | 자금 이동·결과는 컨트랙트가 원장 역할을 하고, 목록·통계 조회는 매번 체인을 읽으면 느리므로 DB에 집계 |
| **Docker + GitHub Actions** | `main` push 시 이미지 빌드 → 서버 배포를 자동화 |

## 5. 트러블슈팅 · 개선 계획

<!-- TODO: 실제로 겪은 문제를 "문제 → 원인 → 해결 → 결과" 형식으로 1~2개 추가.
     후보) 일괄 정산 시 nonce 충돌, PKP 세션 서명 만료, 가스비 추정 실패 등 -->

**일괄 정산의 nonce 관리**
여러 마켓을 한 번에 정산하면 같은 관리자 지갑에서 트랜잭션이 연속으로 나가 nonce가 겹칠 수 있다.
→ 시작 시 `getTransactionCount(address, "pending")`로 nonce를 한 번 읽고, 마켓마다 직접 1씩 올려 지정하는 방식으로 처리했다.

**앞으로 고칠 부분 — 온체인과 DB의 정합성**

| 문제 | 개선 방향 |
|---|---|
| 트랜잭션 전송 성공 후 DB 갱신 3건(참여자 수·금액·참여 기록)이 **하나의 DB 트랜잭션으로 묶여 있지 않아**, 중간 실패 시 체인과 DB가 어긋날 수 있음 | DB 갱신을 하나의 트랜잭션으로 묶고, 실패 건은 tx hash 기준으로 **체인 이벤트를 다시 읽어 보정**하는 배치 추가 |
| 같은 요청이 재전송되면 중복 참여 가능 | 클라이언트 **멱등키** 도입, `transaction_hash` UNIQUE 제약 |
| 자동화된 테스트 없음 | 서비스 계층 단위 테스트 + 로컬 체인(Hardhat) 통합 테스트 |

## 6. 실행 방법

```bash
cp .env.example .env   # POLYGON_RPC_URL, ADMIN_PRIVATE_KEY, DB_*, JWT_SECRET, GOOGLE_* 설정
docker compose up -d
```

> 개인키·RPC URL 등 민감 정보는 모두 환경변수로 주입하며 레포에 포함하지 않습니다.
