const express = require('express');
const cors = require('cors');

const { GoogleGenerativeAI } = require('@google/generative-ai');//전사본 요약용 API
const { SpeechClient } = require('@google-cloud/speech');//음성인식용 API

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();

// 전역 예외/비동기 거부 로깅 (디버그용)
process.on('uncaughtException', (err) => {
  console.error('백: uncaughtException 발생:', err && err.stack ? err.stack : err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('백: unhandledRejection 발생 - reason:', reason, 'promise:', p);
});

// .env 로드: 우선 현재 작업 디렉터리의 .env, 없거나 핵심 키가 비어있으면 fe_isu/.env 시도
require('dotenv').config();
if (!process.env.GOOGLE_API_KEY || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  require('dotenv').config({ path: path.join(__dirname, 'fe_isu', '.env') });
}

// PORT은 .env(또는 환경 변수)에서 우선적으로 가져오되 기본값 3001 사용
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 전역 클라이언트(요청마다 생성하지 않고 재사용)
let genAI = null;
let speechClient = null;
try {
  if (process.env.GOOGLE_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  } else {
    console.warn('백: GOOGLE_API_KEY가 설정되지 않음 - 요약 기능 비활성화됨');
  }
} catch (e) {
  console.error('백: genAI 초기화 실패:', e && e.message ? e.message : e);
  genAI = null;
}
try {
  // ADC 사용: GOOGLE_APPLICATION_CREDENTIALS 등 환경에 따라 자동 인증
  speechClient = new SpeechClient();
} catch (e) {
  console.error('백: SpeechClient 초기화 실패:', e && e.message ? e.message : e);
  speechClient = null;
}

app.use(cors()); // 모든 도메인 허용
// 내장된 express 파서 사용
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// JSON 파싱 오류를 명확히 처리하는 에러 핸들러
app.use((err, req, res, next) => {
  if (err && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
    console.error('백: JSON 파싱 오류:', err.message);
    return res.status(400).json({ error: '유효하지 않은 JSON 요청' });
  }
  next(err);
});

// 업로드 디렉터리를 'fe_isu/uploads'로 설정
const UP_DIR = path.join(__dirname, 'fe_isu', 'uploads');
// 디렉터리 없으면 생성
try { fs.mkdirSync(UP_DIR, { recursive: true }); } catch (e) { console.warn('백: 업로드 폴더 생성 실패(무시):', e.message); }
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });
app.use('/uploads', express.static(UP_DIR));

// 요약 요청 처리
app.post('/api/summarize', async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: '요약할 텍스트가 없습니다.' });
    }
    // 전역 genAI 사용 여부 확인
    if (!genAI) {
      return res.status(500).json({ error: '요약 엔진이 초기화되지 않았습니다. 환경변수를 확인하세요.' });
    }
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `요약문을 제외한 다른 반응이나 말은 모두 출력하지 말고,이 다음에 주어지는 대화의 전문을 핵심을 꼽아 체계적으로 요약해줘. / 대화: ${text}`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();
    res.json({ summary });
    } catch (error) {
    console.error('백: 요약 오류:', error);
    res.status(500).json({ error: '요약 실패', 사유: error && error.message ? error.message : String(error) });
  }
});

// 음성 전사 처리
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  try {
    // 전역 SpeechClient 사용 여부 확인
    if (!speechClient) {
      return res.status(500).json({ error: '음성인식 클라이언트가 초기화되지 않았습니다. 환경변수를 확인하세요.' });
    }
    const startTime = Date.now();
    // 기본 메타데이터
    const contentType = req.headers['content-type'] || '';
    const contentLength = req.get('content-length') || '';
    console.log('백: /api/transcribe 요청 수신 - content-type:', contentType, 'content-length:', contentLength);

    let audioBuffer = null;
    let sampleRate = null;
    let mimeType = null;

    if (!req.file) {
      return res.status(400).json({ error: '오디오 파일이 필요합니다.' });
    }

      const fp = req.file.path;
      mimeType = req.file.mimetype || 'audio/webm';
      try {
        // 파일 읽기
        audioBuffer = await fs.promises.readFile(fp);
        console.log('백: 업로드된 파일 읽음:', fp);
        console.log('백: 파일 메타 - originalname:', req.file.originalname, 'mimetype:', mimeType, 'size:', audioBuffer.length);
        try { console.log('백: 파일 바이트(선두 64 바이트, hex):', audioBuffer.slice(0, 64).toString('hex')); } catch (e) { console.warn('백: 파일 바이트 출력 실패(무시):', e && e.message ? e.message : e); }
      } catch (e) {
        console.error('백: 업로드 파일 읽기 오류:', e);
        return res.status(500).json({ error: '파일 처리 실패', details: e.message });
      } finally {
        // 파일 삭제, 실패 시 경고만 남김
        fs.promises.unlink(fp).catch(err => console.warn('백: 업로드 임시파일 삭제 실패(무시):', err && err.message ? err.message : err));
      }
      sampleRate = req.body.sampleRate ? Number(req.body.sampleRate) : 16000;

    console.log('백: 수신된 오디오 버퍼 크기:', audioBuffer.length, '바이트');
    console.log(`백: 수신된 오디오 속성: 샘플레이트=${sampleRate}, MIME=${mimeType}`);

  const audio = { content: audioBuffer.toString('base64') };

  // MIME 타입을 STT 인코딩으로 매핑
  // WAV(16-bit PCM)는 LINEAR16 사용
  let encoding = 'ENCODING_UNSPECIFIED';
  if (mimeType && mimeType.includes('webm')) {
    encoding = 'WEBM_OPUS';
  } else if (mimeType && mimeType.includes('wav')) {
  // Speech API용 PCM WAV 인코딩 설정
  encoding = 'LINEAR16';
  }

  // sampleRate 숫자 보장, 기본 16000
  if (!sampleRate || typeof sampleRate !== 'number' || Number.isNaN(sampleRate)) {
    sampleRate = 16000;
  }

    const config = {
      encoding: encoding,
      sampleRateHertz: sampleRate,
      languageCode: 'ko-KR',
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 2
    };

    console.log('백: Google 전송 설정:', JSON.stringify(config, null, 2));
    // 모든 오디오에 대해 longRunningRecognize 사용(동기 recognize 제거)
    let response;
    const callStart = Date.now();
    console.log('백: longRunningRecognize 호출시작, bytes:', audioBuffer.length);
    const [operation] = await speechClient.longRunningRecognize({ audio, config });
    const [opResponse] = await operation.promise();
    response = opResponse;
    const callDur = Date.now() - callStart;
    console.log('백: Google longRunningRecognize 완료 (ms):', callDur);
  try { console.log('백: Google STT 응답 요약:', JSON.stringify(response, ['results','alternatives','transcript'], 2).slice(0,2000)); } catch (e) { console.warn('백: STT 응답 요약 출력 실패(무시):', e && e.message ? e.message : e); }

    const transcription = (response.results || [])
      .map(result => (result.alternatives && result.alternatives[0]) ? result.alternatives[0].transcript : '')
      .filter(t => t)
      .join('\n');

    const totalDur = Date.now() - startTime;
    console.log('백: 전사 완료 — 전사문자 길이:', transcription.length, '처리시간(ms):', totalDur);

    res.json({ transcription });
  } catch (error) {
    console.error('백: 전사 오류:', error);
    res.status(500).json({ error: '전사 실패', details: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`백: 서버 실행 중: http://localhost:${PORT}`);
});

// 간단한 업로드 엔드포인트: form-data 파일 필드명 'audio' 사용
app.post('/api/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '파일 없음' });
    const url = `http://localhost:${PORT}/uploads/${req.file.filename}`;
    console.log('백: 업로드 완료 URL:', url);
    res.json({ url });
  } catch (e) {
    console.error('백: 업로드 오류:', e);
    res.status(500).json({ error: '업로드 실패', details: e.message });
  }
});
