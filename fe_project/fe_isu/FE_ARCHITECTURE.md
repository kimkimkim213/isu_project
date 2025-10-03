FE_ISU - 간단 아키텍처 및 분해/조립 가이드

목적
- 프로젝트의 프론트엔드 구조를 한눈에 이해하고, "쉬운 해체와 재조립" 관점에서 학습할 수 있도록 정리합니다.
- 교육용 가이드로 사용해서 코드 흐름(녹음 → 저장 → 전사 → 목록 표시)을 단계별로 따라갈 수 있게 합니다.

파일 구조(핵심)
- src/
  - App.vue               : 루트, 탭 전환 및 요약 요청 핸들러
  - main.js               : 앱 부트스트랩
  - components/
    - RecorderPanel.vue   : 녹음 UI 및 MediaRecorder 흐름, STT 전송, emit
    - PastMeetingList.vue : 녹음 목록 렌더링, 재생, 파일명 편집
    - ManageRecording.vue : RecorderPanel + PastMeetingList 래퍼
    - MessageModal.vue    : 단순 모달
  - composable/ (이 파일을 작은 모듈로 분리 권장)
    - index.js            : audio meter, recordings 관리, util 함수(현재 합쳐져 있음)
  - utils/
    - objectUrlCache.js   : Blob ↔ object URL 캐시 유틸

핵심 데이터 흐름(간단)
1. 사용자가 "회의 시작" 탭에서 녹음 버튼 클릭
2. `RecorderPanel`가 getUserMedia로 스트림 획득 → MediaRecorder 생성 → 녹음 시작
3. 청크가 쌓이면 `audioChunks`에 push. 녹음 종료 후 Blob 생성
4. 사용자가 저장하면 STT API로 Blob 전송 → 전사 결과 수신
5. `RecorderPanel`이 `emit('recording-finished', { audioBlob, filename, transcription })` 호출
6. `App.vue` 또는 `ManageRecording.vue`에서 수신하여 `useRecordings`(현재: `useRecs`)로 등록
7. `PastMeetingList`가 recordings prop을 받아 목록 렌더링, object URL로 재생 제공

쉬운 해체(권장 리팩터 단계)
1. composable 분리
   - audioMeter.js: useAudioMeter 훅만 추출
   - recordings.js: useRecs(기록 관리)만 추출
   - utils.js: b2b, b64ToBlob 같은 변환 함수는 별도 파일로 이동
2. 컴포넌트 내부 의존성 명확화
   - `RecorderPanel`는 "마이크 접근, 청크수집, Blob 생성, STT 전송, emit"만 담당
   - 녹음 보존(DAO)은 composable로 위임(useRecs.addRecording)
3. 테스트 하니스 추가
   - 작은 스크립트로 Blob 모의 데이터(짧은 base64) 생성 후 STT 전송 및 emit 흐름 테스트

조립 예시(교육용)
- 단계별 모듈 교체 예시:
  1) 원본 `RecorderPanel`에서 STT 전송(`sendToSpeechAPI`)을 제거하고 더미 함수로 교체
  2) 녹음만 로컬에 저장하도록 변경 후 `useRecs.addRecording` 호출 확인
  3) STT를 다시 연결하여 전체 플로우 재검증

간단 규칙(주석/네이밍)
- 주석은 한국어, 한 줄로 간결하게
- 함수/변수명은 의도가 드러나되 너무 길지 않게(짧음 권장)
- 외부 API URL 등은 상수로 분리

다음 단계 (제가 대신 해드릴 부분)
- `src/composable/index.js`를 책임별로 여러 파일로 분리해 드립니다.
- 분리 후 각 파일에 간단한 테스트(스모크 포함)를 위한 스크립트 추가.

원하시면 지금 `composable` 분리를 시작하겠습니다. (변경은 작은 단계로 나눠 적용합니다.)