import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowDownToLine,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  Eye,
  ImageIcon,
  KeyRound,
  Loader2,
  LogOut,
  PencilLine,
  RefreshCw,
  Send,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import "./styles.css";

const MODEL_KEYS = {
  GPT: "gpt",
  NANO: "nano",
};

const MEDIA_TYPES = {
  IMAGE: "image",
  VIDEO: "video",
};

const VIDEO_MODES = {
  TEXT: "text",
  FIRST_FRAME: "first-frame",
};

const LOCAL_PREVIEW = import.meta.env.DEV && new URLSearchParams(window.location.search).get("preview") === "1";

const GPT_RESOLUTION_MODES = {
  PRESET: "preset",
  CUSTOM: "custom",
};

const GPT_MAX_LONG_SIDE = 3840;
const GPT_MAX_SHORT_SIDE = 2160;
const GPT_STABLE_PIXEL_LIMIT = 2560 * 1440;
const GPT_EXPERIMENTAL_MESSAGE = "该分辨率高于 OpenAI 标准稳定区间，官方标记为 experimental，可能生成失败。如遇失败，可以降低分辨率或改用 Nano Banana 2。";

const modelOptions = [
  {
    value: MODEL_KEYS.GPT,
    name: "GPT-Image-2",
  },
  {
    value: MODEL_KEYS.NANO,
    name: "Nano Banana 2",
  },
];

const gptAspectOptions = [
  { value: "21:9", label: "21:9" },
  { value: "16:9", label: "16:9" },
  { value: "3:2", label: "3:2" },
  { value: "4:3", label: "4:3" },
  { value: "5:4", label: "5:4" },
  { value: "1:1", label: "1:1" },
  { value: "4:5", label: "4:5" },
  { value: "3:4", label: "3:4" },
  { value: "2:3", label: "2:3" },
  { value: "9:16", label: "9:16" },
  { value: "9:21", label: "9:21" },
];

const gptResolutionOptions = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const gptSizeMap = {
  "1K": {
    "1:1": "1024x1024",
    "2:3": "1024x1536",
    "3:2": "1536x1024",
    "3:4": "1024x1360",
    "4:3": "1360x1024",
    "4:5": "1024x1280",
    "5:4": "1280x1024",
    "9:16": "576x1024",
    "16:9": "1024x576",
    "9:21": "768x1792",
    "21:9": "1792x768",
  },
  "2K": {
    "1:1": "2048x2048",
    "2:3": "1360x2048",
    "3:2": "2048x1360",
    "3:4": "1536x2048",
    "4:3": "2048x1536",
    "4:5": "1600x2000",
    "5:4": "2000x1600",
    "9:16": "1152x2048",
    "16:9": "2048x1152",
    "9:21": "864x2016",
    "21:9": "2016x864",
  },
  "4K": {
    "1:1": "2160x2160",
    "2:3": "2160x3232",
    "3:2": "3232x2160",
    "3:4": "2160x2880",
    "4:3": "2880x2160",
    "4:5": "1728x2160",
    "5:4": "2160x1728",
    "9:16": "2160x3840",
    "16:9": "3840x2160",
    "9:21": "1648x3840",
    "21:9": "3840x1648",
  },
};

const qualityOptions = [
  { value: "auto", label: "自动" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

const formatOptions = [
  { value: "png", label: "PNG" },
  { value: "jpeg", label: "JPEG" },
  { value: "webp", label: "WebP" },
];

const nanoAspectRatioOptions = ["21:9", "8:1", "4:1", "16:9", "3:2", "4:3", "5:4", "1:1", "4:5", "3:4", "2:3", "9:16", "1:4", "1:8"].map((value) => ({
  value,
  label: value,
}));

const resolutionOptions = ["512", "1K", "2K", "4K"].map((value) => ({
  value,
  label: value,
}));

const sora2VideoModelOptions = [
  { value: "sora2-landscape-10s", label: "横屏 10 秒" },
  { value: "sora2-landscape-15s", label: "横屏 15 秒" },
  { value: "sora2-landscape-25s", label: "横屏 25 秒" },
  { value: "sora2-portrait-10s", label: "竖屏 10 秒" },
  { value: "sora2-portrait-15s", label: "竖屏 15 秒" },
  { value: "sora2-portrait-25s", label: "竖屏 25 秒" },
].map((value) => ({
  value: value.value,
  label: value.label,
}));

const statusText = {
  queued: "正在等待",
  processing: "正在生成",
  succeeded: "已完成",
  failed: "生成失败",
};

const statusIcon = {
  queued: Clock3,
  processing: Loader2,
  succeeded: CheckCircle2,
  failed: AlertCircle,
};

function validateGptDimensions(widthInput, heightInput) {
  const widthText = String(widthInput ?? "").trim();
  const heightText = String(heightInput ?? "").trim();
  if (!widthText || !heightText) {
    return { valid: false, error: "宽高必须填写完整" };
  }
  if (!/^\d+$/.test(widthText) || !/^\d+$/.test(heightText)) {
    return { valid: false, error: "宽高必须是正整数" };
  }

  const width = Number(widthText);
  const height = Number(heightText);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    return { valid: false, error: "宽高必须是正整数" };
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    return { valid: false, error: "宽高必须能被 16 整除" };
  }

  const ratio = width / height;
  if (ratio < 1 / 3 || ratio > 3) {
    return { valid: false, error: "宽高比必须在 1:3 到 3:1 之间" };
  }

  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  if (longSide > GPT_MAX_LONG_SIDE || shortSide > GPT_MAX_SHORT_SIDE) {
    return { valid: false, error: "最大支持 3840x2160，竖图方向为 2160x3840" };
  }

  return {
    valid: true,
    width,
    height,
    size: `${width}x${height}`,
    isExperimental: width * height > GPT_STABLE_PIXEL_LIMIT,
  };
}

function validateGptSizeString(size) {
  const match = /^(\d+)x(\d+)$/i.exec(String(size || "").trim());
  if (!match) return { valid: false, error: "宽高必须填写完整" };
  return validateGptDimensions(match[1], match[2]);
}

function readImageDimensions(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = url;
  });
}

function makePreviewJob({ mediaType, mode, modelKey, prompt, params }) {
  const timestamp = Date.now();
  return {
    id: `preview-${timestamp}`,
    status: "queued",
    mediaType,
    provider: mediaType === MEDIA_TYPES.VIDEO ? "sora2" : modelKey === MODEL_KEYS.NANO ? "gemini" : "openai",
    mode,
    modelKey,
    prompt,
    params,
    imageUrl: null,
    videoUrl: null,
    errorMessage: null,
    createdAt: timestamp,
    startedAt: null,
    finishedAt: null,
  };
}

function App() {
  const [checkingSession, setCheckingSession] = useState(!LOCAL_PREVIEW);
  const [authenticated, setAuthenticated] = useState(LOCAL_PREVIEW);
  const [loginToken, setLoginToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const [mediaType, setMediaType] = useState(MEDIA_TYPES.IMAGE);
  const [mode, setMode] = useState("generate");
  const [modelKey, setModelKey] = useState(MODEL_KEYS.GPT);
  const [prompt, setPrompt] = useState("");
  const [gptResolutionMode, setGptResolutionMode] = useState(GPT_RESOLUTION_MODES.PRESET);
  const [gptAspectRatio, setGptAspectRatio] = useState("1:1");
  const [gptResolution, setGptResolution] = useState("1K");
  const [gptCustomWidth, setGptCustomWidth] = useState("1024");
  const [gptCustomHeight, setGptCustomHeight] = useState("1024");
  const [quality, setQuality] = useState("auto");
  const [outputFormat, setOutputFormat] = useState("png");
  const [outputCompression, setOutputCompression] = useState(82);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [sourceImage, setSourceImage] = useState(null);
  const [sourcePreview, setSourcePreview] = useState("");
  const [sourceImageSize, setSourceImageSize] = useState(null);
  const [videoMode, setVideoMode] = useState(VIDEO_MODES.TEXT);
  const [videoModel, setVideoModel] = useState("sora2-landscape-10s");
  const [firstFrame, setFirstFrame] = useState(null);
  const [firstFramePreview, setFirstFramePreview] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const sourcePreviewId = useRef(0);

  const selectedJob = useMemo(() => (
    jobs.find((job) => job.id === selectedJobId) || jobs[0] || null
  ), [jobs, selectedJobId]);
  const activeJob = jobs.find((job) => job.status === "processing" || job.status === "queued");
  const presetGptSize = gptSizeMap[gptResolution]?.[gptAspectRatio] || "1024x1024";
  const presetGptValidation = validateGptSizeString(presetGptSize);
  const customGptValidation = validateGptDimensions(gptCustomWidth, gptCustomHeight);
  const activeGptValidation = gptResolutionMode === GPT_RESOLUTION_MODES.CUSTOM ? customGptValidation : presetGptValidation;
  const resolvedGptSize = activeGptValidation.valid ? activeGptValidation.size : presetGptSize;
  const readableGptSize = resolvedGptSize.replace("x", " * ");
  const gptSizeError = modelKey === MODEL_KEYS.GPT && !activeGptValidation.valid ? activeGptValidation.error : "";
  const showGptExperimentalWarning = modelKey === MODEL_KEYS.GPT && activeGptValidation.valid && activeGptValidation.isExperimental;

  useEffect(() => {
    if (LOCAL_PREVIEW) return;
    checkSession();
  }, []);

  useEffect(() => {
    if (LOCAL_PREVIEW) return undefined;
    if (!authenticated) return undefined;
    refreshJobs(false);
    const timer = window.setInterval(() => refreshJobs(false), 2500);
    return () => window.clearInterval(timer);
  }, [authenticated]);

  useEffect(() => () => {
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
  }, [sourcePreview]);

  useEffect(() => () => {
    if (firstFramePreview) URL.revokeObjectURL(firstFramePreview);
  }, [firstFramePreview]);

  async function api(path, options = {}) {
    const response = await fetch(path, {
      credentials: "include",
      ...options,
      headers: {
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(options.headers || {}),
      },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "请求没有成功，请稍后重试。");
    }
    return payload;
  }

  async function checkSession() {
    setCheckingSession(true);
    try {
      const payload = await api("/image-api/auth/session");
      setAuthenticated(Boolean(payload.authenticated));
    } catch {
      setAuthenticated(false);
    } finally {
      setCheckingSession(false);
    }
  }

  async function login(event) {
    event.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await api("/image-api/auth/login", {
        method: "POST",
        body: JSON.stringify({ token: loginToken }),
      });
      setLoginToken("");
      setAuthenticated(true);
      await refreshJobs(true);
    } catch (error) {
      setLoginError(error.message);
    } finally {
      setLoginLoading(false);
    }
  }

  async function logout() {
    if (LOCAL_PREVIEW) {
      setJobs([]);
      setSelectedJobId(null);
      return;
    }
    await api("/image-api/auth/logout", { method: "POST", body: JSON.stringify({}) }).catch(() => {});
    setAuthenticated(false);
    setJobs([]);
    setSelectedJobId(null);
  }

  async function refreshJobs(showLoading = true) {
    if (showLoading) setJobsLoading(true);
    try {
      const payload = await api("/image-api/jobs");
      const nextJobs = payload.jobs || [];
      setJobs(nextJobs);
      setSelectedJobId((currentId) => {
        if (currentId && nextJobs.some((job) => job.id === currentId)) return currentId;
        return nextJobs[0]?.id || null;
      });
    } catch (error) {
      setNotice(error.message);
    } finally {
      if (showLoading) setJobsLoading(false);
    }
  }

  function switchMode(nextMode) {
    setMode(nextMode);
    setPrompt("");
    if (nextMode === "generate") clearSourceImage();
  }

  function switchMediaType(nextMediaType) {
    setMediaType(nextMediaType);
    setPrompt("");
    setNotice("");
    if (nextMediaType === MEDIA_TYPES.IMAGE) {
      setVideoMode(VIDEO_MODES.TEXT);
      clearVideoFrames();
    } else {
      setMode("generate");
      clearSourceImage();
    }
  }

  function updateSourceImage(file) {
    clearSourceImage();
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice("请上传 PNG、JPG 或 WebP 图片。");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setNotice("图片不能超过 50MB。");
      return;
    }
    const nextPreview = URL.createObjectURL(file);
    const previewId = sourcePreviewId.current + 1;
    sourcePreviewId.current = previewId;
    setSourceImage(file);
    setSourcePreview(nextPreview);
    readImageDimensions(nextPreview)
      .then(({ width, height }) => {
        if (sourcePreviewId.current !== previewId) return;
        setSourceImageSize({ width, height });
        setGptCustomWidth(String(width));
        setGptCustomHeight(String(height));
      })
      .catch(() => {
        if (sourcePreviewId.current !== previewId) return;
        setSourceImageSize(null);
        setNotice("图片已上传，但无法读取原始分辨率，请手动填写自定义分辨率。");
      });
  }

  function clearSourceImage() {
    sourcePreviewId.current += 1;
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourceImage(null);
    setSourcePreview("");
    setSourceImageSize(null);
  }

  function updateVideoFrame(kind, file) {
    if (kind === "first") clearFirstFrame();
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setNotice("请上传 PNG、JPG 或 WebP 图片。");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      setNotice("图片不能超过 50MB。");
      return;
    }
    const preview = URL.createObjectURL(file);
    if (kind === "first") {
      setFirstFrame(file);
      setFirstFramePreview(preview);
    }
  }

  function clearFirstFrame() {
    if (firstFramePreview) URL.revokeObjectURL(firstFramePreview);
    setFirstFrame(null);
    setFirstFramePreview("");
  }

  function clearVideoFrames() {
    clearFirstFrame();
  }

  async function submitJob(event) {
    event.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setNotice("请先写下想生成的内容。");
      return;
    }
    if (mediaType === MEDIA_TYPES.IMAGE && mode === "edit" && !sourceImage) {
      setNotice("请先上传一张参考图片。");
      return;
    }
    if (mediaType === MEDIA_TYPES.VIDEO && videoMode !== VIDEO_MODES.TEXT && !firstFrame) {
      setNotice("请先上传首帧图片。");
      return;
    }
    if (mediaType === MEDIA_TYPES.IMAGE && modelKey === MODEL_KEYS.GPT && !activeGptValidation.valid) {
      setNotice(activeGptValidation.error);
      return;
    }

    setSubmitting(true);
    setNotice("");
    try {
      let body;
      let previewJob;
      if (mediaType === MEDIA_TYPES.VIDEO) {
        const fields = {
          mediaType: MEDIA_TYPES.VIDEO,
          provider: "sora2",
          videoMode,
          sora2Model: videoModel,
          prompt: cleanPrompt,
        };
        previewJob = makePreviewJob({
          mediaType: MEDIA_TYPES.VIDEO,
          mode: videoMode,
          modelKey: videoModel,
          prompt: cleanPrompt,
          params: fields,
        });
        if (videoMode === VIDEO_MODES.TEXT) {
          body = JSON.stringify(fields);
        } else {
          body = new FormData();
          Object.entries(fields).forEach(([key, value]) => body.append(key, value));
          body.append("firstFrame", firstFrame, firstFrame.name);
        }
      } else {
        const fields = modelKey === MODEL_KEYS.GPT ? {
          mediaType: MEDIA_TYPES.IMAGE,
        mode,
        modelKey,
        prompt: cleanPrompt,
        size: resolvedGptSize,
        resolutionMode: gptResolutionMode,
        quality,
        outputFormat,
        outputCompression,
        moderation: "auto",
      } : {
        mediaType: MEDIA_TYPES.IMAGE,
        mode,
        modelKey,
        prompt: cleanPrompt,
        aspectRatio,
        resolution,
      };
        previewJob = makePreviewJob({
          mediaType: MEDIA_TYPES.IMAGE,
          mode,
          modelKey,
          prompt: cleanPrompt,
          params: fields,
        });
        if (mode === "edit") {
          body = new FormData();
          Object.entries(fields).forEach(([key, value]) => body.append(key, value));
          body.append("image", sourceImage, sourceImage.name);
        } else {
          body = JSON.stringify(fields);
        }
      }

      if (LOCAL_PREVIEW) {
        setJobs((currentJobs) => [previewJob, ...currentJobs]);
        setSelectedJobId(previewJob.id);
        setNotice("预览模式已创建一条本地任务，不会调用后端。");
        return;
      }

      const payload = await api("/image-api/jobs", { method: "POST", body });
      setSelectedJobId(payload.job.id);
      setNotice("已经加入生成列表。你可以留在页面等待，也可以稍后再回来查看。");
      await refreshJobs(false);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  function downloadCurrentImage() {
    const url = selectedJob?.videoUrl || selectedJob?.imageUrl;
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = selectedJob?.mediaType === MEDIA_TYPES.VIDEO
      ? `domaeng-video-${selectedJob.id}.mp4`
      : `domaeng-image-${selectedJob.id}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  if (checkingSession) {
    return (
      <main className="centerShell">
        <Loader2 className="spin" size={30} />
        <p>正在打开工作台...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="loginShell">
        <section className="loginPanel">
          <div className="brandMark">
            <Sparkles size={24} />
          </div>
          <p className="eyebrow">Domaeng Image</p>
          <h1>登录后开始生成图片</h1>
          <p className="loginText">请输入你的访问密钥。验证通过后，可以查看自己的作品记录和生成结果。</p>
          <form onSubmit={login} className="loginForm">
            <label>
              <span>访问密钥</span>
              <input
                value={loginToken}
                onChange={(event) => setLoginToken(event.target.value)}
                type="password"
                autoComplete="off"
                placeholder="粘贴你的访问密钥"
              />
            </label>
            {loginError ? <div className="inlineError"><AlertCircle size={16} />{loginError}</div> : null}
            <button className="primaryBtn" disabled={loginLoading || !loginToken.trim()}>
              {loginLoading ? <Loader2 className="spin" size={18} /> : <KeyRound size={18} />}
              进入工作台
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div>
          <h1>AI 创作工作台</h1>
        </div>
        <button className="ghostBtn" type="button" onClick={logout}>
          <LogOut size={18} />
          退出
        </button>
      </header>

      {notice ? (
        <div className="notice">
          <AlertCircle size={18} />
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice("")} aria-label="关闭提示"><X size={16} /></button>
        </div>
      ) : null}

      <section className="dashboardGrid">
        <form className="controlPanel" onSubmit={submitJob}>
          <Segmented
            value={mode}
            onChange={switchMode}
            options={[
              { value: "generate", label: "文生图", icon: Sparkles },
              { value: "edit", label: "图生图", icon: PencilLine },
            ]}
          />

          <label className="fieldBlock">
            <span>画面描述</span>
            <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={7} />
          </label>

          {mode === "edit" ? (
            <div className="uploadBox">
              <label>
                <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => updateSourceImage(event.target.files?.[0])} />
                {sourcePreview ? <img src={sourcePreview} alt="参考图预览" /> : <span><ImageIcon size={28} />上传参考图片</span>}
              </label>
              {sourceImage ? <button type="button" className="textBtn" onClick={clearSourceImage}>移除图片</button> : null}
            </div>
          ) : null}

          <div className="modelGrid">
            {modelOptions.map((model) => (
              <button
                key={model.value}
                type="button"
                className={modelKey === model.value ? "modelChoice active" : "modelChoice"}
                onClick={() => setModelKey(model.value)}
              >
                <strong>{model.name}</strong>
              </button>
            ))}
          </div>

          {modelKey === MODEL_KEYS.GPT ? (
            <>
              <Segmented
                value={gptResolutionMode}
                onChange={setGptResolutionMode}
                options={[
                  { value: GPT_RESOLUTION_MODES.PRESET, label: "预设分辨率" },
                  { value: GPT_RESOLUTION_MODES.CUSTOM, label: "自定义分辨率" },
                ]}
              />
              {gptResolutionMode === GPT_RESOLUTION_MODES.PRESET ? (
                <div className="twoCols">
                  <SelectField label="画面比例" value={gptAspectRatio} onChange={setGptAspectRatio} options={gptAspectOptions} />
                  <SelectField label="清晰度" value={gptResolution} onChange={setGptResolution} options={gptResolutionOptions} />
                </div>
              ) : (
                <div className="customSizeBlock">
                  <div className="dimensionRow">
                    <label className="fieldBlock">
                      <span>宽</span>
                      <input value={gptCustomWidth} inputMode="numeric" onChange={(event) => setGptCustomWidth(event.target.value)} />
                    </label>
                    <span className="dimensionDivider">X</span>
                    <label className="fieldBlock">
                      <span>高</span>
                      <input value={gptCustomHeight} inputMode="numeric" onChange={(event) => setGptCustomHeight(event.target.value)} />
                    </label>
                  </div>
                  {sourceImageSize ? (
                    <p className="helperText">已读取上传图片：{sourceImageSize.width} x {sourceImageSize.height}</p>
                  ) : null}
                  {gptSizeError ? <p className="fieldError">{gptSizeError}</p> : null}
                </div>
              )}
              <div className="sizePreview">
                图片分辨率：<strong>{readableGptSize}</strong>
              </div>
              {showGptExperimentalWarning ? <div className="warningBox">{GPT_EXPERIMENTAL_MESSAGE}</div> : null}
              <div className="twoCols">
                <SelectField label="画面质量" value={quality} onChange={setQuality} options={qualityOptions} />
                <SelectField label="图片格式" value={outputFormat} onChange={setOutputFormat} options={formatOptions} />
              </div>
              {outputFormat !== "png" ? (
                <label className="rangeBlock">
                  <span>压缩程度</span>
                  <input type="range" min="0" max="100" value={outputCompression} onChange={(event) => setOutputCompression(Number(event.target.value))} />
                  <b>{outputCompression}%</b>
                </label>
              ) : null}
            </>
          ) : (
            <div className="twoCols">
              <SelectField label="画面比例" value={aspectRatio} onChange={setAspectRatio} options={nanoAspectRatioOptions} />
              <SelectField label="清晰度" value={resolution} onChange={setResolution} options={resolutionOptions} />
            </div>
          )}

          <button className="primaryBtn submitBtn" disabled={submitting || Boolean(gptSizeError)}>
            {submitting ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            {submitting ? "正在提交" : "开始生成"}
          </button>
        </form>

        <div className="sideColumn">
          <section className="resultPanel">
            <PanelTitle icon={Eye} title="作品预览" />
            <Preview job={selectedJob} onDownload={downloadCurrentImage} />
          </section>

          <section className={historyOpen ? "historyPanel open" : "historyPanel"}>
            <div className="historyHead">
              <button className="historyToggle" type="button" onClick={() => setHistoryOpen((value) => !value)}>
                <PanelTitle icon={Clock3} title="历史记录" subtitle={activeJob ? statusText[activeJob.status] : `${jobs.length} 条记录`} />
                {historyOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
              </button>
              {historyOpen ? (
                <button className="ghostIcon" type="button" onClick={() => refreshJobs(true)} aria-label="刷新记录">
                  <RefreshCw className={jobsLoading ? "spin" : ""} size={18} />
                </button>
              ) : null}
            </div>
            {historyOpen ? <JobList jobs={jobs} selectedId={selectedJob?.id} onSelect={setSelectedJobId} /> : null}
          </section>
        </div>
      </section>
    </main>
  );
}

function PanelTitle({ icon: Icon, title, subtitle }) {
  return (
    <div className="panelTitle">
      <span><Icon size={19} /></span>
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button key={optionValue} type="button" className={value === optionValue ? "active" : ""} onClick={() => onChange(optionValue)}>
          {Icon ? <Icon size={17} /> : null}
          {label}
        </button>
      ))}
    </div>
  );
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="fieldBlock">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function FrameUpload({ label, preview, onChange, onClear }) {
  return (
    <div className="uploadBox frameUpload">
      <label>
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => onChange(event.target.files?.[0])} />
        {preview ? <img src={preview} alt={`${label}预览`} /> : <span><ImageIcon size={26} />{label}</span>}
      </label>
      {preview ? <button type="button" className="textBtn" onClick={onClear}>移除图片</button> : null}
    </div>
  );
}

function Preview({ job, onDownload }) {
  if (!job) {
    return (
      <div className="emptyPreview">
        <ImageIcon size={42} />
        <strong>生成后的作品会显示在这里</strong>
        <span>提交作品后，可以在历史记录里查看进度。</span>
      </div>
    );
  }

  const Icon = statusIcon[job.status] || Clock3;
  const resultUrl = job.videoUrl || job.imageUrl;
  const isVideo = job.mediaType === MEDIA_TYPES.VIDEO;
  return (
    <div className="previewWrap">
      <div className={`statusPill ${job.status}`}>
        <Icon className={job.status === "processing" ? "spin" : ""} size={16} />
        {statusText[job.status]}
      </div>
      {resultUrl ? (
        isVideo ? (
          <video className="resultVideo" src={resultUrl} controls playsInline />
        ) : (
          <img className="resultImage" src={resultUrl} alt="生成结果" />
        )
      ) : (
        <div className="waitingBox">
          <Loader2 className={job.status === "failed" ? "" : "spin"} size={38} />
          <strong>{job.status === "failed" ? "这次没有生成成功" : "作品正在准备中"}</strong>
          <span>{job.errorMessage || "可以留在页面等待，也可以稍后再回来查看。"}</span>
        </div>
      )}
      <div className="previewMeta">
        <p>{job.prompt}</p>
        {resultUrl ? (
          <button className="secondaryBtn" type="button" onClick={onDownload}>
            <ArrowDownToLine size={17} />
            {isVideo ? "下载视频" : "下载图片"}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function JobList({ jobs, selectedId, onSelect }) {
  if (!jobs.length) {
    return (
      <div className="emptyHistory">
        <ImageIcon size={30} />
        <span>还没有作品记录。</span>
      </div>
    );
  }
  return (
    <div className="jobList">
      {jobs.map((job) => {
        const Icon = statusIcon[job.status] || Clock3;
        const resultUrl = job.videoUrl || job.imageUrl;
        const isVideo = job.mediaType === MEDIA_TYPES.VIDEO;
        return (
          <button key={job.id} type="button" className={selectedId === job.id ? "jobItem active" : "jobItem"} onClick={() => onSelect(job.id)}>
            <div className="thumb">
              {resultUrl && !isVideo ? <img src={resultUrl} alt="" /> : (
                isVideo ? <Video size={22} /> : <Icon className={job.status === "processing" ? "spin" : ""} size={22} />
              )}
            </div>
            <div>
              <strong>{isVideo ? "视频" : "图片"} · {statusText[job.status]}</strong>
              <span>{job.prompt}</span>
              <small>{formatTime(job.createdAt)}</small>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

createRoot(document.getElementById("root")).render(<App />);
