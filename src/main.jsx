import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  Clock3,
  Eye,
  FileImage,
  ImageIcon,
  KeyRound,
  Loader2,
  PencilLine,
  Send,
  ShieldCheck,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import "./styles.css";

const MODEL_KEYS = {
  GPT: "gpt",
  NANO: "nano",
};

const MODEL_CONFIG = {
  [MODEL_KEYS.GPT]: {
    id: "gpt-image-2",
    name: "GPT Image 2",
    description: "稳定通用，适合产品图、海报和精修。",
  },
  [MODEL_KEYS.NANO]: {
    id: "gemini-3.1-flash-image",
    name: "Nano Banana 2",
    description: "速度更快，适合多比例创作和快速改图。",
  },
};

const GENERATE_API_PATH = "/v1/images/generations";
const EDIT_API_PATH = "/v1/images/edits";
const GEMINI_API_PATH = `/v1beta/models/${MODEL_CONFIG[MODEL_KEYS.NANO].id}:generateContent`;
const SESSION_TOKEN_KEY = "image-workbench-access-token";
const LEGACY_SESSION_TOKEN_KEY = "gpt-image-2-new-api-token";
const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const ORIGINAL_SIZE = "original";
const ORIGINAL_SIZE_CAP = 3840;

const manualSizes = [
  { value: "1024x1024", label: "1024 x 1024", meta: "标准方图" },
  { value: "1536x1024", label: "1536 x 1024", meta: "横图" },
  { value: "1024x1536", label: "1024 x 1536", meta: "竖图" },
  { value: "2048x2048", label: "2048 x 2048", meta: "2K 方图" },
  { value: "2048x1152", label: "2048 x 1152", meta: "2K 宽屏" },
  { value: "3840x2160", label: "3840 x 2160", meta: "4K 横图" },
  { value: "2160x3840", label: "2160 x 3840", meta: "4K 竖图" },
  { value: "auto", label: "自动", meta: "自动选择" },
];

const qualityOptions = [
  { value: "auto", label: "自动", meta: "推荐设置" },
  { value: "low", label: "快速", meta: "更快，细节较少" },
  { value: "medium", label: "标准", meta: "速度和细节均衡" },
  { value: "high", label: "精细", meta: "细节更多，等待更久" },
];

const formatOptions = [
  { value: "png", label: "PNG", meta: "清晰，文件较大" },
  { value: "jpeg", label: "JPEG", meta: "文件较小，适合照片" },
  { value: "webp", label: "WebP", meta: "文件较小，适合网页" },
];

const moderationOptions = [
  { value: "auto", label: "标准", meta: "推荐设置" },
  { value: "low", label: "宽松", meta: "较少拦截" },
];

const aspectRatioOptions = [
  { value: "1:1", label: "1:1", meta: "方图" },
  { value: "1:4", label: "1:4", meta: "超长竖图" },
  { value: "1:8", label: "1:8", meta: "极长竖图" },
  { value: "2:3", label: "2:3", meta: "竖版照片" },
  { value: "3:2", label: "3:2", meta: "横版照片" },
  { value: "3:4", label: "3:4", meta: "传统竖图" },
  { value: "4:1", label: "4:1", meta: "超宽横幅" },
  { value: "4:3", label: "4:3", meta: "传统横图" },
  { value: "4:5", label: "4:5", meta: "社媒竖图" },
  { value: "5:4", label: "5:4", meta: "社媒横图" },
  { value: "8:1", label: "8:1", meta: "极宽横幅" },
  { value: "9:16", label: "9:16", meta: "手机竖屏" },
  { value: "16:9", label: "16:9", meta: "宽屏横图" },
  { value: "21:9", label: "21:9", meta: "电影横幅" },
];

const resolutionOptions = [
  { value: "512", label: "512", meta: "快速预览" },
  { value: "1K", label: "1K", meta: "标准分辨率" },
  { value: "2K", label: "2K", meta: "高清输出" },
  { value: "4K", label: "4K", meta: "超高清输出" },
];

const generateExamples = [
  "一张高级产品海报：磨砂黑色智能音箱置于深灰石材台面，侧后方有暖色轮廓光，画面有精致微尘和浅景深，商业摄影风格。",
  "为一家精品咖啡店生成官网首屏主视觉：清晨窗边、手冲咖啡、陶瓷杯、自然光、温暖但克制的色彩，适合品牌官网。",
  "生成一张 4K 横版科幻城市概念图：雨后夜景、玻璃高楼、霓虹反射、空中轻轨、电影感构图，细节丰富。",
];

const editExamples = [
  "保留主体和构图，把背景换成干净的浅灰摄影棚，增加柔和阴影，让图片更适合电商展示。",
  "保持人物五官和姿势不变，把光线改成傍晚暖光，背景更简洁，整体像高端杂志封面。",
  "保留产品外观，把画面整理得更高级：去掉杂乱物体，增强质感，颜色自然克制。",
];

function normalizeToken(value) {
  return value.trim().replace(/^Bearer\s+/i, "");
}

function getMime(format) {
  return `image/${format === "jpg" ? "jpeg" : format}`;
}

function extensionFromMime(mimeType, fallback = "png") {
  if (mimeType === "image/jpeg") return "jpeg";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/png") return "png";
  return fallback;
}

function safeFilename(modelKey, mode, extension) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const modelName = modelKey === MODEL_KEYS.NANO ? "nano-banana-2" : "gpt-image-2";
  return `${modelName}-${mode}-${stamp}.${extension}`;
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatSize(width, height) {
  return `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`;
}

function resolveOriginalSize(width, height) {
  const maxSide = Math.max(width, height);
  if (maxSide <= ORIGINAL_SIZE_CAP) {
    return formatSize(width, height);
  }
  const scale = ORIGINAL_SIZE_CAP / maxSide;
  return formatSize(width * scale, height * scale);
}

function ratioValue(ratio) {
  const [width, height] = ratio.split(":").map(Number);
  return width / height;
}

function findClosestAspectRatio(width, height) {
  const sourceRatio = width / height;
  return aspectRatioOptions.reduce((best, option) => {
    const distance = Math.abs(Math.log(sourceRatio / ratioValue(option.value)));
    return distance < best.distance ? { value: option.value, distance } : best;
  }, { value: "1:1", distance: Infinity }).value;
}

function isAllowedImage(file) {
  return ["image/png", "image/webp", "image/jpeg"].includes(file.type);
}

async function readImageMeta(file) {
  const previewUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = previewUrl;
    await image.decode();
    return {
      name: file.name,
      size: file.size,
      type: file.type,
      width: image.naturalWidth,
      height: image.naturalHeight,
      previewUrl,
    };
  } catch {
    URL.revokeObjectURL(previewUrl);
    throw new Error("图片读取失败，请换一张图片再试。");
  }
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || "");
      resolve(value.includes(",") ? value.split(",")[1] : value);
    };
    reader.onerror = () => reject(new Error("图片读取失败，请换一张图片再试。"));
    reader.readAsDataURL(file);
  });
}

async function readError(response) {
  const payload = await response.json().catch(() => null);
  if (payload?.error?.message) return payload.error.message;
  if (payload?.message) return payload.message;
  if (payload?.detail) return payload.detail;
  return `${response.status} ${response.statusText || "请求失败"}`;
}

function buildGeminiBody(prompt, aspectRatio, resolution, imagePart = null) {
  const parts = [{ text: prompt }];
  if (imagePart) {
    parts.push({
      inlineData: {
        mimeType: imagePart.mimeType,
        data: imagePart.data,
      },
    });
  }
  return {
    contents: [
      {
        role: "user",
        parts,
      },
    ],
    generationConfig: {
      responseModalities: ["IMAGE"],
      responseFormat: {
        image: {
          aspectRatio,
          imageSize: resolution,
        },
      },
    },
  };
}

function parseGeminiImage(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts || [];
  for (const part of parts) {
    if (part?.inlineData?.data) {
      return {
        b64_json: part.inlineData.data,
        mimeType: part.inlineData.mimeType || "image/png",
      };
    }
    if (part?.inline_data?.data) {
      return {
        b64_json: part.inline_data.data,
        mimeType: part.inline_data.mime_type || "image/png",
      };
    }
  }
  return null;
}

function App() {
  const [mode, setMode] = useState("generate");
  const [selectedModel, setSelectedModel] = useState(MODEL_KEYS.GPT);
  const [token, setToken] = useState(() => (
    sessionStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(LEGACY_SESSION_TOKEN_KEY) || ""
  ));
  const [rememberToken, setRememberToken] = useState(() => (
    Boolean(sessionStorage.getItem(SESSION_TOKEN_KEY) || sessionStorage.getItem(LEGACY_SESSION_TOKEN_KEY))
  ));
  const [prompt, setPrompt] = useState(generateExamples[0]);
  const [size, setSize] = useState("1024x1024");
  const [quality, setQuality] = useState("auto");
  const [outputFormat, setOutputFormat] = useState("png");
  const [outputCompression, setOutputCompression] = useState(82);
  const [moderation, setModeration] = useState("auto");
  const [aspectRatio, setAspectRatio] = useState("1:1");
  const [resolution, setResolution] = useState("1K");
  const [sourceImage, setSourceImage] = useState(null);
  const [sourceMeta, setSourceMeta] = useState(null);
  const [status, setStatus] = useState({
    type: "idle",
    message: "准备生成图片。",
  });
  const [result, setResult] = useState(null);

  const isEdit = mode === "edit";
  const isNano = selectedModel === MODEL_KEYS.NANO;
  const currentModel = MODEL_CONFIG[selectedModel];
  const selectedSize = isEdit && size === ORIGINAL_SIZE && sourceMeta
    ? resolveOriginalSize(sourceMeta.width, sourceMeta.height)
    : size;
  const is4kSize = isNano ? resolution === "4K" : ["3840x2160", "2160x3840"].includes(selectedSize);
  const canSubmit = status.type !== "loading";
  const resultMime = result?.mimeType || getMime(outputFormat);
  const imageSrc = result?.b64_json ? `data:${resultMime};base64,${result.b64_json}` : result?.url || "";
  const examples = isEdit ? editExamples : generateExamples;
  const downloadExtension = isNano ? extensionFromMime(resultMime) : outputFormat;

  const sizeOptions = useMemo(() => {
    if (!isEdit) return manualSizes;
    const originalMeta = sourceMeta
      ? `原图 ${sourceMeta.width} x ${sourceMeta.height}，提交 ${resolveOriginalSize(sourceMeta.width, sourceMeta.height)}`
      : "上传图片后自动使用";
    return [{ value: ORIGINAL_SIZE, label: "原图尺寸", meta: originalMeta }, ...manualSizes];
  }, [isEdit, sourceMeta]);

  const gptGenerateBody = useMemo(() => {
    const body = {
      model: MODEL_CONFIG[MODEL_KEYS.GPT].id,
      prompt: prompt.trim(),
      n: 1,
      size,
      quality,
      output_format: outputFormat,
      moderation,
    };
    if (outputFormat === "jpeg" || outputFormat === "webp") {
      body.output_compression = Number(outputCompression);
    }
    return body;
  }, [prompt, size, quality, outputFormat, outputCompression, moderation]);

  function switchModel(nextModel) {
    if (nextModel === selectedModel || status.type === "loading") return;
    setSelectedModel(nextModel);
    setResult(null);
    if (nextModel === MODEL_KEYS.NANO && sourceMeta) {
      setAspectRatio(findClosestAspectRatio(sourceMeta.width, sourceMeta.height));
    }
    setStatus({
      type: "idle",
      message: nextModel === MODEL_KEYS.NANO ? "已切换到 Nano Banana 2。" : "已切换到 GPT Image 2。",
    });
  }

  function switchMode(nextMode) {
    if (nextMode === mode || status.type === "loading") return;
    setMode(nextMode);
    setResult(null);
    if (nextMode === "edit") {
      setSize(ORIGINAL_SIZE);
      setPrompt(editExamples[0]);
      setStatus({ type: "idle", message: "上传参考图片，然后写下你想怎么改。" });
    } else {
      setSize("1024x1024");
      setPrompt(generateExamples[0]);
      setStatus({ type: "idle", message: "准备生成图片。" });
    }
  }

  async function updateSourceImage(file) {
    clearSourceImage();
    if (!file) return;
    if (!isAllowedImage(file)) {
      setStatus({ type: "error", message: "请上传 PNG、JPG、JPEG 或 WebP 图片。" });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setStatus({ type: "error", message: `图片不能超过 50MB，当前为 ${formatBytes(file.size)}。` });
      return;
    }
    try {
      const meta = await readImageMeta(file);
      setSourceImage(file);
      setSourceMeta(meta);
      if (isNano) {
        const closestRatio = findClosestAspectRatio(meta.width, meta.height);
        setAspectRatio(closestRatio);
        setStatus({ type: "idle", message: `已选择参考图片，并匹配为 ${closestRatio} 画面比例。` });
      } else {
        setStatus({ type: "idle", message: `已选择参考图片：${meta.width} x ${meta.height}。` });
      }
    } catch (error) {
      setStatus({ type: "error", message: error.message });
    }
  }

  function clearSourceImage() {
    if (sourceMeta?.previewUrl) URL.revokeObjectURL(sourceMeta.previewUrl);
    setSourceImage(null);
    setSourceMeta(null);
  }

  function rememberCleanToken(cleanToken) {
    if (rememberToken) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, cleanToken);
      sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
      sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
    }
  }

  function validateCommon(cleanToken, cleanPrompt) {
    if (!cleanToken) {
      setStatus({ type: "error", message: "请先填写访问密钥。" });
      return false;
    }
    if (!cleanPrompt) {
      setStatus({ type: "error", message: isEdit ? "请填写你想怎么修改图片。" : "请填写你想生成什么图片。" });
      return false;
    }
    return true;
  }

  async function submitImage(event) {
    event.preventDefault();
    const cleanToken = normalizeToken(token);
    const cleanPrompt = prompt.trim();
    if (!validateCommon(cleanToken, cleanPrompt)) return;
    rememberCleanToken(cleanToken);
    setResult(null);

    if (isNano) {
      await submitNanoImage(cleanToken, cleanPrompt);
    } else if (isEdit) {
      await editGptImage(cleanToken, cleanPrompt);
    } else {
      await generateGptImage(cleanToken);
    }
  }

  async function generateGptImage(cleanToken) {
    setStatus({
      type: "loading",
      message: is4kSize ? "正在生成 4K 图片，可能需要更长时间。" : "正在生成图片。",
    });

    try {
      const response = await fetch(GENERATE_API_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanToken}`,
        },
        body: JSON.stringify(gptGenerateBody),
      });
      await handleGptImageResponse(response, "图片已生成。");
    } catch (error) {
      setStatus({
        type: "error",
        message: error.message || "图片生成失败，请稍后再试。",
      });
    }
  }

  async function editGptImage(cleanToken, cleanPrompt) {
    if (!sourceImage || !sourceMeta) {
      setStatus({ type: "error", message: "请先上传一张参考图片。" });
      return;
    }

    const resolvedSize = size === ORIGINAL_SIZE ? resolveOriginalSize(sourceMeta.width, sourceMeta.height) : size;
    const formData = new FormData();
    formData.append("model", MODEL_CONFIG[MODEL_KEYS.GPT].id);
    formData.append("image", sourceImage, sourceImage.name);
    formData.append("prompt", cleanPrompt);
    formData.append("n", "1");
    formData.append("size", resolvedSize);
    formData.append("quality", quality);
    formData.append("output_format", outputFormat);
    formData.append("moderation", moderation);
    formData.append("background", "auto");
    if (outputFormat === "jpeg" || outputFormat === "webp") {
      formData.append("output_compression", String(Number(outputCompression)));
    }

    setStatus({
      type: "loading",
      message: resolvedSize.includes("3840") ? "正在编辑 4K 图片，可能需要更长时间。" : "正在编辑图片。",
    });

    try {
      const response = await fetch(EDIT_API_PATH, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cleanToken}`,
        },
        body: formData,
      });
      await handleGptImageResponse(response, "图片已编辑。");
    } catch (error) {
      setStatus({
        type: "error",
        message: error.message || "图片编辑失败，请稍后再试或换一张图片。",
      });
    }
  }

  async function submitNanoImage(cleanToken, cleanPrompt) {
    if (isEdit && (!sourceImage || !sourceMeta)) {
      setStatus({ type: "error", message: "请先上传一张参考图片。" });
      return;
    }

    setStatus({
      type: "loading",
      message: resolution === "4K" ? "正在处理 4K 图片，可能需要更长时间。" : "正在处理图片。",
    });

    try {
      const imagePart = isEdit
        ? { mimeType: sourceImage.type, data: await fileToBase64(sourceImage) }
        : null;
      const response = await fetch(GEMINI_API_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${cleanToken}`,
        },
        body: JSON.stringify(buildGeminiBody(cleanPrompt, aspectRatio, resolution, imagePart)),
      });
      await handleNanoImageResponse(response, isEdit ? "图片已编辑。" : "图片已生成。");
    } catch (error) {
      setStatus({
        type: "error",
        message: error.message || "图片处理失败，请稍后再试。",
      });
    }
  }

  async function handleGptImageResponse(response, successMessage) {
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    const firstImage = payload?.data?.[0];
    if (!firstImage?.b64_json && !firstImage?.url) {
      throw new Error("图片处理完成，但没有收到可预览的图片。");
    }
    setResult({ ...firstImage, mimeType: getMime(outputFormat), created: payload.created, raw: payload });
    setStatus({ type: "success", message: successMessage });
  }

  async function handleNanoImageResponse(response, successMessage) {
    if (!response.ok) {
      throw new Error(await readError(response));
    }
    const payload = await response.json();
    const firstImage = parseGeminiImage(payload);
    if (!firstImage?.b64_json) {
      throw new Error("图片处理完成，但没有收到可预览的图片。");
    }
    setResult({ ...firstImage, raw: payload });
    setStatus({ type: "success", message: successMessage });
  }

  function downloadImage() {
    if (!imageSrc) return;
    const link = document.createElement("a");
    link.href = imageSrc;
    link.download = safeFilename(selectedModel, mode, downloadExtension);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <main className="appShell">
      <section className="heroBand">
        <div className="heroCopy">
          <span className="eyebrow">AI 图片创作</span>
          <h1>AI 图片工作台</h1>
        </div>
      </section>

      <form className="workspace" onSubmit={submitImage}>
        <section className="controlPanel">
          <PanelHeader icon={isEdit ? PencilLine : Wand2} title={isEdit ? "编辑设置" : "生成设置"} subtitle="参数设置" />

          <div className="modeSwitch" aria-label="图片模式">
            <button type="button" className={mode === "generate" ? "active" : ""} onClick={() => switchMode("generate")}>
              <Wand2 size={17} />
              生成图片
            </button>
            <button type="button" className={mode === "edit" ? "active" : ""} onClick={() => switchMode("edit")}>
              <PencilLine size={17} />
              编辑图片
            </button>
          </div>

          <div className="modelCards" aria-label="选择模型">
            {Object.entries(MODEL_CONFIG).map(([key, model]) => {
              const Icon = key === MODEL_KEYS.NANO ? Sparkles : Wand2;
              return (
                <button
                  type="button"
                  key={key}
                  className={selectedModel === key ? "modelCard active" : "modelCard"}
                  onClick={() => switchModel(key)}
                >
                  <Icon size={18} />
                  <span>
                    <strong>{model.name}</strong>
                    <small>{model.description}</small>
                  </span>
                </button>
              );
            })}
          </div>

          <label className="field">
            <span>访问密钥</span>
            <div className="tokenInput">
              <KeyRound size={18} />
              <input
                type="password"
                value={token}
                placeholder="直接粘贴访问密钥"
                autoComplete="off"
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
          </label>

          <label className="checkLine">
            <input
              type="checkbox"
              checked={rememberToken}
              onChange={(event) => {
                setRememberToken(event.target.checked);
                if (!event.target.checked) {
                  sessionStorage.removeItem(SESSION_TOKEN_KEY);
                  sessionStorage.removeItem(LEGACY_SESSION_TOKEN_KEY);
                }
              }}
            />
            <span>本次浏览器会话记住访问密钥</span>
          </label>

          {isEdit && (
            <ImageUpload
              label="参考图片"
              meta={sourceMeta}
              helper={
                isNano
                  ? "支持 PNG、JPG、JPEG、WebP；输出不使用原始像素尺寸，会按画面比例和分辨率生成。"
                  : "支持 PNG、JPG、JPEG、WebP，单张不超过 50MB。"
              }
              onChange={updateSourceImage}
              onClear={clearSourceImage}
              showSubmitSize={!isNano}
            />
          )}

          <label className="field">
            <span>{isEdit ? "修改要求" : "图片描述"}</span>
            <textarea
              value={prompt}
              rows={9}
              maxLength={32000}
              placeholder={isEdit ? "描述你想怎么修改这张图片。" : "描述你想生成的画面、风格、构图、光线和用途。"}
              onChange={(event) => setPrompt(event.target.value)}
            />
          </label>

          <div className="exampleRow">
            {examples.map((item, index) => (
              <button type="button" key={item} onClick={() => setPrompt(item)}>
                示例 {index + 1}
              </button>
            ))}
          </div>

          {isNano ? (
            <div className="settingsGrid">
              <SelectField label="画面比例" value={aspectRatio} options={aspectRatioOptions} onChange={setAspectRatio} />
              <SelectField label="分辨率" value={resolution} options={resolutionOptions} onChange={setResolution} />
            </div>
          ) : (
            <>
              <div className="settingsGrid">
                <SelectField label="图片尺寸" value={size} options={sizeOptions} onChange={setSize} />
                <SelectField label="画质" value={quality} options={qualityOptions} onChange={setQuality} />
                <SelectField
                  label="下载格式"
                  value={outputFormat}
                  options={formatOptions}
                  onChange={setOutputFormat}
                />
                <SelectField label="安全过滤" value={moderation} options={moderationOptions} onChange={setModeration} />
              </div>

              {isEdit && (
                <small className="fieldNote">原始尺寸须能被 16 整除，否则请选择其他尺寸。</small>
              )}

              {(outputFormat === "jpeg" || outputFormat === "webp") && (
                <label className="field compactField">
                  <span>压缩质量</span>
                  <div className="rangeLine">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={outputCompression}
                      onChange={(event) => setOutputCompression(event.target.value)}
                    />
                    <output>{outputCompression}</output>
                  </div>
                </label>
              )}
            </>
          )}

          {is4kSize && (
            <div className="notice warning">
              <Clock3 size={18} />
              <span>4K 图片通常更慢，等待时间和文件大小都会增加。</span>
            </div>
          )}

          <div className="actionRow">
            <button className="primaryBtn" type="submit" disabled={!canSubmit}>
              {status.type === "loading" ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
              {isEdit ? "编辑图片" : "生成图片"}
            </button>
          </div>

          <StatusMessage status={status} />
        </section>

        <section className="resultPanel">
          <PanelHeader icon={Eye} title="结果预览" subtitle={currentModel.name} />
          <div className={imageSrc ? "imageStage hasImage" : "imageStage"}>
            {imageSrc ? (
              <img src={imageSrc} alt={isEdit ? "编辑后的图片" : "生成后的图片"} />
            ) : (
              <div className="emptyState">
                <ImageIcon size={48} />
                <strong>{isEdit ? "编辑后的图片会显示在这里" : "生成后的图片会显示在这里"}</strong>
                <span>完成后可以预览并下载图片。</span>
              </div>
            )}
          </div>

          <div className="resultActions">
            <button type="button" className="primaryBtn secondary" disabled={!imageSrc} onClick={downloadImage}>
              <ArrowDownToLine size={18} />
              下载图片
            </button>
            <div className="miniMeta">
              <span>{currentModel.name}</span>
              <span>{isEdit ? "编辑" : "生成"}</span>
              {isNano ? (
                <>
                  <span>{aspectRatio}</span>
                  <span>{resolution}</span>
                </>
              ) : (
                <>
                  <span>{outputFormat.toUpperCase()}</span>
                  <span>{selectedSize}</span>
                  <span>{qualityOptions.find((item) => item.value === quality)?.label || quality}</span>
                </>
              )}
            </div>
          </div>
        </section>
      </form>
    </main>
  );
}

function PanelHeader({ icon: Icon, title, subtitle }) {
  return (
    <div className="panelHeader">
      <div>
        <Icon size={20} />
      </div>
      <span>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </span>
    </div>
  );
}

function ImageUpload({ label, meta, helper, onChange, onClear, showSubmitSize }) {
  return (
    <div className="uploadField">
      <label className="uploadDrop">
        <span>{label}</span>
        <input
          key={meta?.name || "empty"}
          type="file"
          accept="image/png,image/webp,image/jpeg"
          onChange={(event) => onChange(event.target.files?.[0] || null)}
        />
        {meta ? (
          <span className="fileCard">
            <img src={meta.previewUrl} alt={`${label}预览`} />
            <span>
              <strong>{meta.name}</strong>
              <small>
                原图 {meta.width} x {meta.height} · {formatBytes(meta.size)}
              </small>
              {showSubmitSize && <small>提交尺寸 {resolveOriginalSize(meta.width, meta.height)}</small>}
            </span>
          </span>
        ) : (
          <span className="uploadEmpty">
            <FileImage size={24} />
            选择图片
          </span>
        )}
      </label>
      <div className="uploadFooter">
        <small>{helper}</small>
        <button type="button" className="iconBtn" disabled={!meta} onClick={onClear} aria-label={`清空${label}`}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field selectField">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} - {option.meta}
          </option>
        ))}
      </select>
    </label>
  );
}

function StatusMessage({ status }) {
  const Icon = status.type === "success" ? Check : status.type === "error" ? AlertCircle : ShieldCheck;
  return (
    <div className={`notice ${status.type}`}>
      <Icon size={18} />
      <span>{status.message}</span>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
