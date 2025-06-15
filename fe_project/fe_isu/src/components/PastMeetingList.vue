<template>
  <div class="meeting-list">
    <h2>지난 회의 목록</h2>

    <div
      v-for="meeting in meetings"
      :key="meeting.id"
      class="meeting-item"
    >
      <div class="meeting-info">
        <!-- 수정 모드일 때 입력 필드, 아닐 때 제목 표시 -->
        <input
          v-if="editingMeetingId === meeting.id"
          type="text"
          v-model="editedFilename"
          @keyup.enter="saveEditedFilename(meeting.id)"
          @blur="saveEditedFilename(meeting.id)"
          class="filename-edit-input"
        />
        <!-- 제목을 클릭하면 수정 모드로 진입 -->
        <div v-else @click="startEditingFilename(meeting)" class="editable-title-area">
          <h3>{{ meeting.title }}</h3>
          <p>{{ meeting.date }}</p>
        </div>
      </div>

      <!-- 오디오 플레이어 -->
      <audio
        v-if="meeting.audioUrl"
        :src="meeting.audioUrl"
        controls
        class="audio-player"
      ></audio>

      <div class="meeting-actions">
        <!-- 다운로드 버튼 -->
        <a
          v-if="meeting.audioUrl"
          :href="meeting.audioUrl"
          :download="getFileName(meeting)"
          class="action-button download"
        >
          다운로드
        </a>
        <!-- 기존의 수정 버튼은 제거되었습니다. -->
        <!-- 삭제 버튼 -->
        <button
          class="action-button delete"
          @click="confirmDeleteMeeting(meeting.id, meeting.title)"
        >
          삭제
        </button>
      </div>
    </div>
    <p v-if="meetings.length === 0" class="no-meetings-message">저장된 지난 회의가 없습니다.</p>

    <!-- Custom Message Modal (삭제 확인, 정보 메시지 등) -->
    <div v-if="showMessageModal" class="message-modal-overlay">
      <div class="message-modal-content">
        <h3>{{ messageModalTitle }}</h3>
        <p>{{ messageModalContent }}</p>
        <div class="modal-buttons" v-if="messageModalType === 'confirmDelete'">
            <button @click="executeDeleteMeeting" class="confirm-button">삭제</button>
            <button @click="closeMessageModal" class="cancel-button">취소</button>
        </div>
        <button v-else @click="closeMessageModal" class="ok-button">확인</button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "PastMeetingList",
  props: {
    recordings: { // App.vue에서 전달받을 recordings prop
      type: Array,
      default: () => []
    }
  },
  emits: ['delete-recording', 'update-recording-filename'], // 삭제 및 이름 수정 이벤트 추가

  data() {
    return {
      meetings: [], // recordings prop을 기반으로 생성될 회의 목록
      editingMeetingId: null, // 현재 수정 중인 회의의 ID
      editedFilename: '', // 수정 중인 파일명
      
      // Custom Message Modal 상태
      showMessageModal: false,
      messageModalTitle: '',
      messageModalContent: '',
      messageModalType: '', // 'info' or 'confirmDelete'
      pendingDeleteId: null, // 삭제 대기 중인 항목의 ID
    };
  },
  watch: {
    recordings: {
      immediate: true, // 컴포넌트 마운트 시 즉시 실행
      handler(newRecordings) {
        // 최신순으로 정렬
        const sortedRecordings = [...newRecordings].sort((a, b) => {
          return new Date(b.timestamp) - new Date(a.timestamp); // 내림차순 정렬 (최신이 위로)
        });

        this.meetings = sortedRecordings.map((rec) => {
          const audioUrl = rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null;
          const date = new Date(rec.timestamp);
          return {
            id: rec.id, // App.vue에서 전달받은 고유 ID 사용
            title: rec.filename || `회의 녹음본 ${date.toLocaleString()}`, // 파일명이 있으면 파일명 사용, 없으면 기존 방식 사용
            date: date.toLocaleString(),
            audioUrl: audioUrl,
            originalTimestamp: rec.timestamp, // 파일 이름 생성을 위해 원본 타임스탬프 저장
            audioBlob: rec.audioBlob // 필요시 Blob 자체도 보관 (여기서는 audioUrl만 사용해도 됨)
          };
        });
      }
    }
  },
  methods: {
    getFileName(meeting) {
      // 다운로드 시 사용할 파일 이름 생성 (기본적으로는 title 사용, 없으면 timestamp 기반)
      const baseName = meeting.title.replace(/[\\/:*?"<>|]/g, '_'); // 파일명으로 사용할 수 없는 문자 제거
      return `${baseName}.webm`; // webm 확장자 사용
    },
    
    // 녹음본 삭제 확인 모달 표시
    confirmDeleteMeeting(id, title) {
        this.pendingDeleteId = id;
        this.displayMessageModal('녹음본 삭제', `'${title}' 녹음본을 삭제하시겠습니까?`, 'confirmDelete');
    },

    // 실제 녹음본 삭제 로직
    executeDeleteMeeting() {
        if (this.pendingDeleteId) {
            this.$emit('delete-recording', this.pendingDeleteId);
            this.closeMessageModal();
            this.displayMessageModal('삭제 완료', '녹음본이 삭제되었습니다.');
        }
    },

    // 파일명 수정 모드 시작
    startEditingFilename(meeting) {
      // 이미 수정 모드라면 다시 시작하지 않음
      if (this.editingMeetingId === meeting.id) {
        return;
      }
      this.editingMeetingId = meeting.id;
      this.editedFilename = meeting.title; // 현재 제목을 편집 필드에 로드
      this.$nextTick(() => {
        // 입력 필드에 포커스
        const input = this.$el.querySelector('.filename-edit-input');
        if (input) {
          input.focus();
          input.select(); // 텍스트 전체 선택
        }
      });
    },

    // 파일명 수정 저장
    saveEditedFilename(id) {
      // 수정 중인 항목이 아니라면 저장하지 않음 (blur 이벤트 중복 방지 등)
      if (this.editingMeetingId !== id) {
        return;
      }

      const originalMeeting = this.meetings.find(m => m.id === id);
      const originalFilename = originalMeeting ? originalMeeting.title : '';
      const newFilenameTrimmed = this.editedFilename.trim();

      if (newFilenameTrimmed === '') {
        this.displayMessageModal('이름 변경 실패', '파일 이름은 비워둘 수 없습니다.');
        // 기존 이름으로 되돌리기
        this.editedFilename = originalFilename;
        this.editingMeetingId = null; // 수정 모드 종료
        return;
      }
      
      // 파일 이름이 변경되지 않았거나 기존과 같은 경우에는 알림 팝업을 띄우지 않고 취소
      if (newFilenameTrimmed === originalFilename) {
        this.editingMeetingId = null; // 수정 모드 종료
        return; 
      }

      this.$emit('update-recording-filename', { id: id, newFilename: newFilenameTrimmed });
      this.editingMeetingId = null; // 수정 모드 종료
      this.displayMessageModal('이름 변경 완료', `녹음본 이름이 '${newFilenameTrimmed}'(으)로 변경되었습니다.`);
    },

    // Custom Message Modal (for errors/information) - replacing alert()
    displayMessageModal(title, content, type = 'info') {
      this.messageModalTitle = title;
      this.messageModalContent = content;
      this.messageModalType = type;
      this.showMessageModal = true;
    },

    closeMessageModal() {
      this.showMessageModal = false;
      this.messageModalTitle = '';
      this.messageModalContent = '';
      this.messageModalType = '';
      this.pendingDeleteId = null;
    }
  },
  // 컴포넌트가 언마운트될 때 생성된 Blob URL 해제
  beforeUnmount() {
    this.meetings.forEach(meeting => {
      if (meeting.audioUrl) {
        URL.revokeObjectURL(meeting.audioUrl);
      }
    });
  }
};
</script>

<style scoped>
.meeting-list {
  padding: 20px;
  max-width: 800px;
  margin: 20px auto;
  background-color: #f9f9f9;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}
h2 {
  text-align: center;
  color: #333;
  margin-bottom: 30px;
  font-size: 2em;
}
.meeting-item {
  margin-bottom: 20px;
  padding: 15px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  background-color: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
}
.meeting-info {
    display: flex;
    flex-direction: column;
    gap: 5px;
}
/* 클릭 가능한 제목 영역 스타일 */
.editable-title-area {
    cursor: pointer;
    padding: 5px; /* 클릭 영역을 좀 더 넓게 */
    border-radius: 4px;
    transition: background-color 0.2s ease;
}
.editable-title-area:hover {
    background-color: #f0f0f0; /* 호버 효과 */
}

.meeting-info h3 {
  margin: 0;
  color: #000000;
  font-size: 1.5em;
}
.meeting-info p {
  margin: 0;
  color: #515151;
  font-size: 0.9em;
}
.filename-edit-input {
    width: calc(100% - 20px); /* Adjust width to fit */
    padding: 8px 10px;
    border: 1px solid #007bff;
    border-radius: 4px;
    font-size: 1.2em;
    box-sizing: border-box;
}
.audio-player {
  width: 100%;
  margin-top: 10px;
  accent-color: red; /* 재생바 색상을 빨간색으로 변경 */
}
.meeting-actions {
    display: flex;
    gap: 10px; /* 버튼 간 간격 */
    margin-top: 10px;
}
.action-button {
  background-color: #007bff; /* 기본 버튼 색상 */
  color: white;
  padding: 8px 16px;
  text-decoration: none;
  border-radius: 5px;
  font-size: 0.9em;
  transition: background-color 0.2s ease;
  border: none;
  cursor: pointer;
}
.action-button.download {
  background-color: #28a745;
}
.action-button.download:hover {
  background-color: #218838;
}

.action-button.edit:hover {
  background-color: #e0a800;
}
.action-button.delete {
  background-color: #dc3545;
}
.action-button.delete:hover {
  background-color: #c82333;
}
.no-meetings-message {
  text-align: center;
  color: #999;
  font-size: 1.1em;
  padding: 50px 0;
}

/* Custom Message Modal Styles - Reused from RecorderPanel for consistency */
.message-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 30;
}

.message-modal-content {
  background-color: white;
  padding: 30px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  max-width: 400px;
  text-align: center;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.message-modal-content h3 {
  margin: 0;
  color: #333;
  font-size: 1.6em;
}

.message-modal-content p {
  margin: 0;
  color: #555;
  font-size: 1.1em;
  line-height: 1.5;
}

.modal-buttons {
    display: flex;
    justify-content: center;
    gap: 15px;
    margin-top: 10px;
}

.modal-buttons button, .ok-button {
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 1.1em;
  transition: background-color 0.2s ease;
}

.ok-button {
    background-color: #007bff;
    color: white;
}
.ok-button:hover {
    background-color: #0056b3;
}
.confirm-button {
    background-color: #dc3545;
    color: white;
}
.confirm-button:hover {
    background-color: #c82333;
}
.cancel-button {
    background-color: #6c757d;
    color: white;
}
.cancel-button:hover {
    background-color: #5a6268;
}
</style>
