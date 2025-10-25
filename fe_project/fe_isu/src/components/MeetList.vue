<template>
  <div class="meeting-list">
    <h2>지난 대화 목록</h2>

    <div
      v-for="meet in meets"
      :key="meet.id"
      class="meeting-item"
    >
      <div class="meeting-info">
        <input
          v-if="editMeetId === meet.id"
          type="text"
          v-model="editName"
          @keyup.enter="saveRename(meet.id)"
            @blur="saveRename(meet.id)"
          class="filename-edit-input"
        />
        <!-- 제목 눌러서 파일명 수정 -->
  <div v-else @click="startRename(meet)" class="editable-title-area">
          <h3>{{ meet.title }}</h3>
          <p>{{ meet.date }}</p>
        </div>
      </div>

      <!-- 재생바 -->
      <audio
        v-if="meet.audioUrl"
        :src="meet.audioUrl"
        controls
        class="audio-player"
      ></audio>

      <div class="meeting-actions">
        <!-- 다운로드 -->
        <a
          v-if="meet.audioUrl"
          :href="meet.audioUrl"
          :download="getAudioName(meet)"
          class="action-button download"
        >
          녹음 파일 다운로드
        </a>
        <!--미리보기 -->
        <button
          class="action-button text-preview"
          @click="viewText(meet)"
        >
          텍스트
        </button>
        <!-- 삭제 -->
        <button
          class="action-button delete"
          @click="confirmDelete(meet.id, meet.title)"
        >
          삭제
        </button>
      </div>
    </div>
    <p v-if="meets.length === 0" class="no-meetings-message">저장된 대화가 없습니다.</p>

    <div v-if="showTxtModal" class="transcription-modal-overlay">
      <div class="transcription-modal-content">
        <h3>{{ currentMeet.title }}</h3>

        <div v-if="!showTxtView && !showSum" class="initial-options">
          <div class="option-box view-full" @click="showFullTxt">
            <h4>전체 대화 보기</h4>
          </div>
          <div class="option-box summarize" @click="reqSum(currentMeet)">
            <div v-if="isSummarizing && summarizingMeetingId === currentMeet.id" class="loader"></div>
            <h4 v-else>요약하기</h4>
          </div>
        </div>

        
        <!-- Summary viewer (visuals kept as original) -->
        <div v-if="showSum" class="summary-viewer">
          <div class="summary-text-area">
            <p>{{ summaryText }}</p>
          </div>
          <div class="modal-buttons">
            <button class="prompt-button download" @click="downloadDisplayed">
              요약 다운로드 (.txt)
            </button>
          </div>
        </div>

        <!-- Full transcription viewer (visuals kept as original) -->
        <div v-if="showTxtView && !showSum" class="text-viewer">
          <div class="transcription-text-area">
            <p>{{ currentTxt }}</p>
          </div>
          <div class="modal-buttons">
            <button class="prompt-button download" @click="downloadDisplayed">
              파일로 다운로드 (.txt)
            </button>
          </div>
        </div>
        <!-- modal bottom action button (restore original behavior) -->
        <button 
          class="prompt-button cancel"
          @click="showTxtView || showSum ? goBack() : closeTxtModal()"
        >
          {{ showTxtView || showSum ? '뒤로 가기' : '닫기' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script>
export default {
  name: "MeetList",
  props: {
    records: {
      type: Array,
      default: () => []
    },
    isSummarizing: {
      type: Boolean,
      default: false
    },
    summarizingMeetingId: {
      type: [String, Number],
      default: null
    },
    summaryText: {
      type: String,
      default: ''
    },
    showSummary: {
      type: Boolean,
      default: false
    }
  },
  emits: ['delRec', 'updateRecName', 'reqSum', 'closeSum'], // 이벤트 목록

  data() {
      return {
        meets: [],
        editMeetId: null,
        editName: '',
        showTxtModal: false,
        currentTxt: '',
        currentTxtName: '',
        showTxtView: false,
        currentMeet: null,
        showSum: this.showSummary,
      };
    },
    watch: {
      showSummary(newVal) {
        this.showSum = newVal;
      },
      records: {
        immediate: true,
        handler(newRecs) {
    // 녹음 목록 갱신
    console.log('프: MeetList - 목록 갱신. 수:', newRecs.length);
  
    // 시간순 정렬
          const sortedRecs = [...newRecs].sort((a, b) => {
            return new Date(b.timestamp) - new Date(a.timestamp); 
          });
  
          this.meets = sortedRecs.map((rec) => {
            const audioUrl = rec.audioBlob ? URL.createObjectURL(rec.audioBlob) : null;
            const date = new Date(rec.timestamp);
            const meetItem = {
              id: rec.id,
              title: rec.filename || `녹음본 ${date.toLocaleString()}`,
              date: date.toLocaleString(),
              audioUrl: audioUrl,
  
              originalTimestamp: rec.timestamp, 
              audioBlob: rec.audioBlob, 
              transcription: rec.transcription || '텍스트 변환 결과 없음',
              summary: rec.summary || ''
            };
            console.log(`프: MeetList - 항목 매핑 ID:${meetItem.id} 전사 길이:${(meetItem.transcription||'').length}`);
            return meetItem;
          });
        }
      }
    },
    methods: {
    // 다운로드 이름 생성
      getAudioName(meet) {
        // inside a character class only - and ] and ^ and \\
        // need escaping; other backslashes were unnecessary
      const baseName = meet.title.replace(/[\\/:*?"<>|]/g, '_').replace(/\[/g, '_').replace(/\]/g, '_');
        return `${baseName}.webm`;
      },
      
    // 삭제 확인창
      confirmDelete(id, title) {
        if (window.confirm(`'${title}' 녹음본을 삭제하시겠습니까?`)) {
          this.$emit('delRec', id);
          window.alert('녹음본이 삭제되었습니다.');
        }
      },
  
    // 이름 편집 시작
      startRename(meet) {
        if (this.editMeetId === meet.id) return;
        this.editMeetId = meet.id;
        this.editName = meet.title;
        this.$nextTick(() => {
          const input = this.$el.querySelector('.filename-edit-input');
          if (input) { input.focus(); input.select(); }
        });
      },
  
    // 이름 편집 저장
      saveRename(id) {
        if (this.editMeetId !== id) return;
        const original = this.meets.find(m => m.id === id);
        const origName = original ? original.title : '';
        const newName = this.editName.trim();
        if (newName === '') {
          window.alert('파일 이름은 비울 수 없습니다.');
          this.editName = origName; this.editMeetId = null; return;
        }
        if (newName === origName) { this.editMeetId = null; return; }
        this.$emit('updateRecName', { id: id, newName: newName });
        this.editMeetId = null;
        window.alert(`녹음본 이름이 '${newName}'(으)로 변경되었습니다.`);
      },
  
    // 텍스트 보기
      viewText(meet) {
        if (!meet.transcription || meet.transcription === '텍스트 변환 결과 없음' || meet.transcription.trim() === '') {
          window.alert('변환된 텍스트가 없습니다.');
          return;
        }
        this.currentMeet = meet;
        this.currentTxt = meet.transcription;
  // Keep only necessary escapes inside the character class
      this.currentTxtName = `${meet.title.replace(/[\\/:*?"<>|]/g, '_').replace(/\[/g, '_').replace(/\]/g, '_')}.txt`;
        this.showTxtView = false;
        this.showTxtModal = true;
      },
  
    // 전체 텍스트 보기
      showFullTxt() {
        this.showTxtView = true;
      },
  
    // 텍스트 파일 다운
      downloadTxt() {
        if (!this.currentTxt) {
          window.alert('다운로드할 텍스트 내용이 없습니다.');
          return;
        }
  
        const textBlob = new Blob([this.currentTxt], { type: 'text/plain;charset=utf-8' });
        
        const link = document.createElement('a');
        link.href = URL.createObjectURL(textBlob);
        link.download = this.currentTxtName;
        link.click();
        URL.revokeObjectURL(link.href);
        
        window.alert(`'${this.currentTxtName}' 텍스트 파일이 다운로드되었습니다.`);
      },

      // 요약 파일 다운로드
      downloadSummary() {
        const text = this.summaryText || (this.currentMeet && this.currentMeet.summary) || '';
        if (!text || String(text).trim() === '') {
          window.alert('다운로드할 요약문이 없습니다.');
          return;
        }

        const safeName = (this.currentMeet && this.currentMeet.title)
          ? this.currentMeet.title.replace(/[\\/:*?"<>|]/g, '_').replace(/\[/g, '_').replace(/\]/g, '_')
          : 'summary';
        const fileName = `${safeName}_summary.txt`;

        const textBlob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(textBlob);
        link.download = fileName;
        link.click();
        URL.revokeObjectURL(link.href);

        window.alert(`'${fileName}' 요약 파일이 다운로드되었습니다.`);
      },
  
    // 텍스트 모달 닫기
      closeTxtModal() {
        this.showTxtModal = false;
        this.currentTxt = '';
        this.currentTxtName = '';
        this.showTxtView = false;
      },
  
    // 뒤로가기
      goBack() {
        this.showTxtView = false;
        this.showSum = false;
        // notify parent to close summary and clear any parent-held summary state
        this.$emit('closeSum');
      },
    // 요약 요청
      reqSum(meet) {
        // prefer explicit argument but fallback to currentMeet
        this.$emit('reqSum', meet || this.currentMeet);
      },
      // Unified download handler used by both viewers
      downloadDisplayed() {
        if (this.showSum) {
          this.downloadSummary();
          return;
        }
        if (this.showTxtView) {
          this.downloadTxt();
          return;
        }
        window.alert('다운로드할 내용이 없습니다.');
      },
    },
    beforeUnmount() {
    this.meets.forEach(meet => {
      if (meet.audioUrl) {
        URL.revokeObjectURL(meet.audioUrl);
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
/* 제목수정용으로추가함*/
.editable-title-area {
    cursor: pointer;
    padding: 5px; 
    border-radius: 4px;
    transition: background-color 0.2s ease;
}
.editable-title-area:hover {
    background-color: #f0f0f0;
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
    width: calc(100% - 20px);
    padding: 8px 10px;
    border: 1px solid #007bff;
    border-radius: 4px;
    font-size: 1.2em;
    box-sizing: border-box;
}
.audio-player {
  width: 100%;
  margin-top: 10px;
  accent-color: red;
}
.meeting-actions {
    display: flex;
    gap: 10px; 
    margin-top: 10px;
}
.action-button {
  background-color: #007bff; 
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
.action-button.text-preview {
  background-color: #007bff;
}
.action-button.text-preview:hover {
  background-color: #0056b3;
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
  z-index: 1050;
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

.message-modal-content .modal-buttons {
    display: flex;
    justify-content: center;
    gap: 15px;
    margin-top: 10px;
    width: 100%;
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

/*텍스트미리보기*/
.transcription-modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1050;
  padding: 20px;
  box-sizing: border-box;
}

.transcription-modal-content {
  background-color: white;
  padding: 24px;
  border-radius: 12px;
  box-shadow: 0 5px 20px rgba(0, 0, 0, 0.4);
  width: 100%;
  max-width: 800px;
  height: 80vh;
  max-height: 90%;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.transcription-modal-content h3 {
    margin: 0;
    padding-bottom: 16px;
    border-bottom: 1px solid #e0e0e0;
    text-align: center;
    font-size: 1.5em;
    color: #333;
    flex-shrink: 0;
}

.initial-options {
    flex-grow: 1;
    display: flex;
    gap: 20px;
    overflow: hidden;
}

.option-box {
    flex: 1;
    display: flex;
    justify-content: center;
    align-items: center;
    border-radius: 12px;
    cursor: pointer;
    transition: background-color 0.3s ease;
    color: white;
}

.option-box.view-full {
    background-color: #007bff;
}
.option-box.view-full:hover {
    background-color: #0056b3;
}

.option-box.summarize {
    background-color: #ff9800;
}
.option-box.summarize:hover {
    background-color: #f57c00;
}

.option-box h4 {
    font-size: 1.8em;
    margin: 0;
}

.summary-viewer {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
}

.summary-text-area {
  flex-grow: 1;
  overflow-y: auto;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  line-height: 1.6;
  color: #333;
}

.summary-text-area p {
  margin: 0;
  white-space: pre-wrap;
}

.text-viewer {
    flex-grow: 1;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow: hidden;
}

.transcription-text-area {
  flex-grow: 1;
  overflow-y: auto;
  background-color: #f9f9f9;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 16px;
  line-height: 1.6;
  color: #333;
}

.transcription-text-area p {
  margin: 0;
  white-space: pre-wrap;
}

.text-viewer .modal-buttons {
  display: flex;
  width: 100%;
  justify-content: center;
  flex-shrink: 0;
}

.prompt-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: 8px;
  border: none;
  width: 100%;
  font-size: 1.1em;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s ease;
  color: white;
}

.prompt-button.download {
  position: relative;
  background-color: #4CAF50;
}
.prompt-button.download:hover {
  background-color: #45a049;
}

.transcription-modal-content > .prompt-button.cancel {
  background-color: #6c757d;
  flex-shrink: 0;
  margin-top: auto;
}
.prompt-button.cancel:hover {
  background-color: #5a6268;
}

.loader {
  border: 4px solid #f3f3f3;
  border-top: 4px solid #3498db;
  border-radius: 50%;
  width: 40px;
  height: 40px;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
</style>


