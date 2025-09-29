// --- useAudioMeter ---
import { ref } from 'vue';

const shared = { ctx: null, analyser: null, data: null, src: null, raf: null };

export function useAudioMeter() {
	const volume = ref(0);

	function start(stream) {
		if (!stream) return; // 스트림이 없으면 바로 종료
		try {
			if (!shared.ctx) shared.ctx = new (window.AudioContext || window.webkitAudioContext)(); // AudioContext 생성
			if (shared.src) try { shared.src.disconnect(); } catch (err) { /* ignore */ } // 이전 소스 연결 해제
			shared.src = shared.ctx.createMediaStreamSource(stream); // 마이크 스트림을 MediaStreamSource로 변환
			shared.analyser = shared.ctx.createAnalyser(); // 분석기 생성
			shared.analyser.fftSize = 256; // FFT 크기 설정
			shared.data = new Uint8Array(shared.analyser.frequencyBinCount); // 빈도 데이터 배열 생성
			shared.src.connect(shared.analyser); // 오디오 파이프라인 연결

			// 애니메이션 루프로 주기적으로 레벨을 계산
			const loop = () => {
				try {
					shared.analyser.getByteFrequencyData(shared.data); // FFT 결과를 바이트 배열로 채움
					let sum = 0;
					for (let i = 0; i < shared.data.length; i++) sum += shared.data[i];
					const avg = sum / shared.data.length;
					volume.value = Math.min(100, Math.round((avg / 255) * 100));
				} catch (e) {
					volume.value = 0;
				}
				shared.raf = requestAnimationFrame(loop);
			};

			loop();
		} catch (e) {
			console.error('useAudioMeter.start', e);
		}
	}

	function stop() {
		try {
			if (shared.raf) { cancelAnimationFrame(shared.raf); shared.raf = null; } // RAF 해제
			if (shared.src) try { shared.src.disconnect(); } catch (err) { /* ignore */ } finally { shared.src = null; } // 소스 연결 해제
			volume.value = 0; // 표시값 초기화
		} catch (e) {
			console.error('useAudioMeter.stop', e);
		}
	}

	return { volume, start, stop, getSampleRate: () => (shared.ctx ? shared.ctx.sampleRate : null) };
}

// --- ManageRecord ---
import { watch, onMounted } from 'vue';


// 로컬메타데이터(localStorage) + IndexedDB(idbAudioStore)를 묶어
// 녹음 목록을 관리하는 composable을 제공합니다.
export const STORAGE_KEY = 'meetingRecordings'; // localStorage에 저장할 키

/**
 * Blob -> base64 문자열 변환
 * 간단히 FileReader를 사용하여 dataURL을 반환합니다.
 */
export async function blobToBase64(blob) {
	return new Promise((resolve, reject) => {
		const r = new FileReader();
		r.onload = () => resolve(r.result);
		r.onerror = reject;
		console.debug('blobToBase64: readAsDataURL');
		r.readAsDataURL(blob);
	});
}

/**
 * base64(dataURL) -> Blob 변환
 * dataURL 형식이 아니면 null을 반환합니다.
 */
export function base64ToBlob(base64, fallbackMime) {
	if (typeof base64 !== 'string') return null;
	const parts = base64.split(';base64,');
	if (parts.length < 2) return null;
	const mime = (parts[0].split(':')[1]) || fallbackMime || 'application/octet-stream';
	const bin = atob(parts[1]);
	const len = bin.length;
	const arr = new Uint8Array(len);
	for (let i = 0; i < len; i++) arr[i] = bin.charCodeAt(i);
	return new Blob([arr], { type: mime });
}

function gid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/**
 * useRecordings()
 * - recordings: 녹음 목록(ref 배열)
 * - addRecording({ audioBlob, filename, transcription })
 * - deleteRecording(id)
 * - updateRecordingFilename({ id, newFilename })
 *
 * 내부: localStorage에 메타를 저장하고 Blob은 idbAudioStore로 관리합니다.
 */
export function useRecordings() {
	const recordings = ref([]);
	let _saveTimer = null;
	const DEBOUNCE = 500;

	onMounted(async () => {
		try {
			// Load metadata only from localStorage. Audio blobs are not persisted in this rollback.
			const meta = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
			for (const item of meta) {
				recordings.value.push({
					id: item.id || gid(),
					timestamp: item.timestamp,
					audioBlob: null, // blob persistence disabled
					filename: item.filename,
					transcription: item.transcription || ''
				});
			}
		} catch (e) {
			localStorage.removeItem(STORAGE_KEY);
		}
	});

	watch(recordings, (newRecs) => {
		if (_saveTimer) clearTimeout(_saveTimer);
		_saveTimer = setTimeout(async () => {
			try {
				const meta = newRecs.map(r => ({ id: r.id, timestamp: r.timestamp, filename: r.filename, transcription: r.transcription || '' }));
				// audio blobs are not persisted to IndexedDB in this configuration
				localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
			} catch (e) {
				console.error('ManageRecord: save failed', e);
			}
		}, DEBOUNCE);
	}, { deep: true });

	function addRecording({ audioBlob, filename, transcription }) {
		const id = gid();
		const timestamp = new Date().toISOString();
		// Keep blob in memory only; metadata will be saved to localStorage by watcher
		recordings.value.push({ id, audioBlob, timestamp, filename: filename || `recording-${timestamp}`, transcription });
	}

	function deleteRecording(id) {
		recordings.value = recordings.value.filter(r => r.id !== id);
		// No persistent blob to delete when persistence is disabled
	}

	function updateRecordingFilename({ id, newFilename }) {
		recordings.value = recordings.value.map(r => r.id === id ? { ...r, filename: newFilename } : r);
	}

	return { recordings, addRecording, deleteRecording, updateRecordingFilename };
}

// idb helpers are inlined above to reduce file count
