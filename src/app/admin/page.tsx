"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  KeyRound,
  Lock,
  LockOpen,
  RefreshCw,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import type { DomainStats, UsageLogEntry } from "@/lib/kv";

type DomainCardState = {
  url: string;
  loading: boolean;
  online: boolean;
  model: string;
  configured: boolean;
  locked: boolean;
  needsAuth: boolean;
  error: string;
  stats: DomainStats | null;
};

function formatTime(ts: number): string {
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      timeZone: "Asia/Ho_Chi_Minh",
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toISOString();
  }
}

const ADMIN_REMEMBER_KEY = "maple_admin_remember_v1";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function readRememberedAdmin(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(ADMIN_REMEMBER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { expiresAt?: number; passwords?: Record<string, string> };
    if (!parsed || typeof parsed.expiresAt !== "number" || parsed.expiresAt < Date.now() || !parsed.passwords) {
      localStorage.removeItem(ADMIN_REMEMBER_KEY);
      return null;
    }
    return parsed.passwords;
  } catch {
    return null;
  }
}

function writeRememberedAdmin(passwords: Record<string, string>) {
  try {
    localStorage.setItem(ADMIN_REMEMBER_KEY, JSON.stringify({ expiresAt: Date.now() + THIRTY_DAYS_MS, passwords }));
  } catch {}
}

function clearRememberedAdmin() {
  try {
    localStorage.removeItem(ADMIN_REMEMBER_KEY);
  } catch {}
}

export default function AdminPage() {
  const [unlocked, setUnlocked] = useState(false);
  const [loginPass, setLoginPass] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [rememberedBrowser, setRememberedBrowser] = useState(false);
  const [rememberBusy, setRememberBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error" | "info"; text: string } | null>(null);

  // Kept strictly in page memory only
  const [passwordsByUrl, setPasswordsByUrl] = useState<Record<string, string>>({});
  const [domainUrls, setDomainUrls] = useState<string[]>([]);
  const [cards, setCards] = useState<Record<string, DomainCardState>>({});

  // Per-domain forms
  const [domainAuthInput, setDomainAuthInput] = useState<Record<string, string>>({});
  const [pwFormOpen, setPwFormOpen] = useState<Record<string, boolean>>({});
  const [pwFields, setPwFields] = useState<Record<string, { oldPass: string; newPass: string; confirmPass: string }>>({});
  const [actionBusy, setActionBusy] = useState<Record<string, boolean>>({});
  const [historyFilter, setHistoryFilter] = useState<string>("all");

  const fetchDomainCard = useCallback(async (url: string, passMap: Record<string, string>, explicitAttempt = false): Promise<boolean> => {
    const cleanUrl = url.replace(/\/+$/, "");
    setCards(prev => ({
      ...prev,
      [cleanUrl]: {
        url: cleanUrl,
        loading: true,
        online: prev[cleanUrl]?.online ?? false,
        model: prev[cleanUrl]?.model ?? "...",
        configured: prev[cleanUrl]?.configured ?? false,
        locked: prev[cleanUrl]?.locked ?? false,
        needsAuth: prev[cleanUrl]?.needsAuth ?? false,
        error: "",
        stats: prev[cleanUrl]?.stats ?? null,
      },
    }));

    let online = false;
    let model = "—";
    let configured = false;
    let lockedFromStatus = false;

    try {
      const statusRes = await fetch(`${cleanUrl}/api/status`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (statusRes.ok) {
        const s = await statusRes.json();
        online = true;
        model = s.model || "—";
        configured = Boolean(s.configured);
        lockedFromStatus = Boolean(s.locked);
      }
    } catch {
      online = false;
    }

    const pass = passMap[cleanUrl] ?? passMap[window.location.origin] ?? "";
    try {
      const statsRes = await fetch(`${cleanUrl}/api/admin/stats`, {
        headers: { "x-admin-password": pass },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (statsRes.status === 401) {
        setCards(prev => ({
          ...prev,
          [cleanUrl]: {
            url: cleanUrl,
            loading: false,
            online,
            model,
            configured,
            locked: lockedFromStatus,
            needsAuth: true,
            error: explicitAttempt
              ? "Mật khẩu vừa nhập chưa đúng cho miền này. Vui lòng thử lại."
              : "Mật khẩu miền này khác với miền chính. Nhập mật khẩu hiện tại của miền này.",
            stats: null,
          },
        }));
        return false;
      }
      if (!statsRes.ok) {
        const err = await statsRes.json().catch(() => null);
        throw new Error(err?.error?.message || `HTTP ${statsRes.status}`);
      }
      const data = await statsRes.json();
      setCards(prev => ({
        ...prev,
        [cleanUrl]: {
          url: cleanUrl,
          loading: false,
          online: true,
          model: data.model || model,
          configured: Boolean(data.configured),
          locked: Boolean(data.locked),
          needsAuth: false,
          error: "",
          stats: {
            domain: data.domain,
            todayCount: data.todayCount ?? 0,
            totalCount: data.totalCount ?? 0,
            locked: Boolean(data.locked),
            hasCustomPassword: Boolean(data.hasCustomPassword),
            logs: Array.isArray(data.logs) ? data.logs : [],
          },
        },
      }));
      return true;
    } catch (e) {
      setCards(prev => ({
        ...prev,
        [cleanUrl]: {
          url: cleanUrl,
          loading: false,
          online,
          model,
          configured,
          locked: lockedFromStatus,
          needsAuth: false,
          error: (e as Error).message || "Không tải được dữ liệu miền này.",
          stats: null,
        },
      }));
      return false;
    }
  }, []);

  const refreshAll = useCallback(
    async (urls: string[], passMap: Record<string, string>) => {
      await Promise.all(urls.map(u => fetchDomainCard(u, passMap)));
    },
    [fetchDomainCard]
  );

  useEffect(() => {
    void fetch("/api/status", { cache: "no-store" })
      .then(r => r.json())
      .then(async d => {
        if (!d?.authenticated) {
          clearRememberedAdmin();
          return;
        }
        setRememberedBrowser(true);
        const saved = readRememberedAdmin();
        if (!saved) return;
        const origin = window.location.origin;
        const originPass = saved[origin];
        if (!originPass) return;
        const res = await fetch(`${origin}/api/admin/stats`, {
          headers: { "x-admin-password": originPass },
          cache: "no-store",
        });
        if (!res.ok) {
          clearRememberedAdmin();
          return;
        }
        const data = await res.json();
        const list: string[] =
          Array.isArray(data.domainsList) && data.domainsList.length > 0
            ? data.domainsList.map((u: string) => u.replace(/\/+$/, ""))
            : [origin];
        if (!list.includes(origin)) list.unshift(origin);
        const merged: Record<string, string> = {};
        for (const u of list) merged[u] = saved[u] || originPass;
        setPasswordsByUrl(merged);
        setDomainUrls(list);
        setUnlocked(true);
        await refreshAll(list, merged);
      })
      .catch(() => {});
  }, [refreshAll]);

  async function handleAdminLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginPass || loginBusy) return;
    setLoginBusy(true);
    setLoginError("");
    try {
      const origin = window.location.origin;
      const res = await fetch(`${origin}/api/admin/stats`, {
        headers: { "x-admin-password": loginPass },
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.error?.message || "Mật khẩu quản trị chưa đúng.");
      }
      const list: string[] =
        Array.isArray(data.domainsList) && data.domainsList.length > 0
          ? data.domainsList.map((u: string) => u.replace(/\/+$/, ""))
          : [origin];
      if (!list.includes(origin)) list.unshift(origin);

      const saved = rememberedBrowser ? readRememberedAdmin() : null;
      const initialPassMap: Record<string, string> = {};
      for (const u of list) initialPassMap[u] = (saved && saved[u]) || loginPass;
      if (rememberedBrowser) writeRememberedAdmin(initialPassMap);
      setPasswordsByUrl(initialPassMap);
      setDomainUrls(list);
      setUnlocked(true);
      await refreshAll(list, initialPassMap);
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function toggleRememberBrowser() {
    if (rememberBusy) return;
    setRememberBusy(true);
    setNotice(null);
    const originPass = passwordsByUrl[window.location.origin] || loginPass;
    try {
      if (!rememberedBrowser) {
        const res = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: originPass, remember: true }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error?.message || "Chưa lưu được trạng thái nhớ mật khẩu.");
        writeRememberedAdmin(passwordsByUrl);
        setRememberedBrowser(true);
        setNotice({ kind: "success", text: "Đã bật nhớ mật khẩu trên trình duyệt này trong 30 ngày." });
      } else {
        const res = await fetch("/api/session", { method: "DELETE" });
        if (!res.ok) throw new Error("Chưa hủy được trạng thái nhớ mật khẩu.");
        clearRememberedAdmin();
        setRememberedBrowser(false);
        setNotice({ kind: "info", text: "Đã hủy nhớ mật khẩu trên trình duyệt này." });
      }
    } catch (e) {
      setNotice({ kind: "error", text: (e as Error).message });
    } finally {
      setRememberBusy(false);
    }
  }

  async function toggleLockDomain(url: string, nextLocked: boolean) {
    setActionBusy(p => ({ ...p, [url]: true }));
    setNotice(null);
    const pass = passwordsByUrl[url] || "";
    try {
      const res = await fetch(`${url}/api/admin/set-locked`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": pass,
        },
        body: JSON.stringify({ locked: nextLocked }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || "Không đổi được trạng thái khóa.");
      setNotice({
        kind: "success",
        text: `${url}: ${nextLocked ? "Đã KHÓA miền." : "Đã MỞ KHÓA miền."}`,
      });
      await fetchDomainCard(url, passwordsByUrl);
    } catch (e) {
      setNotice({ kind: "error", text: `${url}: ${(e as Error).message}` });
    } finally {
      setActionBusy(p => ({ ...p, [url]: false }));
    }
  }

  async function submitChangePassword(e: React.FormEvent, url: string) {
    e.preventDefault();
    const fields = pwFields[url] || { oldPass: "", newPass: "", confirmPass: "" };
    if (fields.newPass.length < 4) {
      setNotice({ kind: "error", text: "Mật khẩu mới phải có ít nhất 4 ký tự." });
      return;
    }
    if (fields.newPass !== fields.confirmPass) {
      setNotice({ kind: "error", text: "Mật khẩu mới nhập lại không khớp." });
      return;
    }
    setActionBusy(p => ({ ...p, [`pw:${url}`]: true }));
    setNotice(null);
    const headerPass = passwordsByUrl[url] || fields.oldPass;
    try {
      const res = await fetch(`${url}/api/admin/change-password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-password": headerPass,
        },
        body: JSON.stringify({
          oldPassword: fields.oldPass,
          newPassword: fields.newPass,
          confirmPassword: fields.confirmPass,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error?.message || "Không đổi được mật khẩu.");

      const nextPassMap = { ...passwordsByUrl, [url]: fields.newPass };
      setPasswordsByUrl(nextPassMap);
      if (rememberedBrowser) {
        if (url === window.location.origin) {
          clearRememberedAdmin();
          setRememberedBrowser(false);
        } else {
          writeRememberedAdmin(nextPassMap);
        }
      }
      setPwFields(p => ({ ...p, [url]: { oldPass: "", newPass: "", confirmPass: "" } }));
      setPwFormOpen(p => ({ ...p, [url]: false }));
      setNotice({
        kind: "success",
        text: `Đã đổi mật khẩu cho ${url}. Miền này bắt nhập mật khẩu mới từ lần sau.`,
      });
      await fetchDomainCard(url, nextPassMap);
    } catch (e) {
      setNotice({ kind: "error", text: `${url}: ${(e as Error).message}` });
    } finally {
      setActionBusy(p => ({ ...p, [`pw:${url}`]: false }));
    }
  }

  async function unlockSpecificDomain(e: React.FormEvent, url: string) {
    e.preventDefault();
    const pass = domainAuthInput[url] || "";
    if (!pass) return;
    const nextMap = { ...passwordsByUrl, [url]: pass };
    setPasswordsByUrl(nextMap);
    const ok = await fetchDomainCard(url, nextMap, true);
    if (ok) {
      setDomainAuthInput(p => ({ ...p, [url]: "" }));
      if (rememberedBrowser) writeRememberedAdmin(nextMap);
      setNotice({ kind: "success", text: `Đã xác nhận mật khẩu hiện tại cho ${url}.` });
    }
  }

  const combinedLogs = useMemo(() => {
    const all: (UsageLogEntry & { sourceUrl: string })[] = [];
    for (const url of domainUrls) {
      const c = cards[url];
      if (!c?.stats?.logs) continue;
      if (historyFilter !== "all" && historyFilter !== url) continue;
      for (const l of c.stats.logs) {
        all.push({ ...l, sourceUrl: url });
      }
    }
    return all.sort((a, b) => b.ts - a.ts).slice(0, 100);
  }, [cards, domainUrls, historyFilter]);

  if (!unlocked) {
    return (
      <main className="admin-shell lock-center">
        <section className="panel lock-card">
          <div className="panel-heading">
            <div className="panel-title">
              <span className="step-number"><ShieldCheck size={14} /></span>
              <h1>Quản trị MapleLens</h1>
            </div>
            <Link href="/" className="text-button"><ArrowLeft size={14} /> Trang chính</Link>
          </div>
          <form className="lock-form" onSubmit={handleAdminLogin}>
            <p className="modal-subtitle">
              Nhập mật khẩu quản trị để xem trạng thái 3 miền, lượt sử dụng, lịch sử, khóa/mở và đổi mật khẩu. Mật khẩu chỉ giữ tạm trong bộ nhớ trang.
            </p>
            <label className="field-label" htmlFor="admin-login-pass">Mật khẩu quản trị</label>
            <input
              id="admin-login-pass"
              className="password-input"
              type="password"
              autoFocus
              required
              value={loginPass}
              onChange={e => setLoginPass(e.target.value)}
            />
            {loginError && <p className="inline-error" role="alert">{loginError}</p>}
            <button className="primary full-width" type="submit" disabled={loginBusy}>
              <Unlock size={17} /> {loginBusy ? "Đang xác thực…" : "Mở trang quản trị"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <Link href="/" className="text-button"><ArrowLeft size={14} /> Về trang giải captcha</Link>
          <h1>Quản trị hệ thống MapleLens</h1>
        </div>
        <div className="admin-top-actions">
          <button
            type="button"
            className={`secondary ${rememberedBrowser ? "remember-active" : ""}`}
            onClick={() => void toggleRememberBrowser()}
            disabled={rememberBusy}
          >
            {rememberedBrowser ? <Check size={16} /> : <KeyRound size={16} />}
            {rememberedBrowser ? "Đang nhớ mật khẩu (30 ngày) · Bấm để hủy" : "Nhớ mật khẩu trên trình duyệt này"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => void refreshAll(domainUrls, passwordsByUrl)}
          >
            <RefreshCw size={16} /> Làm mới
          </button>
        </div>
      </header>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <AlertCircle size={18} />
          <span>{notice.text}</span>
          <button className="icon-button" aria-label="Đóng" onClick={() => setNotice(null)}>✕</button>
        </div>
      )}

      <section className="admin-grid">
        {domainUrls.map(url => {
          const card = cards[url];
          const f = pwFields[url] || { oldPass: "", newPass: "", confirmPass: "" };
          const isLocked = Boolean(card?.locked);
          return (
            <article key={url} className={`panel admin-domain-card ${isLocked ? "domain-locked" : ""}`}>
              <div className="panel-heading">
                <div className="panel-title">
                  <span className={`connection-dot ${card?.online ? "configured" : ""}`} />
                  <h2>{url.replace(/^https?:\/\//, "")}</h2>
                </div>
                <span className={`domain-badge ${isLocked ? "locked" : "open"}`}>
                  {isLocked ? "ĐÃ KHÓA" : card?.online ? "Online" : "Offline"}
                </span>
              </div>

              <div className="admin-card-body">
                <div className="admin-meta-row">
                  <span>Model: <b>{card?.model || "—"}</b></span>
                  <span>Trạng thái: <b>{card?.loading ? "Đang tải..." : card?.online ? "Hoạt động" : "Không phản hồi"}</b></span>
                </div>

                {card?.needsAuth ? (
                  <form className="domain-auth-box" onSubmit={e => void unlockSpecificDomain(e, url)}>
                    <p>{card.error}</p>
                    <div className="domain-auth-row">
                      <input
                        className="password-input"
                        type="password"
                        placeholder="Mật khẩu hiện tại của miền này"
                        value={domainAuthInput[url] || ""}
                        onChange={e => setDomainAuthInput(p => ({ ...p, [url]: e.target.value }))}
                        required
                      />
                      <button type="submit" className="primary" disabled={Boolean(card?.loading)}>
                        {card?.loading ? "…" : "Xác nhận"}
                      </button>
                    </div>
                  </form>
                ) : card?.error ? (
                  <p className="inline-error">{card.error}</p>
                ) : (
                  <div className="admin-counters">
                    <div>
                      <span>Hôm nay</span>
                      <strong>{card?.stats?.todayCount ?? 0}</strong>
                    </div>
                    <div>
                      <span>Tổng lượt</span>
                      <strong>{card?.stats?.totalCount ?? 0}</strong>
                    </div>
                  </div>
                )}

                {!card?.needsAuth && (
                  <div className="admin-card-actions">
                    <button
                      type="button"
                      className={`secondary ${isLocked ? "unlock-btn" : "lock-btn"}`}
                      disabled={Boolean(actionBusy[url])}
                      onClick={() => void toggleLockDomain(url, !isLocked)}
                    >
                      {isLocked ? <LockOpen size={15} /> : <Lock size={15} />}
                      {isLocked ? "Mở khóa miền" : "Khóa miền"}
                    </button>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => setPwFormOpen(p => ({ ...p, [url]: !p[url] }))}
                    >
                      <KeyRound size={15} /> Đổi mật khẩu
                    </button>
                  </div>
                )}

                {pwFormOpen[url] && (
                  <form className="pw-change-form" onSubmit={e => void submitChangePassword(e, url)}>
                    <input
                      className="password-input"
                      type="password"
                      placeholder="Mật khẩu cũ"
                      required
                      value={f.oldPass}
                      onChange={e => setPwFields(p => ({ ...p, [url]: { ...f, oldPass: e.target.value } }))}
                    />
                    <input
                      className="password-input"
                      type="password"
                      placeholder="Mật khẩu mới (tối thiểu 4 ký tự)"
                      required
                      value={f.newPass}
                      onChange={e => setPwFields(p => ({ ...p, [url]: { ...f, newPass: e.target.value } }))}
                    />
                    <input
                      className="password-input"
                      type="password"
                      placeholder="Nhập lại mật khẩu mới"
                      required
                      value={f.confirmPass}
                      onChange={e => setPwFields(p => ({ ...p, [url]: { ...f, confirmPass: e.target.value } }))}
                    />
                    <button
                      type="submit"
                      className="primary full-width"
                      disabled={Boolean(actionBusy[`pw:${url}`])}
                    >
                      {actionBusy[`pw:${url}`] ? "Đang lưu…" : "Xác nhận đổi mật khẩu"}
                    </button>
                  </form>
                )}
              </div>
            </article>
          );
        })}
      </section>

      <section className="panel admin-history-panel">
        <div className="panel-heading">
          <div className="panel-title">
            <h2>Lịch sử dùng gần nhất (tối đa 100 dòng)</h2>
          </div>
          <select
            aria-label="Lọc theo miền"
            className="admin-filter"
            value={historyFilter}
            onChange={e => setHistoryFilter(e.target.value)}
          >
            <option value="all">Tất cả miền</option>
            {domainUrls.map(u => (
              <option key={u} value={u}>{u.replace(/^https?:\/\//, "")}</option>
            ))}
          </select>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Thời gian</th>
                <th>Miền</th>
                <th>Kết quả</th>
                <th>Thời gian xử lý</th>
              </tr>
            </thead>
            <tbody>
              {combinedLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="empty-cell">Chưa có dữ liệu lịch sử trong Vercel KV.</td>
                </tr>
              ) : (
                combinedLogs.map((row, idx) => (
                  <tr key={`${row.ts}-${row.domain}-${idx}`}>
                    <td>{formatTime(row.ts)}</td>
                    <td>{row.domain}</td>
                    <td>
                      <span className={`log-status ${row.ok ? "ok" : "fail"}`}>
                        {row.ok ? "Thành công" : "Thất bại"}
                      </span>
                    </td>
                    <td>{row.ms} ms</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
