"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { AlertCircle, ArrowRight, Camera, Check, CircleHelp, ClipboardPaste, Clock3, Crop, Expand, History, ImagePlus, LoaderCircle, Lock, LockKeyhole, RotateCcw, RotateCw, ScanLine, ShieldCheck, Sparkles, Trash2, Unlock, Wifi, X, Zap, ZoomIn } from "lucide-react";
import { ACCEPTED_TYPES, type AnalysisResult, type ApiErrorBody, type ServerStatus, validateAnalysis } from "@/lib/contracts";
import { autoCropPopup, canvasBlob, cropImage, prepareAndCropFile, prepareFile, type PixelCrop } from "@/lib/image";
import type { PopupType } from "@/lib/popup-detection";
import { demoResult } from "@/lib/demo";
import { clearHistoryEntries, deleteHistoryEntry, listHistoryEntries, saveHistoryEntry, type HistoryEntry } from "@/lib/history-db";

type Notice = { kind: "error" | "success" | "info"; text: string };
const PREVIEW_ONLY = process.env.NEXT_PUBLIC_PREVIEW_ONLY === "true";

async function request<T>(path: string, init?: RequestInit, timeout = 25_000, abortSignal?: AbortSignal): Promise<T> {
  if (PREVIEW_ONLY) {
    if (path === "/api/status") return { configured: false, model: "demo", authenticated: true, authRequired: false, authUnavailable: false, locked: false } as T;
    throw new Error("Đây là demo giao diện chưa kết nối AI.");
  }
  const timeoutSignal = AbortSignal.timeout(timeout);
  const combinedSignal = abortSignal ? AbortSignal.any([timeoutSignal, abortSignal]) : timeoutSignal;
  try {
    const res = await fetch(path, { ...init, signal: combinedSignal, cache: "no-store" });
    let data: T & ApiErrorBody;
    try { data = await res.json(); }
    catch { throw new Error("Máy chủ trả về dữ liệu không hợp lệ. Chưa có kết quả phân tích."); }
    if (!res.ok) {
      const err = new Error(data.error?.message || "Yêu cầu chưa thành công. Vui lòng thử lại.") as Error & { status?: number; code?: string };
      err.status = res.status;
      err.code = data.error?.code;
      throw err;
    }
    return data;
  } catch (e) {
    if ((e as Error).name === "AbortError" && abortSignal?.aborted) throw e;
    if ((e as Error).name === "TimeoutError" || (e as Error).name === "AbortError") throw new Error("Quá thời gian chờ (25s). Hãy thử lại hoặc chọn ảnh rõ hơn.");
    if (e instanceof TypeError) throw new Error("Không kết nối được máy chủ. Kiểm tra mạng và thử lại.");
    throw e;
  }
}

function MapleMark({ small = false }: { small?: boolean }) {
  const size = small ? 20 : 28;
  return (
    <span className={`maple-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <path
          d="M32 10L36 22L43 18.2L40.4 26.8L50 27.8L43.8 33.8L47.6 40.2L38.4 39.4L37.6 45.2L33.4 42.6V54H30.6V42.6L26.4 45.2L25.6 39.4L16.4 40.2L20.2 33.8L14 27.8L23.6 26.8L21 18.2L28 22L32 10Z"
          fill="#ff995d"
          stroke="#ffd4b8"
          strokeOpacity="0.45"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <circle cx="49" cy="15" r="4" fill="#34d399" />
      </svg>
    </span>
  );
}

export default function MapleApp() {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [appToken, setAppToken] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [image, setImage] = useState<Blob | null>(null);
  const [originalImage, setOriginalImage] = useState<Blob | null>(null);
  const [autoInfo, setAutoInfo] = useState<{ found: boolean; alreadyFramed: boolean; typeHint: PopupType; elapsedMs: number; mode: "auto" | "original" | "manual" } | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageName, setImageName] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const [autoSolve, setAutoSolve] = useState(true);
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState<"analyze" | "connection" | null>(null);
  const [connectionVerified, setConnectionVerified] = useState<boolean | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyItems, setHistoryItems] = useState<{ entry: HistoryEntry; url: string }[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreviewUrl, setHistoryPreviewUrl] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [cropOpen, setCropOpen] = useState(false);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [aspect, setAspect] = useState(1.2);
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
  const originalFileRef = useRef<File | null>(null);
  const pendingPaste = useRef<Promise<Blob | null> | null>(null);
  const fileBusy = useRef(false);
  const analysisBusy = useRef(false);
  const enterBusy = useRef(false);
  const resultRef = useRef<HTMLElement>(null);
  const activeAbort = useRef<AbortController | null>(null);
  const inputTimestamp = useRef<number>(0);

  const lockedByAdmin = Boolean(status?.locked);
  const needsPassword = Boolean(status && status.authRequired && !status.authenticated && !appToken);

  const refreshStatus = useCallback(async () => {
    try { setStatus(await request<ServerStatus>("/api/status", undefined, 10_000)); }
    catch { setNotice({ kind: "error", text: "Chưa kết nối được máy chủ." }); }
  }, []);

  useEffect(() => { void refreshStatus(); }, [refreshStatus]);

  // Requirement 2: Keep serverless function warm by pinging /api/status every 5 minutes while tab is open
  useEffect(() => {
    if (PREVIEW_ONLY) return;
    const timer = setInterval(() => {
      void fetch("/api/status", { cache: "no-store" })
        .then(r => (r.ok ? r.json() : null))
        .then(data => { if (data) setStatus(data); })
        .catch(() => {});
    }, 5 * 60_000);
    return () => clearInterval(timer);
  }, []);

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
    if (!cropOpen && !cameraOpen && !showHelp && !historyOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [cropOpen, cameraOpen, showHelp, historyOpen]);

  const historyUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    historyUrlsRef.current = historyItems.map(i => i.url);
  }, [historyItems]);

  useEffect(() => {
    return () => {
      for (const url of historyUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  async function openHistory() {
    setHistoryOpen(true);
    setHistoryPreviewUrl(null);
    setHistoryLoading(true);
    try {
      for (const url of historyUrlsRef.current) URL.revokeObjectURL(url);
      const entries = await listHistoryEntries();
      setHistoryItems(entries.map(entry => ({ entry, url: URL.createObjectURL(entry.imageBlob) })));
    } finally {
      setHistoryLoading(false);
    }
  }
  function closeHistory() {
    setHistoryOpen(false);
    setHistoryPreviewUrl(null);
    for (const url of historyUrlsRef.current) URL.revokeObjectURL(url);
    setHistoryItems([]);
  }
  async function removeHistoryItem(id: string) {
    await deleteHistoryEntry(id);
    setHistoryItems(prev => {
      const removed = prev.find(i => i.entry.id === id);
      if (removed) {
        if (historyPreviewUrl === removed.url) setHistoryPreviewUrl(null);
        URL.revokeObjectURL(removed.url);
      }
      return prev.filter(i => i.entry.id !== id);
    });
  }
  async function clearAllHistory() {
    await clearHistoryEntries();
    setHistoryPreviewUrl(null);
    for (const url of historyUrlsRef.current) URL.revokeObjectURL(url);
    setHistoryItems([]);
  }

  async function acceptFile(file?: File): Promise<Blob | null> {
    if (!file || fileBusy.current) return null;
    inputTimestamp.current = performance.now();
    activeAbort.current?.abort();
    activeAbort.current = null;
    analysisBusy.current = false;
    setBusy(null);
    pendingPaste.current = null;
    fileBusy.current = true;
    setReading(true); setNotice(null); setResult(null); setImage(null); setOriginalImage(null); setAutoInfo(null);
    originalFileRef.current = file;
    let outBlob: Blob | null = null;
    let outHint: PopupType = "unknown";
    let outCropMs = 0;
    try {
      const scanned = await prepareAndCropFile(file);
      outBlob = scanned.blob;
      outHint = scanned.detection?.typeHint || "unknown";
      outCropMs = scanned.elapsedMs;
      setImage(scanned.blob);
      setImageName(file.name);
      setIsDemo(false);
      setAutoInfo({
        found: !!scanned.detection,
        alreadyFramed: !!scanned.detection?.alreadyFramed,
        typeHint: outHint,
        elapsedMs: scanned.elapsedMs,
        mode: "auto",
      });
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
      return null;
    } finally {
      setReading(false);
      fileBusy.current = false;
    }

    if (outBlob && autoSolve && !needsPassword && !lockedByAdmin && !PREVIEW_ONLY && status?.configured !== false) {
      void analyze(outBlob, outHint, outCropMs);
    }
    return outBlob;
  }

  async function loadDemo() {
    pendingPaste.current = null;
    originalFileRef.current = null;
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
    if ((!originalImage && !originalFileRef.current) || reading || busy) return;
    pendingPaste.current = null;
    setResult(null);
    setReading(true);
    try {
      let baseOriginal = originalImage;
      if (!baseOriginal && originalFileRef.current) {
        baseOriginal = await prepareFile(originalFileRef.current);
        setOriginalImage(baseOriginal);
      }
      if (!baseOriginal) return;
      if (autoInfo?.mode !== "original") {
        setImage(baseOriginal);
        setAutoInfo(i => i ? { ...i, mode: "original" } : null);
        return;
      }
      const scanned = await autoCropPopup(baseOriginal);
      setImage(scanned.blob);
      setAutoInfo({ found: !!scanned.detection, alreadyFramed: !!scanned.detection?.alreadyFramed, typeHint: scanned.detection?.typeHint || "unknown", elapsedMs: scanned.elapsedMs, mode: "auto" });
    } catch { setNotice({ kind: "info", text: "Chưa tìm được popup. Ứng dụng giữ ảnh gốc để phân tích đầy đủ." }); }
    finally { setReading(false); }
  }
  async function applyCrop() {
    if (!pixels || !imageUrl) return;
    setReading(true);
    try {
      const cropped = await cropImage(imageUrl, pixels, rotation);
      setImage(cropped); setResult(null); setCropOpen(false); setIsDemo(false);
      setAutoInfo(i => i ? { ...i, mode: "manual" } : null);
      if (autoSolve && !needsPassword && !lockedByAdmin && !PREVIEW_ONLY && status?.configured !== false) {
        void analyze(cropped);
      }
    }
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
  async function analyze(targetImage: Blob | null = image, hintOverride?: PopupType, cropScanMsOverride?: number) {
    if (!targetImage || analysisBusy.current) return;
    activeAbort.current?.abort();
    const controller = new AbortController();
    activeAbort.current = controller;
    analysisBusy.current = true;
    setResult(null); setNotice(null); setBusy("analyze");
    const tActionStart = performance.now();
    try {
      const body = new FormData(); body.append("image", targetImage, "challenge.jpg");
      const hint = hintOverride ?? autoInfo?.typeHint;
      if (hint && hint !== "unknown") {
        body.append("typeHint", hint);
      }
      const headers: Record<string, string> = {};
      if (appToken) headers["x-app-token"] = appToken;

      const tNetworkStart = performance.now();
      const data = await request<AnalysisResult>("/api/analyze", { method: "POST", body, headers }, 10_000, controller.signal);
      const networkMs = Math.round(performance.now() - tNetworkStart);
      const actionToAnswerMs = Math.round(performance.now() - tActionStart);
      const totalFromInputMs = inputTimestamp.current ? Math.round(performance.now() - inputTimestamp.current) : actionToAnswerMs;

      const timings = {
        actionToAnswerMs,
        totalFromInputMs,
        cropScanMs: cropScanMsOverride ?? autoInfo?.elapsedMs ?? 0,
        networkMs,
        serverMs: data.serverMs || 0,
        geminiMs: data.geminiMs || 0,
        imagePrepMs: data.imagePrepMs || 0,
      };

      const validated = validateAnalysis(data.analysis);
      setResult({ ...data, analysis: validated, timings });
      resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

      // Save to local IndexedDB strictly after displaying the answer (0 ms impact on solve speed)
      const savePayload = {
        ts: Date.now(),
        imageBlob: targetImage,
        selectedOption: validated.selectedOption,
        suggestedAnswer: validated.suggestedAnswer,
        needsClearerImage: validated.needsClearerImage,
        confidence: validated.confidence,
        actionToAnswerMs,
        geminiMs: data.geminiMs || 0,
      };
      queueMicrotask(() => { void saveHistoryEntry(savePayload); });
    } catch (e) {
      const err = e as Error & { status?: number; code?: string };
      if (err.name === "AbortError" && controller.signal.aborted) return;
      if (err.status === 401) {
        setAppToken(null);
        void refreshStatus();
      } else if (err.code === "DOMAIN_LOCKED" || err.status === 403) {
        void refreshStatus();
      }
      setNotice({ kind: "error", text: err.message });
    } finally {
      if (activeAbort.current === controller) {
        setBusy(null);
        analysisBusy.current = false;
        activeAbort.current = null;
      }
    }
  }
  function pasteImage(e: React.ClipboardEvent<HTMLElement>) {
    e.preventDefault();
    if (fileBusy.current) return;
    const file = Array.from(e.clipboardData.items).find(item => item.kind === "file" && item.type.startsWith("image/"))?.getAsFile()
      || Array.from(e.clipboardData.files).find(file => file.type.startsWith("image/"));
    if (!file) { setNotice({ kind: "info", text: "Clipboard chưa có ảnh. Hãy sao chép ảnh hoặc chụp màn hình rồi dán lại." }); return; }
    pendingPaste.current = acceptFile(file);
  }
  async function pasteFromClipboard() {
    if (fileBusy.current || reading || busy) return;
    setNotice(null);
    if (!navigator.clipboard || typeof navigator.clipboard.read !== "function") {
      imagePanelRef.current?.focus({ preventScroll: true });
      setNotice({ kind: "info", text: "Trình duyệt chưa hỗ trợ nút dán trực tiếp. Bạn hãy bấm vào ô này và nhấn Ctrl + V (hoặc ⌘ + V) để dán ảnh." });
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      let imageBlob: Blob | null = null;
      let mimeType = "image/png";
      for (const item of items) {
        const type = item.types.find(t => t.startsWith("image/"));
        if (type) {
          imageBlob = await item.getType(type);
          mimeType = type;
          break;
        }
      }
      if (!imageBlob) {
        setNotice({ kind: "info", text: "Trong bộ nhớ tạm (clipboard) chưa có ảnh. Hãy chụp màn hình hoặc sao chép ảnh rồi bấm Dán ảnh." });
        return;
      }
      const ext = mimeType.split("/")[1] || "png";
      const file = new File([imageBlob], `clipboard-${Date.now()}.${ext}`, { type: mimeType });
      const task = acceptFile(file);
      pendingPaste.current = task;
      await task;
    } catch (e) {
      imagePanelRef.current?.focus({ preventScroll: true });
      const err = e as Error;
      if (err.name === "NotAllowedError" || err.message?.toLowerCase().includes("denied") || err.message?.toLowerCase().includes("permission")) {
        setNotice({ kind: "info", text: "Chưa được cấp quyền truy cập clipboard. Bạn hãy nhấn Ctrl + V (hoặc ⌘ + V) để dán trực tiếp." });
      } else {
        setNotice({ kind: "info", text: "Không đọc được ảnh từ clipboard. Bạn hãy nhấn Ctrl + V (hoặc ⌘ + V) để dán trực tiếp." });
      }
    }
  }
  async function analyzeOnEnter(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key !== "Enter" || e.nativeEvent.isComposing || e.target !== e.currentTarget) return;
    e.preventDefault();
    if (e.repeat || enterBusy.current || busy || analysisBusy.current || cropOpen || cameraOpen || showHelp || needsPassword || lockedByAdmin) return;
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
      const headers: Record<string, string> = {};
      if (appToken) headers["x-app-token"] = appToken;
      const data = await request<{ message: string; elapsedMs: number }>("/api/connection", { method: "POST", headers }, 45_000);
      setNotice({ kind: "success", text: `${data.message} (${(data.elapsedMs / 1000).toFixed(1)} giây)` });
      setConnectionVerified(true);
      void refreshStatus();
    } catch (e) {
      const err = e as Error & { status?: number };
      if (err.status === 401) {
        setAppToken(null);
        void refreshStatus();
      }
      setConnectionVerified(false);
      setNotice({ kind: "error", text: err.message });
    } finally { setBusy(null); }
  }
  async function signIn(e: React.FormEvent) {
    e.preventDefault(); setLoginBusy(true); setLoginError("");
    try {
      const res = await request<{ ok: boolean; token?: string; locked?: boolean }>("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      setPassword("");
      if (res.token) setAppToken(res.token);
      await refreshStatus();
    }
    catch (e) { setLoginError((e as Error).message); }
    finally { setLoginBusy(false); }
  }
  function clearImage() {
    activeAbort.current?.abort();
    activeAbort.current = null;
    analysisBusy.current = false;
    setBusy(null);
    setReading(false);
    pendingPaste.current = null;
    originalFileRef.current = null;
    inputTimestamp.current = 0;
    setImage(null); setImageUrl(null); setOriginalImage(null); setAutoInfo(null);
    setImageName(""); setResult(null); setNotice(null); setIsDemo(false);
    setCropOpen(false); setPixels(null); setCrop({ x: 0, y: 0 }); setZoom(1); setRotation(0); setDragging(false);
    if (upload.current) upload.current.value = "";
    if (nativeCamera.current) nativeCamera.current.value = "";
    imagePanelRef.current?.focus({ preventScroll: true });
    imagePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Initial status loading guard to prevent flashing unlocked UI
  if (!status) {
    return (
      <main className="admin-shell lock-center">
        <div className="panel lock-card" style={{ padding: 28, textAlign: "center" }}>
          <LoaderCircle className="spin" size={24} style={{ margin: "0 auto 12px", color: "var(--orange)" }} />
          <p style={{ color: "var(--muted)", fontSize: 13 }}>Đang kiểm tra trạng thái...</p>
        </div>
      </main>
    );
  }

  // Requirement 8: Locked domain renders "đã khóa" page
  if (lockedByAdmin) {
    return (
      <main className="admin-shell lock-center">
        <section className="panel lock-card">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="step-number"><Lock size={14} /></span>
              <h1>Miền đã khóa</h1>
            </div>
            <a href="/admin" className="text-button">Quản trị</a>
          </div>
          <div className="lock-form">
            <p className="inline-error" role="alert">
              Trang web này hiện <b>đã khóa</b> theo cấu hình quản trị. Vui lòng liên hệ quản trị viên hoặc vào mục Quản trị để mở khóa lại.
            </p>
          </div>
        </section>
      </main>
    );
  }

  // Requirement 5: Full-site password gate on every visit (unless /admin enabled 30-day browser remember)
  if (needsPassword) {
    return (
      <main className="admin-shell lock-center">
        <section className="panel lock-card">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="step-number"><LockKeyhole size={14} /></span>
              <h1>Nhập mật khẩu</h1>
            </div>
            <a href="/admin" className="text-button">Quản trị</a>
          </div>
          <form className="lock-form" onSubmit={signIn}>
            <p className="modal-subtitle">
              Vui lòng nhập mật khẩu để truy cập MapleLens.
            </p>
            <label className="field-label" htmlFor="site-password">Mật khẩu truy cập</label>
            <input
              id="site-password"
              className="password-input"
              type="password"
              autoComplete="current-password"
              autoFocus
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
            />
            {loginError && <p className="inline-error" role="alert">{loginError}</p>}
            <button className="primary full-width" disabled={loginBusy}>
              {loginBusy ? <LoaderCircle className="spin" size={17} /> : <Unlock size={17} />} Mở khóa
            </button>
          </form>
        </section>
      </main>
    );
  }

  // Requirement 9: When result is ready, do NOT display the cropped image preview on left panel
  const showImagePreview = Boolean(imageUrl && !result);

  return <>
    <header className="topbar"><div className="topbar-inner">
      <a className="brand" href="/" aria-label="MapleLens trang chủ"><MapleMark /><span>Maple<span className="brand-light">Lens</span></span><span className="beta">FAST</span></a>
      <div className="header-actions"><span className="private-tag"><ShieldCheck size={15} /> Ảnh của bạn, quyền của bạn</span><button type="button" className="text-button" onClick={() => void openHistory()}><History size={14} /> Lịch sử</button><a href="/admin" className="text-button">Quản trị</a><button className="icon-button" aria-label="Hướng dẫn sử dụng" onClick={() => setShowHelp(true)}><CircleHelp size={20} /></button></div>
    </div></header>
    <main className="main-shell">
      <div className="connection-strip" style={{ marginTop: 18 }}>
        <div className="connection-state">
          <span className={`connection-dot ${status?.configured ? "configured" : ""}`} />
          <span>{status?.configured ? connectionVerified === true ? "AI đã kết nối" : connectionVerified === false ? "Kết nối chưa thành công" : "AI đã sẵn sàng" : "Chế độ dùng thử"}</span>
        </div>
        <div className="connection-buttons">
          <button type="button" className={`text-button ${autoSolve ? "auto-on" : ""}`} onClick={() => setAutoSolve(v => !v)} title="Tự động gửi giải ngay khi dán hoặc chọn ảnh">
            <Zap size={13} /><span>Tự giải: {autoSolve ? "BẬT" : "TẮT"}</span>
          </button>
          <button className="text-button" onClick={checkConnection} disabled={!!busy}>
            {busy === "connection" ? <LoaderCircle className="spin" size={14} /> : <Wifi size={14} />}<span>{busy === "connection" ? "Đang kiểm tra…" : "Kiểm tra kết nối"}</span>
          </button>
        </div>
      </div>

      {notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}><AlertCircle size={18} /><span>{notice.text}</span><button className="icon-button" aria-label="Đóng thông báo" onClick={() => setNotice(null)}><X size={16} /></button></div>}

      <div className="workspace">
        <section ref={imagePanelRef} className="panel image-panel" aria-labelledby="image-title" aria-describedby="paste-hint" tabIndex={0} onPaste={pasteImage} onKeyDown={analyzeOnEnter} onClick={e => { if (!(e.target as HTMLElement).closest("button, input, a")) e.currentTarget.focus({ preventScroll: true }); }}>
          <div className="panel-heading"><div className="panel-title"><span className="step-number">01</span><h2 id="image-title">Ảnh câu hỏi</h2></div><span className="heading-meta">TỰ CẮT · TỰ GIẢI</span></div>
          <p id="paste-hint" className="paste-hint">Bấm <b>Dán ảnh</b> hoặc nhấn <kbd>Ctrl + V</kbd> (Mac: <kbd>⌘ + V</kbd>) để tự cắt &amp; giải ngay.</p>
          <input ref={upload} className="sr-only" aria-label="Chọn ảnh thử thách" type="file" accept={ACCEPTED_TYPES.join(",")} onChange={e => { void acceptFile(e.target.files?.[0]); e.target.value = ""; }} />
          <input ref={nativeCamera} className="sr-only" aria-label="Chụp bằng camera hệ thống" type="file" accept="image/*" capture="environment" onChange={e => { void acceptFile(e.target.files?.[0]); e.target.value = ""; }} />
          {!showImagePreview ? <div className={`upload-zone ${dragging ? "dragging" : ""}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); void acceptFile(e.dataTransfer.files[0]); }}>
            <div className="upload-illustration" aria-hidden="true"><div className="scan-corner tl" /><div className="scan-corner tr" /><div className="scan-corner bl" /><div className="scan-corner br" /><span className="sample-glyph" lang="ko">답</span><span className="tiny-spark">✦</span><span className="camera-badge"><Camera size={17} /></span></div>
            <h3>{reading ? "Đang cắt popup…" : "Dán hoặc chụp ảnh câu hỏi"}</h3><p>Tự cắt hộp câu hỏi và tìm ngay đáp án.</p>
            <button className="primary camera-primary" onClick={openCamera} disabled={reading || !!busy}><Camera size={18} /> Mở camera sau <ArrowRight size={17} /></button>
            <div className="upload-actions-row">
              <button className="secondary upload-secondary" title="Chọn ảnh từ thư viện" aria-label="Chọn ảnh từ thư viện" onClick={() => upload.current?.click()} disabled={reading || !!busy}><ImagePlus size={16} /> Chọn ảnh</button>
              <button className="secondary paste-secondary" title="Dán ảnh từ bộ nhớ tạm (Clipboard)" aria-label="Dán ảnh" onClick={() => void pasteFromClipboard()} disabled={reading || !!busy}><ClipboardPaste size={16} /> Dán ảnh</button>
            </div>
            <span className="upload-hint">JPEG, PNG, WebP</span>
          </div> : <div className="image-workspace">
            <div className="image-toolbar">
              <span><span className="status-dot" />{isDemo ? "Ảnh minh họa" : "Đang xử lý ảnh"}</span>
              <div>
                <button title="Cắt vùng thử thách" aria-label="Cắt vùng thử thách" onClick={openCrop} disabled={reading || !!busy}><Crop size={17} /> Chỉnh</button>
                <button title="Xoay ảnh 90 độ" aria-label="Xoay ảnh 90 độ" onClick={rotateImage} disabled={reading || !!busy}><RotateCw size={17} /> Xoay</button>
                <button title="Chọn ảnh khác từ thư viện" aria-label="Đổi ảnh" onClick={() => upload.current?.click()}><ImagePlus size={17} /> Đổi ảnh</button>
                <button title="Xóa ảnh này" aria-label="Xóa ảnh" onClick={clearImage} className="delete-image-btn"><X size={17} /> Xóa ảnh</button>
              </div>
            </div>
            {autoInfo && <div className={`popup-status ${autoInfo.found ? "found" : "not-found"}`} role="status"><ScanLine size={17} /><div><b>{autoInfo.mode === "original" ? "Đang xem ảnh gốc" : autoInfo.mode === "manual" ? "Đã chỉnh vùng ảnh" : autoInfo.found ? `${autoInfo.alreadyFramed ? "Popup đã vừa khung" : "Đã tự cắt popup"} · ${autoInfo.elapsedMs} ms` : "Chưa tìm rõ khung xanh · giữ ảnh đầy đủ"}</b><span>{autoInfo.typeHint === "sentence_choice" ? "Nhận diện dạng chọn câu" : "Sẵn sàng gửi AI tìm đáp án"}</span></div>{(originalImage || originalFileRef.current) && ((autoInfo.found && !autoInfo.alreadyFramed) || autoInfo.mode === "original") && <button onClick={restoreOrScan} disabled={reading || !!busy}>{autoInfo.mode !== "original" ? "Ảnh gốc" : "Quét lại"}</button>}</div>}
            <div className="image-preview">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageUrl!} alt="Ảnh thử thách đã chọn để xem trước" />
              <button type="button" className="image-remove-badge" title="Xóa ảnh để chèn ảnh khác" aria-label="Xóa ảnh" onClick={clearImage}><X size={18} /></button>
              {reading && <div className="image-loading"><LoaderCircle className="spin" /> Đang xử lý…</div>}
            </div>
          </div>}
          <div className="image-panel-footer">{!showImagePreview ? <div className="demo-invite"><span>Chưa có ảnh?</span><button onClick={loadDemo} disabled={reading || !!busy}>Thử ảnh minh họa <ArrowRight size={14} /></button></div> : <div className="analyze-actions"><button className="primary analyze-button" onClick={() => void analyze()} disabled={reading || !!busy}>{busy === "analyze" ? <LoaderCircle size={18} className="spin" /> : <Sparkles size={18} />}{busy === "analyze" ? `Đang giải · ${elapsed}s` : "Phân tích ảnh"}{busy !== "analyze" && <ArrowRight size={17} />}</button>{isDemo && <button className="demo-result-button" onClick={() => { setResult(demoResult); setNotice(null); resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>Xem kết quả minh họa <ArrowRight size={13} /></button>}</div>}</div>
        </section>

        {/* Requirement 9: Result panel shows ONLY the suggested answer/reading — no cropped image, no original text, no explanation, no extra buttons */}
        <section ref={resultRef} className={`panel result-panel ${result ? "has-result" : ""}`} aria-labelledby="result-title" aria-live="polite" aria-busy={busy === "analyze"}>
          <div className="panel-heading"><div className="panel-title"><span className="step-number muted">02</span><h2 id="result-title">Đáp án</h2></div><span className="ai-tag"><Sparkles size={12} /> AI</span></div>
          {busy === "analyze" ? (
            <div className="result-empty">
              <div className="result-orb processing"><Zap size={29} /></div>
              <h3>Đang tìm đáp án…</h3>
              <span className="elapsed"><Clock3 size={14} /> {elapsed} giây</span>
            </div>
          ) : result ? (
            <div className="result-body">
              <div className={`answer-box ${result.analysis.needsClearerImage ? "uncertain" : ""}`}>
                <div className="result-label">{result.analysis.needsClearerImage ? "CHƯA ĐỌC RÕ" : "ĐÁP ÁN GỢI Ý"}</div>
                {result.analysis.challengeType === "sentence_choice" && result.analysis.selectedOption ? (
                  <>
                    <div className="choice-line">Dòng {result.analysis.selectedOption}</div>
                    {result.analysis.suggestedAnswer && (
                      <strong lang="ko">{result.analysis.suggestedAnswer}</strong>
                    )}
                  </>
                ) : (
                  <strong lang={result.analysis.suggestedAnswer ? "ko" : "vi"}>
                    {result.analysis.suggestedAnswer || "Chưa đủ cơ sở để đề xuất"}
                  </strong>
                )}
              </div>
            </div>
          ) : (
            <div className="result-empty">
              <div className="result-orb"><Zap size={29} /><span className="orb-spark">✦</span></div>
              <h3>Sẵn sàng giải nhanh.</h3>
              <p>Dán ảnh để nhận ngay đáp án.</p>
            </div>
          )}
        </section>
      </div>
    </main>

    {cropOpen && imageUrl && <Modal title="Cắt vùng thử thách" onClose={() => setCropOpen(false)} className="crop-modal"><p className="modal-subtitle">Kéo ảnh, dùng hai ngón để phóng to. Giữ đủ câu hỏi và các phương án.</p><div className="crop-stage"><Cropper image={imageUrl} crop={crop} zoom={zoom} rotation={rotation} aspect={aspect} onCropChange={setCrop} onZoomChange={setZoom} onCropComplete={(_, area) => setPixels(area)} showGrid /></div><div className="crop-controls"><label><ZoomIn size={16} /> Phóng to<input aria-label="Phóng to ảnh" type="range" min="1" max="4" step="0.05" value={zoom} onChange={e => setZoom(Number(e.target.value))} /></label><label><Expand size={16} /> Tỉ lệ khung<input aria-label="Tỉ lệ khung cắt" type="range" min="0.6" max="4" step="0.1" value={aspect} onChange={e => setAspect(Number(e.target.value))} /></label><div className="crop-rotation"><button className="secondary" onClick={() => setRotation(r => r - 90)}><RotateCcw size={16} /> −90°</button><label>Nghiêng {rotation}°<input aria-label="Góc xoay ảnh" type="range" min="-180" max="180" step="1" value={rotation} onChange={e => setRotation(Number(e.target.value))} /></label><button className="secondary" onClick={() => setRotation(r => r + 90)}><RotateCw size={16} /> +90°</button></div></div><button className="primary full-width" disabled={!pixels || reading} onClick={applyCrop}>{reading ? <LoaderCircle className="spin" size={17} /> : <Check size={17} />} Dùng vùng ảnh này</button></Modal>}
    {cameraOpen && <Modal title="Chụp vùng thử thách" onClose={closeCamera} className="camera-modal"><p className="modal-subtitle">Giữ camera sau thẳng với màn hình.</p><div className="camera-stage"><video ref={video} playsInline autoPlay muted /><div className="camera-guide" />{!cameraReady && !cameraError && <span className="camera-wait"><LoaderCircle size={22} className="spin" /> Đang mở camera…</span>}</div>{cameraError && <p role="alert" className="inline-error">{cameraError}</p>}<button className="primary full-width" disabled={!cameraReady} onClick={capture}><Camera size={18} /> Chụp ảnh</button><button className="secondary full-width" onClick={() => { closeCamera(); upload.current?.click(); }}><ImagePlus size={17} /> Chọn ảnh từ thư viện</button></Modal>}
    {showHelp && <Modal title="Hướng dẫn nhanh" onClose={() => setShowHelp(false)}><div className="help-content"><p><b>1. Dán hoặc chụp ảnh.</b> Chụp màn hình câu hỏi rồi bấm nút <b>Dán ảnh</b> hoặc nhấn <b>Ctrl + V</b>.</p><p><b>2. Tự cắt &amp; tự giải.</b> Hệ thống tự cắt popup và gửi AI để trả về dòng đáp án nhanh nhất.</p></div></Modal>}
    {historyOpen && (
      <Modal title="Lịch sử đã tra (lưu trên máy)" onClose={closeHistory} className="history-modal">
        <div className="history-head">
          <span className="modal-subtitle" style={{ margin: 0 }}>Lưu tối đa 50 ảnh &amp; đáp án gần nhất ngay trên trình duyệt này.</span>
          {historyItems.length > 0 && (
            <button type="button" className="text-button delete-history-all" onClick={() => void clearAllHistory()}>
              <Trash2 size={13} /> Xóa tất cả
            </button>
          )}
        </div>
        {historyPreviewUrl && (
          <div className="history-zoom" onClick={() => setHistoryPreviewUrl(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={historyPreviewUrl} alt="Ảnh lịch sử phóng to" />
            <span>Bấm để thu gọn</span>
          </div>
        )}
        {historyLoading ? (
          <p className="history-empty">Đang tải lịch sử…</p>
        ) : historyItems.length === 0 ? (
          <p className="history-empty">Chưa có lịch sử tra cứu trên trình duyệt này.</p>
        ) : (
          <div className="history-list">
            {historyItems.map(({ entry, url }) => (
              <div key={entry.id} className="history-item">
                <button type="button" className="history-thumb" onClick={() => setHistoryPreviewUrl(historyPreviewUrl === url ? null : url)} title="Bấm để xem ảnh lớn">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Ảnh đã tra" />
                </button>
                <div className="history-info">
                  <div className="history-answer">
                    {entry.selectedOption ? <span className="history-badge">Dòng {entry.selectedOption}</span> : <span className="history-badge warn">Chưa rõ</span>}
                    {entry.suggestedAnswer ? (
                      <strong lang="ko">{entry.suggestedAnswer}</strong>
                    ) : !entry.selectedOption ? (
                      <strong lang="vi">Không có đáp án</strong>
                    ) : null}
                  </div>
                  <div className="history-meta">
                    <span>{new Date(entry.ts).toLocaleTimeString("vi-VN", { hour12: false })} · {new Date(entry.ts).toLocaleDateString("vi-VN")}</span>
                    <span>⚡ {(entry.actionToAnswerMs / 1000).toFixed(2)}s</span>
                  </div>
                </div>
                <button type="button" className="icon-button" aria-label="Xóa mục này" onClick={() => void removeHistoryItem(entry.id)}>
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    )}
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
