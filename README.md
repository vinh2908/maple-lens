# MapleLens

Bản thử nghiệm Next.js + TypeScript, giao diện tiếng Việt để chụp và đọc thử thách tiếng Hàn trong MapleStory PC. Chỉ đưa gợi ý trên điện thoại; người dùng tự thao tác trong game.

## Backend Vercel ở vùng Mỹ

Nhánh triển khai này giữ giao diện tại Sites (chỉ chủ sở hữu được truy cập) và chuyển yêu cầu Gemini sang một backend Vercel. `vercel.json` cố định vùng Functions `iad1` (Washington, D.C.). Vùng thực tế phải được xác nhận sau khi triển khai; build thành công chưa chứng minh Gemini đã hết lỗi vùng.

Luồng: Safari → Sites xác thực + bộ đếm D1 → Vercel `/api/regional` → Gemini. Vercel yêu cầu Bearer token riêng cho mọi yêu cầu, kể cả health check. Token chỉ nằm ở hai máy chủ; không chuyển key Gemini, cookie trình duyệt hoặc phiên đăng nhập Sites sang Vercel. Không cho trình duyệt gọi trực tiếp backend. Bản Vercel trả 404 với giao diện và các API cũ; tiếp tục mở link Sites để sử dụng.

1. Trên máy tin cậy, chạy `npx vercel login` để đăng nhập qua trang Vercel, rồi `npx vercel link` để tạo/kết nối project mới. Không gửi mật khẩu/token trong chat.
2. Trong Vercel → Project → Settings → Environment Variables (Production), đặt `GEMINI_API_KEY` riêng, `GEMINI_MODEL=gemini-3.1-flash-lite` và `GEMINI_RELAY_TOKEN`. Tạo token bằng `node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))'`. Không đặt tiền tố `NEXT_PUBLIC_`. Chỉ token mới sinh mới là giá trị thật, chuỗi ví dụ trong `.env.example` không dùng được.
3. Chạy `npx vercel --prod`. `REGIONAL_ONLY=true` đã có trong cấu hình không chứa bí mật. Backend chỉ phục vụ `/api/regional`; mở trang gốc Vercel thấy 404 là đúng. Nếu account bật Deployment Protection cho production, phải cấu hình truy cập dịch vụ phù hợp trước khi nối gateway; trang đăng nhập HTML sẽ được báo thành lỗi rõ ràng.
4. Trong runtime secrets của Sites, đặt `GEMINI_BACKEND_URL=https://<production-domain>.vercel.app/api/regional` và `GEMINI_RELAY_TOKEN` giống Vercel; giữ `GEMINI_MODEL` đồng nhất. Deploy artifact gateway mới bằng `npm run build:site`. Không đặt các giá trị này vào Git hoặc mã trình duyệt.
5. Từ phiên Sites đã xác thực, mở `/api/runtime`: phải trả `backend: "vercel"`, `region: "iad1"`, `configured: true`. Health check không gọi Gemini. Sau đó bấm **Kiểm tra kết nối** đúng một lần trên iPhone. Thành công văn bản chưa chứng minh đáp án ảnh đúng; thử ảnh rõ riêng sau đó.

Hai máy chủ chỉ xử lý ảnh trong bộ nhớ. Gateway gửi JPEG nhị phân tối đa 4 MiB, dưới giới hạn payload 4,5 MB của Vercel. Backend giải mã lại bằng Sharp, loại metadata, giới hạn 24 MP. Sites giữ giới hạn bền vững 12 lượt/phút và 100/ngày; Vercel có thêm bộ đếm trong RAM để phòng vệ, không thay thế D1. Không retry hoặc chuyển ngược sang Gemini ở edge nếu backend Vercel đã được cấu hình mà gặp lỗi. Phản hồi sai schema, dữ liệu minh họa, HTML đăng nhập và lỗi không rõ đều không tạo đáp án.

Tài liệu: [vùng Functions](https://vercel.com/docs/functions/configuring-functions/region), [giới hạn payload](https://vercel.com/docs/functions/limitations), [đăng nhập CLI](https://vercel.com/docs/cli/login).

## Chạy nhanh

Yêu cầu Node.js 22 trở lên.

```bash
npm ci
npm run build
npm start
```

Mở http://localhost:3000 trên máy chạy ứng dụng. Khi chưa có key, có thể chọn/chụp ảnh, cắt, xoay, xem trước và thử ảnh minh họa. Nút **Xem kết quả minh họa** hiển thị dữ liệu viết sẵn có nhãn; nút **Phân tích** luôn gọi backend thật và không tạo đáp án khi thiếu key.

Link HTTPS dùng `npm run build:site`: giao diện Next.js được đóng gói cùng backend Cloudflare Worker, dùng SDK Gemini chung với bản Node. Site giữ quyền chỉ chủ sở hữu truy cập và xác thực bằng ChatGPT do Sites quản lý. Key và model được cấu hình trong runtime secrets của Sites, không nằm trong artifact. Bộ đếm D1 dùng chung áp dụng giới hạn 12 yêu cầu/phút và 100/ngày, tồn tại qua các lần khởi động và replica. Chỉ lưu bộ đếm, không lưu ảnh hay kết quả. Chạy `npm run db:generate` khi thay đổi schema.

`npm run build:preview` vẫn tạo bản giao diện tĩnh để thử offline, không kết nối API. Bản Next.js chạy bằng `npm start` có đầy đủ API và dùng `.env.local`.

## Cấu hình riêng trên máy chủ

```bash
cp .env.example .env.local
```

Mở `.env.local` trong trình soạn thảo trên máy của bạn, nhập `GEMINI_API_KEY`, `GEMINI_MODEL` và một `APP_PASSWORD` dài, khó đoán. Khởi động lại server. Không gửi key trong chat, không dùng tiền tố `NEXT_PUBLIC_` cho key và không commit `.env.local`. `.gitignore` loại trừ mọi `.env*`, ngoại trừ `.env.example` chỉ chứa giá trị mẫu. Ứng dụng không in key, ảnh hoặc phản hồi thô của Gemini vào log.

Nút **Kiểm tra kết nối** gửi đúng một yêu cầu văn bản ngắn, không gửi ảnh. Thành công xác nhận Gemini trả văn bản không rỗng và hoàn tất bình thường; không buộc câu trả lời phải trùng tuyệt đối chuỗi `OK`. Phản hồi bị chặn, trống hoặc dừng giữa chừng vẫn báo lỗi. Thành công chưa xác nhận khả năng đọc ảnh hoặc giải đúng thử thách.

## Mở trên iPhone

- Chạy ứng dụng trên máy chủ có HTTPS hợp lệ; mở URL HTTPS bằng Safari. Mặc định server chỉ lắng nghe `127.0.0.1:3000`. Sau khi cấu hình `APP_PASSWORD`, dùng `npm start -- --hostname 0.0.0.0` khi cần truy cập qua LAN hoặc đặt sau reverse proxy HTTPS.
- Khi truy cập từ điện thoại hoặc Internet, **phải cấu hình `APP_PASSWORD`**. Backend từ chối truy cập từ xa khi chưa có mật khẩu. Bấm **Mở khóa** trong giao diện, nhập mật khẩu ứng dụng; đây không phải Gemini key. Cookie phiên được ký HMAC, HttpOnly, SameSite=Strict và Secure cho hostname từ xa, hết hạn sau 12 giờ.
- `http://IP-máy-tính:3000` có thể mở giao diện trên cùng Wi-Fi nhưng **camera trực tiếp và clipboard cần HTTPS** trên Safari iPhone. `localhost` trên điện thoại là chính điện thoại. Camera hệ thống qua bộ chọn tệp và chọn ảnh thư viện là phương án thay thế.
- Cho phép quyền camera khi Safari hỏi. Nếu từ chối, ứng dụng giải thích và giữ nút chọn ảnh thư viện. Video dùng `playsInline`, `muted`, camera sau `facingMode: environment`; các track dừng khi đóng/chụp. Không gửi video đến API, không tự phân tích liên tục.
- Dùng ảnh JPEG/PNG/WebP; ảnh HEIC cần xuất JPEG hoặc chụp bằng camera của ứng dụng. Ảnh chọn từ Photos có thể được Safari tự chuyển JPEG, tùy thiết bị.

## Xử lý ảnh và kết quả

Ảnh gốc tối đa 15 MB, 40 megapixel; chuyển JPEG tối đa cạnh 2400 px tại trình duyệt để xử lý EXIF và giảm dung lượng. Ngay sau khi chọn/chụp, trình duyệt tự quét bố cục popup trên bản ảnh tối đa 720 px rồi áp dụng vùng cắt lên ảnh đầy đủ độ phân giải. Nhận diện nhanh hai bố cục: Dạng 1 · Chữ biến dạng và Dạng 2 · Chọn câu. Đây là gợi ý bố cục, Gemini xác nhận loại khi bấm Phân tích. Không gọi API khi tự quét. Giữ nguyên ảnh nếu không tìm rõ hoặc popup đã nằm gọn; có nút Ảnh gốc / Quét lại. Thuật toán dựa vào màu và bố cục hai mẫu, có thể bỏ sót khi nền, góc chụp hoặc giao diện khác. Chỉnh cắt thủ công là tùy chọn; hỗ trợ kéo, pinch zoom, thay đổi tỉ lệ, xoay 90° và chỉnh nghiêng. Backend giới hạn ảnh gửi lên 4 MB, đọc body có giới hạn thực kể cả khi không có Content-Length và không ghi ảnh ra đĩa. Bản Node dùng Sharp để giải mã, đối chiếu MIME, giới hạn 24 megapixel, loại ảnh lỗi/động và bỏ metadata. Backend Worker nhận ảnh JPEG đã được trình duyệt chuẩn hóa, kiểm tra chữ ký, cấu trúc marker và kích thước 24 megapixel trước khi gửi đến Gemini; nếu ảnh không giải mã được, lỗi từ provider được thông báo và không tạo đáp án. Ảnh chỉ gửi khi bấm Phân tích. Ảnh được truyền đến Google Gemini; việc xử lý/lưu giữ ở Google tuân theo điều khoản và cấu hình tài khoản Google của bạn.

- Chữ biến dạng: yêu cầu chép đúng thứ tự nét/ký tự; không sửa thành từ hợp nghĩa. Phần không đọc được dùng `[?]` và nêu các khả năng đọc.
- Chọn câu: đánh số từ trên xuống, giữ nguyên văn, giải thích ngữ pháp/ý nghĩa từng câu; backend kiểm tra thứ tự và đáp án phải trùng lựa chọn.
- Ảnh không rõ / độ chắc thấp / không đúng loại: không hiển thị đáp án, yêu cầu ảnh rõ hơn. Mọi kết quả đều có nhắc AI có thể sai.
- Từ chối, phản hồi trống, dừng giữa chừng, JSON lỗi hoặc lựa chọn mâu thuẫn: thông báo cụ thể, không hiển thị đáp án giả.

Sau khi có kết quả, bấm **Xóa ảnh** để dọn ảnh gốc, ảnh xem trước và kết quả rồi trở về ô nhập. Bấm **Chụp ảnh mới** để dọn ảnh cũ và mở ngay camera sau; nếu không cấp quyền vẫn có nút chọn ảnh thư viện. Các thao tác này không gọi Gemini.

## Gemini và tài liệu

Dùng SDK chính thức `@google/genai` (phiên bản đã khóa trong package-lock.json). Model mặc định là `gemini-3.1-flash-lite`, được tài liệu Google ngày 16/10/2026 liệt kê stable, hỗ trợ đầu vào ảnh và đầu ra có cấu trúc. Có thể đổi `GEMINI_MODEL` trên server. Quyền thực tế tùy tài khoản/key; lỗi model không khả dụng được báo riêng. Không tự fallback sang model khác.

- https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite
- https://ai.google.dev/gemini-api/docs/libraries
- https://ai.google.dev/gemini-api/docs/image-understanding
- https://ai.google.dev/gemini-api/docs/structured-output

Timeout phân tích và kiểm tra kết nối là 35 giây phía SDK, 45 giây phía trình duyệt. SDK chỉ có 1 attempt, không retry tự động. Có thông báo riêng cho key sai/thiếu quyền, quota, rate limit, timeout, từ chối, phản hồi lỗi. Không phản chiếu thông báo provider thô để tránh lộ secret.

## Giới hạn truy cập

Backend yêu cầu mật khẩu cho truy cập từ xa, chặn Origin khác, giới hạn chung 12 yêu cầu/phút và 100/ngày cho cả phân tích lẫn kiểm tra kết nối; đăng nhập 5 lần/phút. Giới hạn nằm trong bộ nhớ **một tiến trình Node**, reset khi restart. Khi triển khai nhiều replica/serverless hoặc phục vụ công khai, cần thay bằng bộ đếm dùng chung (Redis/gateway) và giới hạn kích thước/request timeout tại reverse proxy; không xem giới hạn trong RAM là quota bền vững. Không triển khai backend công khai khi chưa có xác thực.

## Kiểm thử

```bash
npm run build
npm test
npm run typecheck
# Sau npm run build: kiểm tra backend Vercel cục bộ, không gọi Gemini
npm run test:regional
# Chạy npm start trước; bài test thiếu key sử dụng fixture:
npm run test:e2e
```

E2E mặc định dùng `/usr/bin/chromium`. Có thể đặt `PLAYWRIGHT_CHROMIUM_PATH` tới Chromium trên máy hoặc chỉnh playwright.config.ts để dùng browser Playwright đã cài. Kiểm tra: bố cục 390 px, tải ảnh thực, tự tìm/cắt popup và khôi phục ảnh gốc mà không gọi API, cắt/xoay, ảnh lỗi/quá lớn/HEIC, camera bị từ chối, lỗi thiếu key, lỗi từ chối/sai JSON, không lặp yêu cầu, kết quả minh họa được gắn nhãn, kiểm tra backend và Origin. Các phản hồi thành công/từ chối giả lập trong E2E chỉ là fixture kiểm thử giao diện, không chứng minh Gemini hoạt động.

Key đã được chủ ứng dụng cấu hình riêng. Đã kiểm tra một yêu cầu văn bản thật trả đúng OK; đây không phải dữ liệu đánh giá độ chính xác. Bộ quét bố cục đã nhận đúng loại hai ảnh đính kèm, giữ ảnh đã cắt sẵn và tìm popup khi ghép thêm nền. Không đưa ảnh người dùng vào repository. `public/demo-challenge.svg` là ảnh minh họa tự tạo. Một ảnh chữ Hàn tự tạo đã phân tích thật thành công qua backend đang chạy, mất khoảng 18 giây. Thử hai ảnh gốc qua Gemini gặp lỗi dịch vụ/timeout; chưa kiểm chứng đáp án trên chúng và chưa có dữ liệu đo độ chính xác. Chưa thử Safari trên iPhone vật lý.

## Kết quả kiểm tra bản có backend

Build Next.js và Worker thành công; 10 unit test và 9 E2E Chromium ở viewport 390 px đã pass. Kiểm tra bộ đếm dùng SQL thực: 12 yêu cầu được nhận, yêu cầu thứ 13 bị chặn, cửa sổ phút tiếp theo hoạt động. Đã quét cả source, bundle trình duyệt và artifact Worker: không có giá trị key thật. E2E thiếu key/từ chối/thành công sử dụng fixture có nhãn; không được xem là đo độ chính xác.

Cập nhật triển khai ngày 17/10/2026: backend đã chạy tại `https://maple-lens-backend.vercel.app/api/regional`; người dùng vẫn mở https://maplelens-demo.candid-melon-4712.chatgpt.site. Vercel project và deployment khai báo `iad1`, health qua Sites xác nhận `region=iad1`, model `gemini-3.1-flash-lite`. Kiểm tra văn bản thật qua Sites → Vercel → Gemini đã thành công, khoảng 3,3 giây. Đây chưa phải kiểm chứng độ chính xác đọc ảnh.

Build Next.js và Worker đạt; 23 unit test đạt. Production smoke đã kiểm tra chặn truy cập không token, khóa UI/API cũ, health không gọi Gemini và báo thiếu key. Quét 68 file nguồn/artifact không thấy giá trị key hay token thật. Đã thử ảnh minh họa qua đường dẫn thật và gặp Gemini HTTP 503 tạm thời; thông báo lỗi dịch vụ và lỗi trang HTML từ gateway được xử lý riêng, không giả đáp án, không tự retry. Chưa thử Safari iPhone vật lý và chưa có dữ liệu đo độ chính xác.

### Nhập nhanh và đọc kết quả

Bấm vào ô ảnh, Ctrl+V (Mac: Cmd+V) để dán ảnh chụp màn hình, Enter để phân tích. Dán ảnh chỉ xử lý trên thiết bị; Enter mới gửi API. Nếu nhấn Enter ngay khi dán, ứng dụng đợi xử lý ảnh xong rồi gửi một lần. Tệp sai định dạng không gửi ảnh cũ. Camera và thư viện vẫn dùng bình thường. Clipboard phải chứa dữ liệu ảnh, không phải đường dẫn hay đoạn chữ.

Dạng chọn câu hiển thị **Dòng N (đếm từ trên xuống) + câu đề xuất**, bỏ phần giải thích dài. Cảnh báo ảnh mờ/không chắc chắn vẫn hiển thị. Dạng nhập chữ có chuỗi phím và bảng từng chữ cho bàn phím Hàn **2-Set (두벌식)**, ví dụ `바누리모` → `qksnflah`. Bật Korean Microsoft IME, chế độ `가`, tắt Caps Lock và bộ gõ tiếng Việt. Phím viết hoa là Shift + phím (`R` = Shift + r). Gõ liền, chỉ bấm Space khi có dấu cách. Dán chuỗi Latin không tự chuyển thành chữ Hàn; người dùng tự gõ trên PC.

Chuyển phím chạy cục bộ bằng phân rã âm tiết Unicode, không gọi thêm API hoặc sửa từ theo nghĩa. Chỉ hiển thị khi chữ nhận diện khớp đáp án và không có cảnh báo không chắc chắn. Ký tự ngoài âm tiết Hangul hiện đại/dấu cách (kể cả xuống dòng và jamo đứng riêng) chặn chuỗi để tránh bỏ sót hoặc gửi nhầm Enter. Kiểm thử chuyển phím không chứng minh độ chính xác OCR hoặc khả năng nhập trong MapleStory; cần kiểm tra trên Windows thực tế.
