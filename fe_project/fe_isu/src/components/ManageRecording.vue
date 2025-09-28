<template>
  <div class="manage-recording">
    <recorder-panel @recording-finished="handleRecordingComplete"></recorder-panel>
    <past-meeting-list 
      :recordings="recordings" 
      @delete-recording="deleteRecording"
      @update-recording-filename="updateRecordingFilename">
    </past-meeting-list>
  </div>
</template>

<script>
import RecorderPanel from './RecorderPanel.vue';
import PastMeetingList from './PastMeetingList.vue';
import { useRecordings } from '@/conposable';
import { ref } from 'vue';

export default {
  name: 'ManageRecording',
  components: {
    RecorderPanel,
    PastMeetingList
  },
  setup() {
    const { recordings, addRecording, deleteRecording, updateRecordingFilename } = useRecordings();
    const error = ref(null);

    const handleRecordingComplete = ({ audioBlob, filename, transcription }) => {
      console.log('ManageRecording: recording-finished 이벤트 수신. 전사 결과:', transcription);
      addRecording({
        audioBlob: audioBlob,
        filename: filename,
        transcription: transcription
      });
    };

    return {
      recordings,
      deleteRecording,
      updateRecordingFilename,
      handleRecordingComplete,
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
