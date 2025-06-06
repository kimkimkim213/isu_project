<template>
  <div class="container">
    <!-- 상단바 (로고 + 탭) -->
    <header class="header-bar">
      <div class="logo-placeholder">
        <img src="@/assets/logo.png" alt="로고" class="logo-img" />
      </div>
      <nav class="tabs">
        <button
          :class="['tab-button', activeTab === 'current' ? 'active' : '']"
          @click="activeTab = 'current'"
        >
          회의 진행
        </button>
        <button
          :class="['tab-button', activeTab === 'past' ? 'active' : '']"
          @click="activeTab = 'past'"
        >
          지난 회의
        </button>
      </nav>
    </header>

    <!-- 메인 콘텐츠 영역 -->
    <main class="main-content">
      <!-- 회의 진행 탭: 중앙에 큰 녹음 버튼 -->
      <section v-if="activeTab === 'current'" class="current-tab">
        <!-- 1) 녹음 버튼 -->
        <button
          class="record-btn"
          type="button"
          @click="toggleRecording"
        >
          <div class="outer-circle">
            <div v-if="!isRecording" class="inner-circle"></div>
            <div v-else class="inner-square"></div>
          </div>
        </button>

        <!-- 2) 녹음 중 텍스트 (버튼 아래, 절대 위치) -->
        <div v-if="isRecording" class="recording-text">
          녹음중…
        </div>
      </section>

      <!-- 지난 회의 탭: 간단한 플레이스홀더 -->
      <section v-else class="past-tab">
        <div class="placeholder">
          🔶 지난 회의 목록 화면 (여기에 콘텐츠를 구현하세요)
        </div>
      </section>
    </main>
  </div>
</template>

<script>
export default {
  name: 'App',
  data() {
    return {
      activeTab: 'current',
      isRecording: false
    };
  },
  methods: {
    toggleRecording() {
      this.isRecording = !this.isRecording;
      // ▶ 실제 녹음 로직을 여기에 연결하세요.
    }
  }
};
</script>

<style scoped>
/* ─────────── 전체 레이아웃 ─────────── */
.container {
  display: flex;
  flex-direction: column;
  height: 100vh;
  margin: 0;
}

/* ─────────── 상단바 ─────────── */
.header-bar {
  position: relative;
  display: flex;
  align-items: center;
  background-color: #000;
  color: #fff;
  padding: 0 24px;
  height: 100px;
}

.logo-placeholder {
  display: flex;
  align-items: center;
  height: 100%;
}

.logo-img {
  height: 80px;
  object-fit: contain;
}

.tabs {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  height: 60px;
  gap: 40px;
}

.tab-button {
  background: none;
  border: none;
  color: #888888;
  font-size: 24px;
  padding: 0 24px;
  cursor: pointer;
  height: 100%;
  display: flex;
  align-items: center;
  transition: all 0.2s;
}

.tab-button:hover {
  background-color: rgba(255, 255, 255, 0.1);
}

.tab-button.active {
  color: #ffffff;
  border-bottom: 4px solid #00bfa5;
}

/* ─────────── 메인 콘텐츠 ─────────── */
.main-content {
  flex: 1;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* ─────────── 회의 진행 탭 영역 ─────────── */
.current-tab {
  flex: 1;
  position: relative;           /* 버튼과 텍스트를 절대 위치로 배치하기 위함 */
  display: flex;
  justify-content: center;      /* 수평 중앙 정렬 (버튼) */
  align-items: center;          /* 수직 중앙 정렬 (버튼) */
}

/* ─────────── 녹음 버튼 ─────────── */
.record-btn {
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
  /* 절대 위치로 중앙 배치 */
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.outer-circle {
  width: 150px;
  height: 150px;
  background-color: #ececec;
  border: 1px solid #ccc;
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
}

.inner-circle {
  width: 80px;
  height: 80px;
  background-color: #e53935;
  border-radius: 50%;
}

.inner-square {
  width: 65px;
  height: 65px;
  border-radius: 8px; /* 모서리를 둥글게 */
  background-color: #e53935;
}

/* ─────────── 녹음 중 텍스트 ─────────── */
.recording-text {
  /* 버튼 아래쪽(절대 위치) */
  position: absolute;
  top: calc(50% + 100px);   /* 버튼의 중앙에서 +100px 아래에 위치 */
  left: 50%;
  transform: translateX(-50%);
  font-size: 32px;          /* 더 크게 */
  color: #000000;           /* 검은색 */
}

/* ─────────── 지난 회의 탭 (플레이스홀더) ─────────── */
.past-tab {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.placeholder {
  border: 2px dashed #ccc;
  padding: 40px;
  text-align: center;
  font-size: 20px;
  color: #555;
}
</style>
