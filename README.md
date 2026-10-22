# 메가리그

캐릭터 규칙을 보존하고 게임 실행, 온라인 세션, 화면을 ES 모듈로 분리한 브라우저 게임입니다. 실행 시 사용하는 외부 JavaScript 라이브러리는 없습니다.

## 실행과 빌드

Node.js 22.18 이상에서 실행합니다.

```sh
npm ci
npm run build
npm run dev
```

브라우저에서 `http://127.0.0.1:4173`을 엽니다. GitHub Pages에서는 루트 `index.html`과 `assets/`를 제공합니다. 소스 수정 후에는 반드시 `npm run build`를 실행합니다. 빌드가 JS와 CSS의 내용 해시를 URL에 넣어 이전 버전의 캐시와 섞이지 않게 합니다.

## 구조

| 위치 | 책임 |
|---|---|
| `src/catalog` | 카드와 폼 정의 |
| `src/engine` | 에너지, 합법 행동, 전투 규칙과 고정 실행 경로 |
| `src/features` | 소환물, 캐릭터별 규칙, 보스전, 관전 |
| `src/online` | 명령 승인, 스냅샷, 연결, 복구, 세션 수명 |
| `src/runtime` | 트랜잭션, 입력 잠금, 엔티티와 진단 |
| `src/ui`, `src/presentation` | 입력 초안, 화면과 효과 |
| `src/ai` | 일반전과 보스전 의사결정 |

`src/main.js`가 유일한 진입점입니다. `src/bootstrap.js`에 초기화 순서를 명시했습니다. 상태는 해당 모듈에서 만들며 다른 모듈은 명시적인 import로 접근합니다. `window.Megaleague`와 기존 진단 이름은 테스트와 개발자 도구에서 조회하는 표면입니다. 게임 내부의 의존성 연결에는 사용하지 않습니다.

행동 실행 순서는 승인 → 트랜잭션 → 에너지·오버플로 문맥 → 캐릭터 규칙 → 기본 전투 → 확정입니다. 기본 경로는 원본 함수를 전달해 감싸지 않습니다. 보스 모드의 14개 래퍼와 뒤늦은 AI 메서드 덮어쓰기는 정적인 함수 연결로 바꿨습니다. 렌더링·합법 행동·효과의 확장 지점은 고정 슬롯이며 초기화 뒤 동결됩니다.

온라인의 최종 전투 판정은 호스트 브라우저가 맡습니다. 별도 릴레이는 메시지 전달과 재접속을 담당합니다. 서버에서 전투를 실행하는 방식으로 변경한 것은 아닙니다. 전투 확정과 상태 버전 증가는 전송 성공 여부에 종속되지 않습니다.

## 검증

```sh
npm run validate:static
npm test
npx playwright install chromium
MEGA_RELAY_SOURCE=/path/to/cp32-online-relay/server.js node tools/check-runtime.js
```

온라인 테스트는 실제 릴레이 소스와 두 개의 독립적인 모바일 Chromium 클라이언트를 사용합니다. 대기실, 첫 행동, 지불·교체·오버플로, 감정표현·채팅, 백그라운드·재접속, 종료·두 번째 대전을 검증합니다. 실제 Android 기기 실행은 별도 확인이 필요합니다.

기존 HTML을 가지고 있을 때 다음 명령으로 카드 정의와 고정 시드 전투 규칙을 비교할 수 있습니다.

```sh
node tools/check-feature-parity.js /path/to/previous-index.html
```

이번 변경의 확인 결과는 `docs/modular-runtime-verification.md`에 기록했습니다. `trusted/`와 `validation/bootstrap/`의 HTML은 과거 검증 기준본이며 현재 앱에 로드되지 않습니다.
