# Bàn giao MapleLens cho Antigravity

## Đề nghị thực hiện
Đọc README.md và mã nguồn hiện có, hoàn thiện ứng dụng rồi triển khai. Giữ giao diện tiếng Việt, tối ưu Safari iPhone. Không đưa API key/token vào trình duyệt hoặc Git. Không tự thao tác trong game.

## Bản mã nguồn
Commit: da08ef76a7238c78c33e40a1e595e25e35769e99.
Đã có camera/thư viện, tự tìm và cắt popup, crop/xoay thủ công, Gemini phía server, hai dạng thử thách, cảnh báo không chắc chắn, xóa/chụp lại. Dạng chọn câu hiện số dòng từ trên xuống + câu đề xuất. Dạng nhập chữ có hướng dẫn phím Hàn 2-Set và sao chép. Click ô ảnh → Ctrl+V/Cmd+V → Enter phân tích; Enter đợi xử lý ảnh rồi chỉ gửi một yêu cầu.

## Chạy trên máy
Cài Node.js LTS 22 hoặc 24. Mở terminal trong thư mục này:

```sh
npm ci
```

Sao chép .env.example thành .env.local bằng trình quản lý file hoặc terminal. Nhập GEMINI_API_KEY riêng vào .env.local; đặt APP_PASSWORD riêng. Không gửi key trong chat. GEMINI_MODEL hiện là gemini-3.1-flash-lite; kiểm tra khả dụng trong tài khoản khi triển khai.

```sh
npm run dev
```

Mở http://127.0.0.1:3000. Không có key vẫn thử giao diện bằng ảnh/kết quả minh họa. Nút Kiểm tra kết nối chỉ kiểm tra yêu cầu văn bản, không xác nhận độ chính xác đọc ảnh. Để mở trên điện thoại cần bind host phù hợp và HTTPS cho camera trực tiếp; script dev mặc định chỉ bind localhost.

## Quan trọng trước khi deploy
Hiện có HAI thành phần: giao diện/gateway private trên Sites và backend Gemini trên Vercel vùng iad1. vercel.json đặt REGIONAL_ONLY=true; src/proxy.ts chặn mọi đường dẫn trừ /api/regional khi VERCEL=1 hoặc REGIONAL_ONLY=true. Vì vậy đưa nguyên repo lên Vercel sẽ chỉ có backend; trang / trả 404 theo thiết kế.

Nếu chuyển TOÀN BỘ app sang Vercel: sửa có chủ đích src/proxy.ts và vercel.json để cho phép frontend/API cần thiết, giữ kiểm tra đăng nhập/nguồn yêu cầu, cấu hình APP_PASSWORD và hạn mức bền vững dùng database/Redis (limiter Next.js hiện dùng bộ nhớ tiến trình). Cập nhật tests/regional.test.ts theo kiến trúc mới, kiểm tra đường dẫn public/private. Không chỉ xóa bảo vệ rồi deploy. Không cần relay token nếu chuyển sang gọi Gemini trực tiếp bằng Next.js server; loại bỏ cấu hình relay không dùng sau khi kiểm chứng.

Nếu giữ kiến trúc hiện tại: worker/index.ts là gateway Sites, GEMINI_BACKEND_URL và GEMINI_RELAY_TOKEN nằm phía server; token trùng với backend. D1 giữ hạn mức ở Sites. .openai/hosting.json chứa ID dự án hiện tại, không phải secret; không dùng ID đó để tạo nhầm dự án mới.

Các secret không có trong ZIP; chủ tài khoản phải thiết lập lại qua dashboard hosting hoặc .env.local. Không có .git, .vercel, node_modules hoặc các thư mục build trong ZIP.

## Kiểm chứng và phần còn lại
27 unit tests đạt; 13 tình huống trình duyệt mobile Chromium đạt (có fixtures/mock, không phải đánh giá OCR). Build Next.js/Worker đã đạt. Chưa thử trực tiếp Safari iPhone, Windows IME trong MapleStory; chưa có bộ dữ liệu đánh giá độ chính xác.

```sh
npm test
npm run build
npm run start
```

E2E: ở terminal khác chạy npm run test:e2e. playwright.config.ts mặc định /usr/bin/chromium của môi trường Linux cũ; sửa executablePath hoặc đặt PLAYWRIGHT_CHROMIUM_PATH cho máy mới. Có thể dùng Chromium do Playwright cài và bỏ executablePath. Build Sites dùng npm run build:site, không dùng nhầm bản build:preview chỉ minh họa.

Đọc thêm README.md để biết hạn mức, bảo mật, lỗi API và triển khai. Hoàn thiện xong kiểm tra camera, paste/Enter, ảnh lỗi, timeout/quota/refusal, kết quả hai dạng, chuỗi phím và xác thực trước khi bàn giao link.
