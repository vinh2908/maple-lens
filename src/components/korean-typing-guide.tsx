"use client";

import { useState } from "react";
import { Check, Copy, Keyboard } from "lucide-react";
import type { Analysis } from "@/lib/contracts";
import { typingGuideFor } from "@/lib/korean-keyboard";

export function KoreanTypingGuide({ analysis }: { analysis: Analysis }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  if (analysis.challengeType !== "distorted_text") return null;
  const guide = typingGuideFor(analysis);

  async function copyKeys() {
    if (!guide) return;
    try {
      await navigator.clipboard.writeText(guide.keys);
      setCopied(true); setCopyError(false);
    } catch { setCopyError(true); }
  }

  return <section className="typing-guide" aria-labelledby="typing-title">
    <h3 id="typing-title"><Keyboard size={17} /> Cách gõ trên bàn phím PC</h3>
    {guide ? <>
      <p>Bật bàn phím Hàn <b>2-Set (두벌식)</b>, chế độ <b lang="ko">가</b>, rồi gõ lần lượt:</p>
      <code className="typing-keys" aria-label="Chuỗi phím Latin" dir="ltr">{guide.keys}</code>
      <div className="typing-syllables" aria-label="Phím cho từng chữ">{guide.syllables.map((s, i) => <span className="typing-syllable" key={i}><b lang="ko">{s.text === " " ? "Dấu cách" : s.text}</b><code>{s.keys === " " ? "Space" : s.keys}</code></span>)}</div>
      <p>Tắt Caps Lock. Chữ hoa nghĩa là giữ <b>Shift</b> cùng phím đó{/[A-Z]/.test(guide.keys) ? <>: {Array.from(new Set(guide.keys.match(/[A-Z]/g))).map(k => `${k} = Shift + ${k.toLowerCase()}`).join("; ")}</> : " (ví dụ R = Shift + r)"}. Gõ liền giữa các chữ; chỉ bấm Space ở vị trí “Dấu cách”.</p>
      <button className="secondary typing-copy" onClick={copyKeys}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Đã sao chép chuỗi phím" : "Sao chép chuỗi phím"}</button>
      {copyError && <p role="status">Chưa sao chép được. Nhấn giữ chuỗi phím phía trên để sao chép thủ công.</p>}
      <details><summary>Cài bộ gõ Hàn trên Windows</summary><p>Vào Settings → Time &amp; language → Language &amp; region → Add a language → Korean (한국어), thêm Microsoft IME. Bấm Win + Space chọn Korean, chuyển biểu tượng A sang 가 (thường bằng Alt phải).</p><p>Đây là phím của bộ gõ Hàn, khác với Telex tiếng Việt. Tắt bộ gõ tiếng Việt khi nhập. Bạn tự gõ các phím trên PC; dán chuỗi Latin sẽ không tự chuyển thành chữ Hàn. Nếu game cho phép dán, dùng nút “Sao chép chữ Hàn”.</p></details>
      <p className="typing-note">Chuỗi phím bám theo chữ đã nhận diện, không xác nhận AI đọc đúng. So lại với ảnh trước khi nhập.</p>
    </> : <p>Chưa tạo chuỗi phím vì chữ chưa đủ rõ, đáp án chưa khớp chữ nhận diện hoặc có ký tự chưa hỗ trợ. Hãy chụp rõ riêng dòng chữ Hàn rồi phân tích lại; ứng dụng không tự đoán phím.</p>}
  </section>;
}
