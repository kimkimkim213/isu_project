const express = require('express');
const cors = require('cors');

const { GoogleGenerativeAI } = require('@google/generative-ai');//전사본 요약용 API
const { SpeechClient } = require('@google-cloud/speech');//음성인식용 API

const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();

// Helper: send standardized, user-friendly error responses while logging internal details
function sendError(res, status, userMessage, code, internalErr) {
  try {
    if (internalErr) {
      console.error('백: 내부 오류 상세:', internalErr && internalErr.stack ? internalErr.stack : internalErr);
    }
  } catch (e) {
    console.error('백: sendError 로그 중 오류:', e);
  }

  const payload = { success: false, message: userMessage || '문제가 발생했습니다. 잠시 후 다시 시도해주세요.' };
  if (code) payload.code = code;
  return res.status(status || 500).json(payload);
}

// 전역 예외 처리
process.on('uncaughtException', (err) => {
  console.error('백: uncaughtException 발생:', err && err.stack ? err.stack : err);
});//동기 처리중 예외 발생시
process.on('unhandledRejection', (reason, p) => {
  console.error('백: unhandledRejection 발생 - reason:', reason, 'promise:', p);
});//비동기 처리중 예외 발생시


require('dotenv').config();

const feEnvPath = path.join(__dirname, 'fe_isu', '.env');
if (!process.env.GOOGLE_API_KEY && fs.existsSync(feEnvPath)) {
  require('dotenv').config({ path: feEnvPath });
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  const gac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (gac && !path.isAbsolute(gac)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, gac);
  }
  console.log('백: GOOGLE_APPLICATION_CREDENTIALS normalized to', process.env.GOOGLE_APPLICATION_CREDENTIALS);
}

// PORT 번호 설정 - 기본값 3001
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// 전역 클라이언트 생성 (간단하게)
let genAI = null;
let speechClient = null;

// genAI 초기화
if (process.env.GOOGLE_API_KEY) {
  try {
    genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
  } catch (err) {
    console.error('백: genAI 초기화 오류:', err && err.message ? err.message : err);
    genAI = null;
  }
} else {
  console.warn('백: 환경변수(GOOGLE_API_KEY) 설정되지 않음 - 요약 기능 사용 불가');
}

// SpeechClient 생성 시도
function createSpeechClient() {
  try {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (keyPath && fs.existsSync(keyPath) && fs.statSync(keyPath).isFile()) {
      console.log('백: SpeechClient initialized from keyFilename:', keyPath);
      return new SpeechClient({ keyFilename: keyPath });
    }
    console.log('백: SpeechClient initialized using Application Default Credentials (ADC)');
    return new SpeechClient();
  } catch (e) {
    console.error('백: SpeechClient 생성 중 오류:', e && e.message ? e.message : e);
    throw e;
  }
}

speechClient = createSpeechClient();

app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
//파싱 처리 제한 - 50MB

// 응답 포맷 래퍼 미들웨어: 모든 성공 응답을 표준화합니다.
app.use((req, res, next) => {
  // 원본 json 저장
  const _json = res.json.bind(res);

  res.json = function (payload) {
    try {
      // 이미 표준 형태이면 그대로 반환
      if (payload && typeof payload === 'object' && (Object.prototype.hasOwnProperty.call(payload, 'success') || Object.prototype.hasOwnProperty.call(payload, 'error'))) {
        return _json(payload);
      }

      // 기본적으로 성공 응답으로 포장
      return _json({ success: true, data: payload });
    } catch (e) {
      // 포장 중 에러 발생 시 원본 동작 호출
      console.error('백: 응답 포맷 래퍼 중 오류:', e);
      return _json(payload);
    }
  };

  next();
});

// JSON 파싱 오류 처리
app.use((err, req, res, next) => {
  if (err && (err instanceof SyntaxError || err.type === 'entity.parse.failed')) {
    console.error('백: JSON 파싱 오류:', err.message);
    return sendError(res, 400, '유효하지 않은 요청입니다. 전송한 데이터를 확인해주세요.', 'INVALID_JSON', err);
  }
  next(err);
});

//클라이언트 데이터 수신용 파일 생성
const UP_DIR = path.join(__dirname, 'fe_isu', 'uploads'); //업로드 디렉토리 설정
// 디렉토리 없으면 생성
try { fs.mkdirSync(UP_DIR, { recursive: true }); }
catch (e) {
  // 실패를 조용히 무시하지 않고 기록한 뒤 예외를 전파합니다.
  console.error('백: 업로드 폴더 생성 실패:', e && e.message ? e.message : e);
  throw e;
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UP_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
// multer 제한 설정 - >=50MB, 오디오 파일만 허용
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['audio/webm', 'audio/wav', 'audio/x-wav', 'audio/mpeg', 'audio/ogg', 'audio/opus'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('허용되지 않는 파일 형식입니다. 오디오 파일만 업로드하세요.'));
  }
});
app.use('/uploads', express.static(UP_DIR));

// 요약 요청 처리
app.post('/api/summarize', async (req, res) => {
  try { // 요약 시도
    const { text } = req.body;//요약할 텍스트
    if (!text) {
      return sendError(res, 400, '요약할 텍스트가 없습니다.', 'NO_SUMMARY_TEXT');
    }
    if (!genAI) {
      return sendError(res, 500, '요약 기능을 사용할 수 없습니다. 관리자에게 문의하세요.', 'SUMMARIZE_NOT_READY');
    }
    // 요약 AI 모델 호출 처리
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-pro" });
    const prompt = `요약문을 제외한 다른 반응이나 말은 모두 출력하지 말고,이 다음에 주어지는 대화의 전문을 핵심을 꼽아 요약해줘. / 대화: ${text}`;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const summary = response.text();
    res.json({ summary });//요약문 반환
    } catch (error) {
    console.error('백: 요약 오류:', error);
    return sendError(res, 500, '요약에 실패했습니다. 잠시 후 다시 시도해주세요.', 'SUMMARIZE_FAILED', error);
  }
});

// 음성 전사 처리
app.post('/api/transcribe', upload.single('audio'), async (req, res) => {
  if (!speechClient) return sendError(res, 500, '음성 인식 서비스를 사용할 수 없습니다.', 'STT_NOT_READY');
  if (!req.file) return sendError(res, 400, '업로드된 오디오 파일이 없습니다. 파일을 다시 확인해주세요.', 'MISSING_FILE');

  const startTime = Date.now();
  const fp = req.file.path;
  const mimeType = req.file.mimetype || 'audio/webm';

  try {
    const audioBuffer = await fs.promises.readFile(fp);
    const sampleRate = req.body.sampleRate ? Number(req.body.sampleRate) : 16000;

    console.log('백: 전사 요청 수신 - 파일:', req.file.originalname, '크기:', audioBuffer.length, '샘플레이트:', sampleRate, 'MIME:', mimeType);

    const audio = { content: audioBuffer.toString('base64') };
    let encoding = 'ENCODING_UNSPECIFIED';
    if (mimeType.includes('webm')) encoding = 'WEBM_OPUS';
    else if (mimeType.includes('wav')) encoding = 'LINEAR16';

    const config = {
      encoding,
      sampleRateHertz: sampleRate || 16000,
      languageCode: 'ko-KR',
      enableSpeakerDiarization: true,
      diarizationSpeakerCount: 'auto',
    };

    const callStart = Date.now();
    // 음성 인식 요청
    const [operation] = await speechClient.longRunningRecognize({ audio, config });
    const [response] = await operation.promise();
    //응답 처리
    if (!response || !response.results || response.results.length === 0) {
      console.warn('백: STT가 결과를 반환하지 않음');
      return sendError(res, 502, '음성 인식 결과를 받을 수 없습니다. 잠시 후 다시 시도해주세요.', 'STT_NO_RESULT');
    }
    // 전사 결과 종합
    const transcription = (response.results || [])
      .map(r => (r.alternatives && r.alternatives[0]) ? r.alternatives[0].transcript : '')
      .filter(Boolean)
      .join('\n');

    if (!transcription || transcription.trim().length === 0) {
      console.warn('백: STT 결과가 비어 있음');
      return sendError(res, 502, '음성 인식 결과를 받을 수 없습니다. 잠시 후 다시 시도해주세요.', 'STT_EMPTY_RESULT');
    }
    //전사 결과 반환
    console.log('백: 전사 완료 — 문자 길이:', transcription.length, '처리시간(ms):', Date.now() - startTime);
    return res.json({ transcription });
  } catch (error) {
    console.error('백: 전사 오류:', error);
    return sendError(res, 500, '음성 전사 중 오류가 발생했습니다. 나중에 다시 시도해주세요.', 'TRANSCRIBE_FAILED', error);
  } finally {
    // 임시 파일은 항상 시도해서 삭제 — 실패 시 예외가 상위로 전파됩니다
    await fs.promises.unlink(fp);
  }
});

// 업로드 앤드포인트
app.post('/api/upload', upload.single('audio'), (req, res) => {
  try {
    if (!req.file) return sendError(res, 400, '업로드된 파일이 없습니다. 파일을 확인해주세요.', 'NO_FILE');
    const url = `http://localhost:${PORT}/uploads/${req.file.filename}`;//업로드된 파일URL 생성
    console.log('백: 업로드 완료 URL:', url);//업로드된 파일 URL 표시
    res.json({ url });//URL 반환
  } catch (e) {
    console.error('백: 업로드 오류:', e);
    return sendError(res, 500, '파일 업로드에 실패했습니다. 잠시 후 다시 시도해주세요.', 'UPLOAD_FAILED', e);
  }
});

// Multer 전용 에러 핸들러: 업로드 관련 에러를 명확히 처리
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('백: Multer 오류:', err.code, err.message);
    return sendError(res, 400, '파일 업로드 중 오류가 발생했습니다. 업로드한 파일을 확인해주세요.', err.code || 'MULTER_ERROR', err);
  }
  next(err);
});

// 중앙 에러 미들웨어: 라우트/비동기에서 발생한 에러를 한곳에서 처리합니다.
app.use((err, req, res, next) => {
  // 의도적으로 에러를 조용히 무시하지 않음 — 로그 후 표준 에러 응답 반환
  console.error('백: 중앙 에러 처리:', err && err.stack ? err.stack : err);

  const status = err && err.status ? err.status : 500;
  const message = err && err.message ? err.message : '서버 오류';
  const details = (process.env.NODE_ENV === 'production') ? undefined : (err && (err.details || err.message || String(err)));

  const payload = { success: false, message };
  if (details) payload.details = details;

  res.status(status).json(payload);
});


// 서버 시작 - 포트가 사용 중일 때 자동으로 다음 포트로 재시도
function startServer(port, attemptsLeft = 5) {
  const server = app.listen(port, () => {
    console.log(`백: 서버 실행 중: http://localhost:${port}`);
  });

  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`백: 포트 ${port} 사용 중(EADDRINUSE)`);
      if (attemptsLeft > 1) {
        const nextPort = port + 1;
        console.log(`백: 포트 ${nextPort}으로 재시도합니다... (${attemptsLeft - 1}회 남음)`);
        // 약간의 지연 후 재시도
        setTimeout(() => startServer(nextPort, attemptsLeft - 1), 200);
      } else {
        console.error('백: 사용 가능한 포트를 찾지 못했습니다. 프로세스를 종료합니다.');
        process.exit(1);
      }
    } else {
      console.error('백: 서버 시작 중 오류:', err);
      process.exit(1);
    }
  });
}

startServer(PORT);
