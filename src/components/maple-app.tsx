"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { ArrowDown, ArrowRight, Camera, Check, CheckCheck, ChevronDown, CircleHelp, Clock3, Copy, Crop, Expand, FileImage, ImagePlus, Leaf, LoaderCircle, LockKeyhole, Maximize, RotateCcw, RotateCw, ScanLine, ShieldCheck, Sparkles, Trash2, Upload, Wifi, X, AlertCircle, ZoomIn } from "lucide-react";
import { ACCEPTED_TYPES, type AnalysisResult, type ApiErrorBody, type ServerStatus, validateAnalysis } from "@/lib/contracts";
import { autoCropPopup, canvasBlob, cropImage, prepareFile, type PixelCrop } from "@/lib/image";
import type { PopupType } from "@/lib/popup-detection";
import { demoResult } from "@/lib/demo";
import { KoreanTypingGuide } from "@/components/korean-typing-guide";

type Notice = { kind: "error" | "success" | "info"; text: string };
const typeLabels = { distorted_text: "Dạng 1 · Chữ biến dạng", sentence_choice: "Dạng 2 · Chọn câu", unknown: "Chưa xác định loại" };
const PREVIEW_ONLY = process.env.NEXT_PUBLIC_PREVIEW_ONLY === "true";

async function request<T>(path: string, init?: RequestInit, timeout = 45_000): Promise<T> {
  if (PREVIEW_ONLY) {
    if (path === "/api/status") return { configured: false, model: "demo", authenticated: true, authRequired: false, authUnavailable: false } as T;
    throw new Error("Đây là demo giao diện chưa kết nối Gemini. Bạn có thể chọn ảnh, cắt/xoay và xem kết quả minh họa. Phân tích thật cần chạy mã nguồn với API key riêng trên máy chủ.");
  }
  try {
    const res = await fetch(path, { ...init, signal: AbortSignal.timeout(timeout), cache: "no-store" });
    let data: T & ApiErrorBody;
    try { data = await res.json(); }
    catch { throw new Error("Máy chủ trả về dữ liệu không hợp lệ. Chưa có kết quả phân tích."); }
    if (!res.ok) throw new Error(data.error?.message || "Yêu cầu chưa thành công. Vui lòng thử lại.");
    return data;
  } catch (e) {
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw new Error("Yêu cầu đã hết thời gian chờ. Bạn có thể bấm thử lại.");
    if (e instanceof TypeError) throw new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
    throw e;
  }
}

function MapleMark({ small = false }: { small?: boolean }) {
  return <span className={`maple-mark ${small ? "small" : ""}`} aria-hidden="true"><Leaf size={small ? 19 : 25} strokeWidth={2} /></span>;
}

export default function MapleApp() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [originalImage, setOriginalImage] = useState<Blob | null>(null);
  const [autoInfo, setAutoInfo] = useState<{ found: boolean; alreadyFramed: boolean; typeHint: PopupType; elapsedMs: number; mode: "auto" | "original" | "manual" } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "connection" | null>(null);
  const [connectionVerified, setConnectionVerified] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [login, setLogin] = useState(false);
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(2);
  const [pixels, setPixels] = useState<PixelCrop | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const cameraGeneration = useRef(0);
  const upload = useRef<HTMLInputElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const imagePanelRef = useRef<HTMLElement>(null);
  const pendingPaste = useRef<Promise<Blob | null> | null>(null);
  const fileBusy = useRef(false);
  const analysisBusy = useRef(false);
  const enterBusy = useRef(false);
  const resultRef = useRef<HTMLElement>(null);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await request<ServerStatus>("/api/status", undefined, 10_000)); }
    catch { setNotice({ kind: "error", text: "Chưa kết nối được máy chủ. Bạn vẫn có thể thử xử lý ảnh trên thiết bị." }); }
  }, []);
  useEffect(() => { void refreshStatus(); }, [refreshStatus]);
  useEffect(() => {
    if (!image) { setImageUrl(null); return; }
    const url = URL.createObjectURL(image); setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);
  useEffect(() => {
    if (!busy) return;
    setElapsed(0); const at = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - at) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => () => { cameraGeneration.current++; stream.current?.getTracks().forEach(t => t.stop()); }, []);
  useEffect(() => {
    if (!cropOpen && !cameraOpen && !login && !showHelp) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [cropOpen, cameraOpen, login, showHelp]);

  async function acceptFile(file?: File): Promise<Blob | null> {
    if (!file || busy || reading || fileBusy.current || analysisBusy.current) return null;
    pendingPaste.current = null;
    fileBusy.current = true;
    setReading(true); setNotice(null); setResult(null); setImage(null); setOriginalImage(null); setAutoInfo(null);
    try {
      const blob = await prepareFile(file);
      setOriginalImage(blob);
      const scanned = await autoCropPopup(blob);
      setImage(scanned.blob); setImageName(file.name); setIsDemo(false);
      setAutoInfo({ found: !!scanned.detection, alreadyFramed: !!scanned.detection?.alreadyFramed, typeHint: scanned.detection?.typeHint || "unknown", elapsedMs: scanned.elapsedMs, mode: "auto" });
      return scanned.blob;
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); return null; }
    finally { setReading(false); fileBusy.current = false; }
  }
  async function loadDemo() {
    pendingPaste.current = null;
    setReading(true); setNotice(null); setResult(null);
    try {
      const res = await fetch("/demo-challenge.svg");
      const raw = await res.blob(); const url = URL.createObjectURL(raw);
      try {
        const el = new Image(); el.src = url; await el.decode();
        const canvas = document.createElement("canvas"); canvas.width = el.naturalWidth; canvas.height = el.naturalHeight;
        canvas.getContext("2d")!.drawImage(el, 0, 0);
        const blob = await canvasBlob(canvas); const scanned = await autoCropPopup(blob);
        setOriginalImage(blob); setImage(scanned.blob); setImageName("anh-minh-hoa.jpg"); setIsDemo(true);
        setAutoInfo({ found: !!scanned.detection, alreadyFramed: !!scanned.detection?.alreadyFramed, typeHint: scanned.detection?.typeHint || "unknown", elapsedMs: scanned.elapsedMs, mode: "auto" });
      } finally { URL.revokeObjectURL(url); }
    } catch { setNotice({ kind: "error", text: "Không tải được ảnh minh họa. Bạn có thể chọn ảnh từ thư viện." }); }
    finally { setReading(false); }
  }
  function closeCamera() {
    cameraGeneration.current++; stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    setCameraOpen(false); setCameraReady(false);
  }
  async function openCamera() {
    setNotice(null);
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setNotice({ kind: "info", text: "Camera trực tiếp cần HTTPS. Bạn có thể chụp qua camera hệ thống hoặc chọn ảnh từ thư viện." });
      nativeCamera.current?.click(); return;
    }
    setCameraOpen(true); setCameraError(""); setCameraReady(false);
    const generation = ++cameraGeneration.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (generation !== cameraGeneration.current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      if (video.current) { video.current.srcObject = media; await video.current.play(); setCameraReady(true); }
    } catch (e) {
      if (generation !== cameraGeneration.current) return;
      const name = (e as DOMException).name;
      setCameraError(name === "NotAllowedError" ? "Quyền camera đã bị từ chối. Bạn có thể cho phép camera trong cài đặt Safari hoặc chọn ảnh từ thư viện." : name === "NotFoundError" ? "Không tìm thấy camera. Hãy chọn ảnh từ thư viện." : "Chưa mở được camera. Hãy đóng ứng dụng đang dùng camera hoặc chọn ảnh có sẵn.");
      stream.current?.getTracks().forEach(t => t.stop());
    }
  }
  async function capture() {
    const v = video.current;
    if (!v?.videoWidth) return;
    try {
      const canvas = document.createElement("canvas"); canvas.width = v.videoWidth; canvas.height = v.videoHeight;
      canvas.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await canvasBlob(canvas); closeCamera();
      await acceptFile(new File([blob], "camera.jpg", { type: "image/jpeg" }));
    } catch (e) { setCameraError((e as Error).message); }
  }
  function openCrop() { pendingPaste.current = null; setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); setPixels(null); setCropOpen(true); }
  async function restoreOrScan() {
    if (!originalImage || reading || busy) return;
    pendingPaste.current = null;
    setResult(null);
    if (image !== originalImage) { setImage(originalImage); setAutoInfo(i => i ? { ...i, mode: "original" } : null); return; }
    setReading(true);
    try {
      const scanned = await autoCropPopup(originalImage); setImage(scanned.blob);
      setAutoInfo({ found: !!scanned.detection, alreadyFramed: !!scanned.detection?.alreadyFramed, typeHint: scanned.detection?.typeHint || "unknown", elapsedMs: scanned.elapsedMs, mode: "auto" });
    } catch { setNotice({ kind: "info", text: "Chưa tìm được popup. Ứng dụng giữ ảnh gốc để phân tích đầy đủ." }); }
    finally { setReading(false); }
  }
  async function applyCrop() {
    if (!pixels || !imageUrl) return;
    setReading(true);
    try { setImage(await cropImage(imageUrl, pixels, rotation)); setResult(null); setCropOpen(false); setIsDemo(false); setAutoInfo(i => i ? { ...i, mode: "manual" } : null); }
    catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setReading(false); }
  }
  async function rotateImage() {
    pendingPaste.current = null;
    if (!imageUrl) return;
    setReading(true);
    try {
      const el = new Image(); el.src = imageUrl; await el.decode();
      setImage(await cropImage(imageUrl, { x: 0, y: 0, width: el.naturalHeight, height: el.naturalWidth }, 90));
      setResult(null); setIsDemo(false);
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setReading(false); }
  }
  async function analyze(targetImage: Blob | null = image) {
    if (!targetImage || busy || analysisBusy.current) return;
    analysisBusy.current = true;
    setResult(null); setNotice(null); setBusy("analyze");
    try {
      const body = new FormData(); body.append("image", targetImage, "challenge.jpg");
      const data = await request<AnalysisResult>("/api/analyze", { method: "POST", body });
      setResult({ ...data, analysis: validateAnalysis(data.analysis) });
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } catch (e) { setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(null); analysisBusy.current = false; }
  }
  function pasteImage(e: React.ClipboardEvent<HTMLElement>) {
    e.preventDefault();
    if (busy || reading || fileBusy.current || analysisBusy.current) return;
    const file = Array.from(e.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile()
      || Array.from(e.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!file) { setNotice({ kind: "info", text: "Clipboard chưa có ảnh. Hãy sao chép ảnh hoặc chụp màn hình rồi dán lại." }); return; }
    pendingPaste.current = acceptFile(file);
  }
  async function analyzeOnEnter(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.target !== e.currentTarget) return;
    e.preventDefault();
    if (e.repeat || enterBusy.current || busy || analysisBusy.current || cropOpen || cameraOpen || login || showHelp) return;
    if (locked) { setLogin(true); return; }
    enterBusy.current = true;
    try {
      const pending = pendingPaste.current;
      const target = pending ? await pending : image;
      if (pendingPaste.current === pending) pendingPaste.current = null;
      if (target) await analyze(target);
    } finally { enterBusy.current = false; }
  }
  async function checkConnection() {
    if (busy) return;
    setBusy("connection"); setNotice(null); setConnectionVerified(null);
    try {
      const data = await request<{ message: string; elapsedMs: number }>("/api/connection", { method: "POST" }, 45_000);
      setNotice({ kind: "success", text: `${data.message} (${(data.elapsedMs / 1000).toFixed(1)} giây)` });
      setConnectionVerified(true);
      void refreshStatus();
    } catch (e) { setConnectionVerified(false); setNotice({ kind: "error", text: (e as Error).message }); }
    finally { setBusy(null); }
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setLoginBusy(true); setLoginError("");
    try { await request("/api/session", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) }); setPassword(""); setLogin(false); await refreshStatus(); }
    catch (e) { setLoginError((e as Error).message); }
    finally { setLoginBusy(false); }
  }
  async function copyText() {
    const text = result?.analysis.suggestedAnswer || result?.analysis.recognizedText;
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { setNotice({ kind: "info", text: "Chưa sao chép được. Hãy nhấn giữ phần chữ Hàn để chọn và sao chép thủ công." }); }
  }
  function clearImage() {
    if (reading || busy) return;
    pendingPaste.current = null;
    setImage(null); setImageUrl(null); setOriginalImage(null); setAutoInfo(null);
    setImageName(""); setResult(null); setNotice(null); setIsDemo(false); setCopied(false);
    setCropOpen(false); setPixels(null); setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); setDragging(false);
    if (upload.current) upload.current.value = "";
    if (nativeCamera.current) nativeCamera.current.value = "";
    imagePanelRef.current?.focus({ preventScroll: true });
    imagePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function takeNewPhoto() {
    if (reading || busy) return;
    clearImage();
    void openCamera();
  }
  const locked = Boolean(status && !status.authenticated && status.authRequired);

  return <>
    <header className="topbar"><div className="topbar-inner">
      <a className="brand" href="/" aria-label="MapleLens trang chủ"><MapleMark /><span>Maple<span className="brand-light">Lens</span></span><span className="beta">BETA</span></a>
      <div className="header-actions"><span className="private-tag"><ShieldCheck size={15} /> Ảnh của bạn, quyền của bạn</span><button className="icon-button" aria-label="Hướng dẫn sử dụng" onClick={() => setShowHelp(true)}><CircleHelp size={20} /></button></div>
    </div></header>
    <main className="main-shell">
      <section className="hero">
        <div className="hero-copy"><div className="eyebrow"><span className="status-dot" /> TRỢ LÝ TIẾNG HÀN · MAPLESTORY PC</div>
          <h1>Đọc thử thách.<br /><span>Tiếp tục hành trình.</span></h1>
          <p>Chụp màn hình, tự tìm và cắt popup thử thách.<br className="desktop-br" /> AI phân biệt hai dạng và gợi ý cách đọc.</p>
          <div className="feature-pills"><span><ScanLine size={14} /> Chữ biến dạng</span><span><CheckCheck size={14} /> Chọn câu đúng</span><span><LockKeyhole size={13} /> Không lưu ảnh</span></div>
        </div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><span className="art-spark one">✦</span><span className="art-spark two">+</span><div className="floating-leaf"><Leaf size={37} /></div><div className="korean-card"><span className="art-label"><span /> KOREAN CHALLENGE</span><strong lang="ko">한글을 읽다</strong><div className="art-scan" /><span className="art-card-footer"><ScanLine size={13} /> Từng nét chữ, thêm rõ ràng.</span></div><div className="art-check"><Check size={18} /></div><div className="art-caption">한 걸음씩, 함께.<span>Từng bước, cùng bạn.</span></div></div>
      </section>

      <div className="connection-strip"><div className="connection-state"><span className={`connection-dot ${status?.configured ? "configured" : ""}`} /><span>{status?.configured ? connectionVerified === true ? "Gemini đã kết nối" : connectionVerified === false ? "Kết nối chưa thành công" : "Gemini đã được cấu hình" : "Chế độ dùng thử"}</span><span className="connection-detail">{status?.configured ? connectionVerified ? "Chưa xác minh độ chính xác" : "Bấm kiểm tra để xác nhận" : "Thử xử lý ảnh, chưa cần API key"}</span></div><div className="connection-buttons">{locked && <button className="text-button" onClick={() => setLogin(true)}><LockKeyhole size={13} /> Mở khóa</button>}<button className="text-button" onClick={checkConnection} disabled={!!busy}>{busy === "connection" ? <LoaderCircle className="spin" size={14} /> : <Wifi size={14} />}<span>{busy === "connection" ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</span></button></div></div>
      {notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><AlertCircle size={18} /><span>{notice.text}</span><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setNotice(null)}><X size={16} /></button></div>}

      <div className="workspace">
        <section ref={imagePanelRef} className="panel image-panel" aria-labelledby="image-title" aria-describedby="paste-hint" tabIndex={0} onPaste={pasteImage} onKeyDown={analyzeOnEnter} onClick={e => { if (!(e.target as HTMLElement).closest("button, input, a")) e.currentTarget.focus({ preventScroll: true }); }}>
          <div className="panel-heading"><div className="panel-title"><span className="step-number">01</span><h2 id="image-title">Ảnh thử thách</h2></div><span className="heading-meta">TỰ QUÉT · TỰ CẮT</span></div>
          <p id="paste-hint" className="paste-hint">Bấm vào ô này → <kbd>Ctrl + V</kbd> dán ảnh → <kbd>Enter</kbd> phân tích. Mac: <kbd>⌘ + V</kbd>.</p>
          <input ref={upload} className="sr-only" aria-label="Chọn ảnh thử thách" type="file" accept={ACCEPTED_TYPES.join(",")} onChange={e => { void acceptFile(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={nativeCamera} className="sr-only" aria-label="Chụp bằng camera hệ thống" type="file" accept="image/*" capture="environment" onChange={e => { void acceptFile(e.target.files?.[0]); e.target.value = ""; }} />
          {!imageUrl ? <div className={`upload-zone ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void acceptFile(e.dataTransfer.files[0]); }}>
            <div className="upload-illustration" aria-hidden="true"><div className="scan-corner tl" /><div className="scan-corner tr" /><div className="scan-corner bl" /><div className="scan-corner br" /><span className="sample-glyph" lang="ko">한</span><span className="tiny-spark">✦</span><span className="camera-badge"><Camera size={17} /></span></div>
            <h3>{reading ? "Đang tự tìm popup…" : "Chụp ảnh, tự tìm thử thách"}</h3><p>Giữ trọn popup trong khung hình.<br />MapleLens tự quét và cắt vùng cần đọc.</p>
            <button className="primary camera-primary" onClick={openCamera} disabled={reading || !!busy}><Camera size={18} /> Mở camera sau <ArrowRight size={17} /></button>
            <button className="secondary upload-secondary" onClick={() => upload.current?.click()} disabled={reading || !!busy}><ImagePlus size={17} /> Chọn ảnh từ thư viện</button>
            <span className="upload-hint">JPEG, PNG, WebP · Ảnh gốc tối đa 15 MB</span>
          </div> : <div className="image-workspace">
            <div className="image-toolbar">
              <span><span className="status-dot" />{isDemo ? "Ảnh minh họa tự tạo" : "Ảnh sẵn sàng"}</span>
              <div>
                <button title="Cắt vùng thử thách" aria-label="Cắt vùng thử thách" onClick={openCrop} disabled={reading || !!busy}><Crop size={17} /> Chỉnh</button>
                <button title="Xoay ảnh 90 độ" aria-label="Xoay ảnh 90 độ" onClick={rotateImage} disabled={reading || !!busy}><RotateCw size={17} /> Xoay</button>
                <button title="Chọn ảnh khác từ thư viện" aria-label="Đổi ảnh" onClick={() => upload.current?.click()} disabled={reading || !!busy}><ImagePlus size={17} /> Đổi ảnh</button>
                <button title="Xóa ảnh này" aria-label="Xóa ảnh" onClick={clearImage} disabled={reading || !!busy} className="delete-image-btn"><X size={17} /> Xóa ảnh</button>
              </div>
            </div>
            {autoInfo && <div className={`popup-status ${autoInfo.found ? "found" : "not-found"}`} role="status"><ScanLine size={17} /><div><b>{autoInfo.mode === "original" ? "Đang xem ảnh gốc" : autoInfo.mode === "manual" ? "Đã chỉnh vùng ảnh" : autoInfo.found ? `${autoInfo.alreadyFramed ? "Popup đã nằm gọn trong ảnh" : "Đã tự cắt popup"} · ${autoInfo.elapsedMs} ms` : "Chưa tìm rõ popup · giữ nguyên ảnh"}</b><span>{autoInfo.typeHint !== "unknown" ? `${typeLabels[autoInfo.typeHint]} · nhận dạng bố cục, AI sẽ xác nhận` : "AI sẽ tự xác định loại khi bạn bấm Phân tích"}</span></div>{originalImage && (image !== originalImage || autoInfo.mode === "original") && <button onClick={restoreOrScan} disabled={reading || !!busy}>{image !== originalImage ? "Ảnh gốc" : "Quét lại"}</button>}</div>}
            <div className="image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl} alt="Ảnh thử thách đã chọn để xem trước" />
              <button 
                type="button" 
                className="image-remove-badge" 
                title="Xóa ảnh để chèn ảnh khác" 
                aria-label="Xóa ảnh" 
                onClick={clearImage} 
                disabled={reading || !!busy}
              >
                <X size={18} />
              </button>
              {reading && <div className="image-loading"><LoaderCircle className="spin" /> Đang xử lý…</div>}
            </div>
            <div className="image-file"><FileImage size={14} /><span>{imageName}</span><span>{image ? `${Math.round(image.size / 1024)} KB` : ""}</span></div>
            <div className="image-tip"><ShieldCheck size={15} /><span>Tự quét trên thiết bị. Giữ đủ câu hỏi và mọi lựa chọn trong ảnh xem trước.</span></div>
          </div>}
          <div className="image-panel-footer">{!imageUrl ? <div className="demo-invite"><span>Chưa có ảnh trong tay?</span><button onClick={loadDemo} disabled={reading || !!busy}>Thử ảnh minh họa <ArrowRight size={14} /></button></div> : <div className="analyze-actions"><button className="primary analyze-button" onClick={locked ? () => setLogin(true) : () => void analyze()} disabled={reading || !!busy}>{busy === "analyze" ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{busy === "analyze" ? `Đang phân tích · ${elapsed}s` : "Phân tích ảnh"}{busy !== "analyze" && <ArrowRight size={17} />}</button>{isDemo && <button className="demo-result-button" onClick={() => { setResult(demoResult); setNotice(null); resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Xem kết quả minh họa <ArrowRight size={13} /></button>}<span className="upload-hint"><ShieldCheck size={12} /> Gửi ảnh khi bấm Phân tích hoặc Enter</span></div>}</div>
        </section>

        <section ref={resultRef} className={`panel result-panel ${result ? "has-result" : ""}`} aria-labelledby="result-title" aria-live="polite" aria-busy={busy === "analyze"}>
          <div className="panel-heading"><div className="panel-title"><span className="step-number muted">02</span><h2 id="result-title">Kết quả phân tích</h2></div><span className="ai-tag"><Sparkles size={12} /> GEMINI</span></div>
          {busy === "analyze" ? <div className="result-empty"><div className="result-orb processing"><ScanLine size={29} /></div><h3>Đang đọc từng nét chữ…</h3><p>Gemini đang xem ảnh của bạn.<br />Kết quả thường cần một chút thời gian.</p><span className="elapsed"><Clock3 size={14} /> {elapsed} giây · Có thể chờ tối đa 45 giây</span></div> : result ? <div className="result-body">
            {result.source === "demo" && <div className="demo-banner"><Sparkles size={15} /><span>KẾT QUẢ MINH HỌA · VIẾT SẴN<br /><small>Không gọi Gemini, không dùng để trả lời ảnh khác.</small></span></div>}
            <div className="result-type"><span>{typeLabels[result.analysis.challengeType]}</span><span className="elapsed"><Clock3 size={12} />{result.source === "demo" ? "Minh họa" : `${(result.elapsedMs / 1000).toFixed(1)}s`}</span></div>
            {result.analysis.challengeType !== "sentence_choice" && <><div className="result-label">CHỮ NHẬN DIỆN ĐƯỢC</div><div className="recognized" lang="ko">{result.analysis.recognizedText || "Chưa đọc được nội dung"}</div></>}
            <div className={`answer-box ${result.analysis.needsClearerImage ? "uncertain" : ""}`}><div className="result-label">{result.analysis.needsClearerImage ? "CẦN ẢNH RÕ HƠN" : "ĐÁP ÁN ĐỀ XUẤT"}</div>{result.analysis.challengeType === "sentence_choice" && result.analysis.selectedOption && <div className="choice-line">Dòng {result.analysis.selectedOption}<small>Đếm từ trên xuống</small></div>}<strong lang={result.analysis.suggestedAnswer ? "ko" : "vi"}>{result.analysis.suggestedAnswer ? <>{result.analysis.suggestedAnswer}</> : "Chưa đủ cơ sở để đề xuất"}</strong><span><AlertCircle size={12} /> Gợi ý cần bạn kiểm tra lại</span></div>
            {result.analysis.uncertainSegments.length > 0 && <div className="uncertainty-list"><h3>Phần chưa chắc chắn</h3>{result.analysis.uncertainSegments.map((s, i) => <p key={i}><b lang="ko">{s.text}</b>: {s.reason}{s.alternatives.length > 0 && <span> · Có thể là: <span lang="ko">{s.alternatives.join(" / ")}</span></span>}</p>)}</div>}
            <KoreanTypingGuide key={JSON.stringify(result.analysis)} analysis={result.analysis} />
            {result.analysis.challengeType !== "sentence_choice" && <div className="explanation"><h3><Sparkles size={14} /> Giải thích</h3><p>{result.analysis.explanation}</p></div>}

            <button className="secondary copy-button" onClick={copyText} disabled={!result.analysis.recognizedText}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Đã sao chép" : "Sao chép chữ Hàn"}</button>
            <div className="next-image-actions"><button className="secondary" onClick={clearImage} disabled={reading || !!busy}><Trash2 size={16} /> Xóa ảnh</button><button className="primary" onClick={takeNewPhoto} disabled={reading || !!busy}><Camera size={17} /> Chụp ảnh mới</button></div>
          </div> : <><div className="result-empty"><div className="result-orb"><ScanLine size={29} /><span className="orb-spark">✦</span></div><h3>Thêm một chút rõ ràng.</h3><p>Kết quả sẽ xuất hiện ở đây<br />sau khi bạn phân tích ảnh.</p><div className="empty-lines"><span /><span /><span /></div></div><div className="result-placeholder-footer"><span className="small-dot" /> Sẵn sàng khi bạn sẵn sàng</div></>}
          <div className="result-disclaimer"><ShieldCheck size={14} /><p>AI có thể đọc sai. Chỉ tham khảo gợi ý và tự thao tác trong game.</p></div>
        </section>
      </div>

      <section className="how-it-works" aria-label="Cách sử dụng"><div className="how-title"><span>CÁCH DÙNG</span><h2>Ba bước, thật gọn.</h2></div><div className="how-step"><span className="how-icon"><Camera size={19} /></span><div><h3>01. Chụp hoặc chọn ảnh</h3><p>Giữ điện thoại thẳng, tránh lóa màn hình.</p></div></div><ArrowRight className="how-arrow" size={17} /><div className="how-step"><span className="how-icon"><Crop size={19} /></span><div><h3>02. Tự tìm và cắt popup</h3><p>Quét nhanh ngay trên điện thoại.</p></div></div><ArrowRight className="how-arrow" size={17} /><div className="how-step"><span className="how-icon"><Sparkles size={19} /></span><div><h3>03. Tự phân loại, nhận gợi ý</h3><p>Chữ biến dạng hoặc chọn câu đúng.</p></div></div></section>
      <footer className="page-footer"><span><MapleMark small /> Làm rõ từng nét chữ.</span><span>Dự án thử nghiệm độc lập · Không liên kết với Nexon</span><span className="footer-version">v0.1 BETA <span /></span></footer>
    </main>

    {cropOpen && imageUrl && <Modal title="Cắt vùng thử thách" onClose={() => setCropOpen(false)} className="crop-modal"><p className="modal-subtitle">Kéo ảnh, dùng hai ngón để phóng to. Giữ đủ nội dung cần đọc.</p><div className="crop-stage"><Cropper image={imageUrl} crop={crop} zoom={zoom} rotation={rotation} aspect={aspect} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, area) => setPixels(area)} showGrid /></div><div className="crop-controls"><label><ZoomIn size={16} /> Phóng to<input aria-label="Phóng to ảnh" type="range" min="1" max="4" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><label><Expand size={16} /> Tỉ lệ khung<input aria-label="Tỉ lệ khung cắt" type="range" min="0.6" max="4" step="0.1" value={aspect} onChange={e => setAspect(Number(e.target.value))} /></label><div className="crop-rotation"><button className="secondary" onClick={() => setRotation(r => r - 90)}><RotateCcw size={16} /> −90°</button><label>Nghiêng {rotation}°<input aria-label="Góc xoay ảnh" type="range" min="-180" max="180" step="1" value={rotation} onChange={e => setRotation(Number(e.target.value))} /></label><button className="secondary" onClick={() => setRotation(r => r + 90)}><RotateCw size={16} /> +90°</button></div></div><button className="primary full-width" disabled={!pixels || reading} onClick={applyCrop}>{reading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Dùng vùng ảnh này</button></Modal>}
    {cameraOpen && <Modal title="Chụp vùng thử thách" onClose={closeCamera} className="camera-modal"><p className="modal-subtitle">Giữ camera sau thẳng với màn hình. Không gửi video đến API.</p><div className="camera-stage"><video ref={video} playsInline autoPlay muted /><div className="camera-guide" />{!cameraReady && !cameraError && <span className="camera-wait"><LoaderCircle size={22} className="spin" /> Đang mở camera…</span>}</div>{cameraError && <p role="alert" className="inline-error">{cameraError}</p>}<button className="primary full-width" disabled={!cameraReady} onClick={capture}><Camera size={18} /> Chụp ảnh</button><button className="secondary full-width" onClick={() => { closeCamera(); upload.current?.click(); }}><ImagePlus size={17} /> Chọn ảnh từ thư viện</button></Modal>}
    {login && <Modal title="Mở khóa ứng dụng" onClose={() => { setLogin(false); setPassword(""); }}><p className="modal-subtitle">Nhập mật khẩu ứng dụng do chủ máy chủ thiết lập. Không nhập Gemini API key ở đây.</p><form onSubmit={signIn}><label className="field-label" htmlFor="app-password">Mật khẩu ứng dụng</label><input id="app-password" className="password-input" type="password" autoComplete="current-password" autoFocus required value={password} onChange={e => setPassword(e.target.value)} />{loginError && <p className="inline-error" role="alert">{loginError}</p>}<button className="primary full-width" disabled={loginBusy}>{loginBusy ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />} Mở khóa</button></form></Modal>}
    {showHelp && <Modal title="Một chút hướng dẫn" onClose={() => setShowHelp(false)}><div className="help-content"><p><b>1. Chụp hoặc chọn ảnh.</b> Camera trực tiếp cần HTTPS và quyền camera. Nếu bị từ chối, chọn ảnh từ thư viện.</p><p><b>2. Tự tìm popup.</b> Ảnh vừa chọn được quét và cắt ngay trên thiết bị, không cần API. Nhãn loại ban đầu dựa trên bố cục; AI xác nhận khi phân tích. Nếu chưa tìm rõ, ứng dụng giữ nguyên ảnh. Bạn có thể xem ảnh gốc, chỉnh vùng hoặc xoay khi cần.</p><p><b>3. Bấm Phân tích.</b> AI tự phân biệt chữ biến dạng và chọn câu. Chỉ ảnh xem trước được gửi đến máy chủ và Gemini. Ứng dụng không lưu ảnh mặc định.</p><p><b>Chưa có API key?</b> Thử ảnh minh họa và xem kết quả viết sẵn. Key thật chỉ được cấu hình trên máy chủ.</p><p><b>Kiểm tra kết nối</b> dùng một yêu cầu văn bản ngắn; thành công không có nghĩa là AI giải đúng thử thách.</p><p>Chỉ dùng gợi ý trên điện thoại. Ứng dụng không tương tác với game. Chưa có dữ liệu đánh giá độ chính xác.</p></div></Modal>}
  </>;
}

function Modal({ title, onClose, className = "", children }: { title: string; onClose: () => void; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (ref.current?.querySelector<HTMLElement>('input[type="password"]') ?? ref.current)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), [tabindex="0"]');
        if (!items?.length) return;
        const first = items[0]; const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div ref={ref} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className={`modal ${className}`}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Đóng"><X size={20} /></button></div>{children}</div></div>;
}
