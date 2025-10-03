<template>
  <div class="manage-recording">
  <recorder-panel @recording-finished="onRecordingComplete"></recorder-panel>
    <past-meeting-list 
      :recordings="recordings" 
      @delete-recording="deleteRecording"
      @update-filename="updateRecordingFilename">
    </past-meeting-list>
  </div>
</template>

<script>
import RecorderPanel from './RecorderPanel.vue';
import PastMeetingList from './PastMeetingList.vue';
import { useRecs } from '@/conposable';
import { ref } from 'vue';

export default {
  name: 'ManageRecording',
  components: {
    RecorderPanel,
    PastMeetingList
  },
  setup() {
  const { recordings, addRecording, deleteRecording, renameRecording } = useRecs();
    const error = ref(null);

    // 한 줄 주석: RecorderPanel에서 전달된 녹음 데이터 처리
    // 녹음 완료 이벤트 수신
    const onRecordingComplete = ({ audioBlob, filename, transcription }) => {
      console.log('ManageRecording: recording-finished 이벤트 수신. 전사 결과:', transcription);
      addRecording({ audioBlob, filename, transcription });
    };

    return {
      recordings,
      deleteRecording,
        updateRecordingFilename: renameRecording,
        onRecordingComplete,
      error
    };
  }
};
</script>

<style scoped>
.manage-recording {
  padding: 20px;
}
</style>
