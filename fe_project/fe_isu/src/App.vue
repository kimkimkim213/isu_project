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
      <!-- 회의 진행 탭: 중앙에 큰 녹음 버튼만 표시 -->
      <section v-if="activeTab === 'current'" class="current-tab">
        <div class="record-center">
          <div class="outer-circle">
            <div class="inner-circle"></div>
          </div>
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
      activeTab: 'current'
    };
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
  color: #888888; /* 기본 회색 */
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
  color: #ffffff; /* 선택된 탭은 흰색 */
  border-bottom: 4px solid #00bfa5;
}

/* ─────────── 메인 콘텐츠 ─────────── */
.main-content {
  flex: 1;
  background-color: #fff;
  display: flex;
  flex-direction: column;
}

/* ─────────── 회의 진행 탭 영역 ─────────── */
.current-tab {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 중앙 정렬된 녹음 버튼 컨테이너 */
.record-center {
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 바깥 원 (회색 배경) */
.outer-circle {
  width: 150px;              /* 원 전체 크기 */
  height: 150px;
  background-color: #ececec; /* 연한 회색 */
  border: 1px solid #ccc;    /* 테두리 */
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
}

/* 안쪽 원 (빨간 녹음 버튼) */
.inner-circle {
  width: 80px;               /* 안쪽 원 크기 */
  height: 80px;
  background-color: #e53935; /* 진한 빨강 */
  border-radius: 50%;
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
