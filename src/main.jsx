import React, { useEffect, useMemo, useState } from "react";
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
  X,
} from "lucide-react";
import "./styles.css";

const MODEL_KEYS = {
  GPT: "gpt",
  NANO: "nano",
};

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
  { value: "1:1", label: "方图 1:1" },
  { value: "3:2", label: "横图 3:2" },
  { value: "2:3", label: "竖图 2:3" },
  { value: "16:9", label: "宽屏 16:9" },
  { value: "9:16", label: "竖屏 9:16" },
];

const gptResolutionOptions = [
  { value: "1K", label: "1K" },
  { value: "2K", label: "2K" },
  { value: "4K", label: "4K" },
];

const gptSizeMap = {
  "1K": {
    "1:1": "1024x1024",
    "3:2": "1536x1024",
    "2:3": "1024x1536",
    "16:9": "1024x576",
    "9:16": "576x1024",
  },
  "2K": {
    "1:1": "2048x2048",
    "3:2": "2048x1365",
    "2:3": "1365x2048",
    "16:9": "2048x1152",
    "9:16": "1152x2048",
  },
  "4K": {
    "1:1": "3840x3840",
    "3:2": "3840x2560",
    "2:3": "2560x3840",
    "16:9": "3840x2160",
    "9:16": "2160x3840",
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

const aspectRatioOptions = ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "9:16", "16:9", "21:9"].map((value) => ({
  value,
  label: value,
}));

const resolutionOptions = ["512", "1K", "2K", "4K"].map((value) => ({
  value,
  label: value,
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

function App() {
  const [checkingSession, setCheckingSession] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [loginToken, setLoginToken] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [jobs, setJobs] = useState([]);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const [mode, setMode] = useState("generate");
  const [modelKey, setModelKey] = useState(MODEL_KEYS.GPT);
  const [prompt, setPrompt] = useState("");
  const [gptAspectRatio, setGptAspectRatio] = useState("1:1");
  const [gptResolution, setGptResolution] = useState("1K");
  const [quality, setQuality] = useState("auto");
  const [outputFormat, setOutputFormat] = useState("png");
  const [outputCompression, setOutputCompression] = useState(82);
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [sourceImage, setSourceImage] = useState(null);
  const [sourcePreview, setSourcePreview] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const selectedJob = useMemo(() => (
    jobs.find((job) => job.id === selectedJobId) || jobs[0] || null
  ), [jobs, selectedJobId]);
  const activeJob = jobs.find((job) => job.status === "processing" || job.status === "queued");
  const resolvedGptSize = gptSizeMap[gptResolution]?.[gptAspectRatio] || "1024x1024";
  const readableGptSize = resolvedGptSize.replace("x", " * ");

  useEffect(() => {
    checkSession();
  }, []);

  useEffect(() => {
    if (!authenticated) return undefined;
    refreshJobs(false);
    const timer = window.setInterval(() => refreshJobs(false), 2500);
    return () => window.clearInterval(timer);
  }, [authenticated]);

  useEffect(() => () => {
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
  }, [sourcePreview]);

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
    setSourceImage(file);
    setSourcePreview(URL.createObjectURL(file));
  }

  function clearSourceImage() {
    if (sourcePreview) URL.revokeObjectURL(sourcePreview);
    setSourceImage(null);
    setSourcePreview("");
  }

  async function submitJob(event) {
    event.preventDefault();
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt) {
      setNotice("请先写下想生成的内容。");
      return;
    }
    if (mode === "edit" && !sourceImage) {
      setNotice("请先上传一张参考图片。");
      return;
    }

    setSubmitting(true);
    setNotice("");
    try {
      const fields = {
        mode,
        modelKey,
        prompt: cleanPrompt,
        size: modelKey === MODEL_KEYS.GPT ? resolvedGptSize : "auto",
        quality,
        outputFormat,
        outputCompression,
        moderation: "auto",
        aspectRatio,
        resolution,
      };
      let body;
      if (mode === "edit") {
        body = new FormData();
        Object.entries(fields).forEach(([key, value]) => body.append(key, value));
        body.append("image", sourceImage, sourceImage.name);
      } else {
        body = JSON.stringify(fields);
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
    if (!selectedJob?.imageUrl) return;
    const link = document.createElement("a");
    link.href = selectedJob.imageUrl;
    link.download = `domaeng-image-${selectedJob.id}.png`;
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
          <h1>AI 图片工作台</h1>
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
              <div className="twoCols">
                <SelectField label="画面比例" value={gptAspectRatio} onChange={setGptAspectRatio} options={gptAspectOptions} />
                <SelectField label="清晰度" value={gptResolution} onChange={setGptResolution} options={gptResolutionOptions} />
              </div>
              <div className="sizePreview">
                原始分辨率：<strong>{readableGptSize}</strong>
              </div>
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
              <SelectField label="画面比例" value={aspectRatio} onChange={setAspectRatio} options={aspectRatioOptions} />
              <SelectField label="清晰度" value={resolution} onChange={setResolution} options={resolutionOptions} />
            </div>
          )}

          <button className="primaryBtn submitBtn" disabled={submitting}>
            {submitting ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
            {submitting ? "正在提交" : "开始生成"}
          </button>
        </form>

        <div className="sideColumn">
          <section className="resultPanel">
            <PanelTitle icon={Eye} title="作品预览" subtitle={selectedJob ? statusText[selectedJob.status] : "暂无作品"} />
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
        <p>{subtitle}</p>
      </div>
    </div>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="segmented">
      {options.map(({ value: optionValue, label, icon: Icon }) => (
        <button key={optionValue} type="button" className={value === optionValue ? "active" : ""} onClick={() => onChange(optionValue)}>
          <Icon size={17} />
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

function Preview({ job, onDownload }) {
  if (!job) {
    return (
      <div className="emptyPreview">
        <ImageIcon size={42} />
        <strong>生成后的图片会显示在这里</strong>
        <span>提交作品后，可以在历史记录里查看进度。</span>
      </div>
    );
  }

  const Icon = statusIcon[job.status] || Clock3;
  return (
    <div className="previewWrap">
      <div className={`statusPill ${job.status}`}>
        <Icon className={job.status === "processing" ? "spin" : ""} size={16} />
        {statusText[job.status]}
      </div>
      {job.imageUrl ? (
        <img className="resultImage" src={job.imageUrl} alt="生成结果" />
      ) : (
        <div className="waitingBox">
          <Loader2 className={job.status === "failed" ? "" : "spin"} size={38} />
          <strong>{job.status === "failed" ? "这次没有生成成功" : "作品正在准备中"}</strong>
          <span>{job.errorMessage || "可以留在页面等待，也可以稍后再回来查看。"}</span>
        </div>
      )}
      <div className="previewMeta">
        <p>{job.prompt}</p>
        {job.imageUrl ? (
          <button className="secondaryBtn" type="button" onClick={onDownload}>
            <ArrowDownToLine size={17} />
            下载图片
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
        return (
          <button key={job.id} type="button" className={selectedId === job.id ? "jobItem active" : "jobItem"} onClick={() => onSelect(job.id)}>
            <div className="thumb">
              {job.imageUrl ? <img src={job.imageUrl} alt="" /> : <Icon className={job.status === "processing" ? "spin" : ""} size={22} />}
            </div>
            <div>
              <strong>{statusText[job.status]}</strong>
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
