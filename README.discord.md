# Discord Workspace — Phan Anh Khôi

Web quản trị Discord với giao diện trắng đen, chọn nhiều kênh và theo dõi tác vụ độc lập theo từng ứng dụng. Phát triển và vận hành: Phan Anh Khôi.

## Thay đổi phiên bản 2

- Quản lý nhiều ứng dụng Discord qua biến môi trường, hiển thị tên tài khoản, username và ID thật lấy từ API.
- Chọn nhiều kênh của máy chủ đã cấu hình; tối đa 25 kênh trong một tác vụ thông báo.
- Bỏ trường **số lượt gửi** và **độ trễ** ở giao diện. Một tác vụ gửi một bản nháp đến mỗi kênh đã chọn; nội dung dài chia phần theo giới hạn Discord.
- Thẻ Tác vụ có lọc theo tài khoản, tổng số tác vụ, số tin đã gửi, lỗi và nút **Dừng tác vụ**.
- Tác vụ của các ứng dụng khác nhau hoạt động độc lập. Mỗi ứng dụng được điều tiết tốc độ tự động, giới hạn hai worker một tác vụ và tối đa 12 tác vụ đang chạy toàn hệ thống. Dừng tác vụ sẽ hủy các yêu cầu chưa hoàn thành.
- Không hỗ trợ @everyone hoặc tự động mention, gửi tin lặp vô hạn, giả mạo thiết bị, xử lý CAPTCHA hay né xác minh tài khoản.
- Chỉ nhận **bot/application token** chính thức từ Discord. Không chấp nhận token tài khoản Discord cá nhân (self-bot).
- Không đưa token vào mã nguồn, browser hoặc log. Token và mật khẩu quản trị cấu hình trong Render.
- Mật khẩu quản trị dùng biến môi trường, không có mật khẩu dùng chung hard-code. Cookie HttpOnly/Secure/SameSite, chặn truy cập API chưa đăng nhập và kiểm tra Origin với các yêu cầu từ trình duyệt.

## Cấu hình trên Render

Thiết lập ba biến môi trường (giá trị KHÔNG commit vào GitHub):

| Biến | Ví dụ | Ý nghĩa |
| --- | --- | --- |
| ADMIN_PASSWORD | mật khẩu dài, ngẫu nhiên, tối thiểu 12 ký tự | Đăng nhập web |
| DISCORD_BOT_TOKENS | ["token_ung_dung_1","token_ung_dung_2"] | Danh sách bot token dạng JSON; cũng nhận một token đơn |
| DISCORD_GUILD_IDS | 123456789012345678,234567890123456789 | ID máy chủ có cấp quyền ứng dụng |

Tạo ứng dụng trong Discord Developer Portal, bật Bot và mời vào máy chủ do bạn quản lý với quyền View Channels và Send Messages. Cấu hình ID máy chủ, không phải ID người dùng. Quyền cụ thể ở từng kênh vẫn do Discord kiểm soát; mã sẽ báo lỗi 403 khi ứng dụng thiếu quyền.

Render: nối repository vào Web Service hoặc Blueprint, cấu hình ba biến trên rồi deploy. Node.js 20+. Dùng lệnh npm start để chạy; GET /health để kiểm tra ứng dụng. Với môi trường cục bộ, có thể xuất các biến qua shell trước khi chạy; không lưu chúng vào repository.

## Giới hạn và trạng thái

- Nội dung tối đa 8.000 ký tự Unicode, chia thành phần tối đa 1.850 ký tự. Giữ nguyên xuống dòng.
- Tối đa 25 kênh mỗi tác vụ, 12 tác vụ đồng thời, tối đa 10 bot token cấu hình.
- Tác vụ gửi đúng một bản nháp đến mỗi kênh đã chọn, không lặp định kỳ. Không hỗ trợ DM qua token người dùng.
- Khi Discord trả HTTP 429, hệ thống tôn trọng retry_after và ngừng nếu vẫn bị giới hạn. Lỗi 401/403 không được né tránh.
- Trạng thái tác vụ lưu trong bộ nhớ máy chủ. Nếu Render restart, dữ liệu này và tác vụ đang chạy sẽ mất; cần database để lưu trạng thái lâu dài. Không có cam kết tránh xác minh hoặc bảo đảm việc gửi khi Discord giới hạn.
- Việc bấm Đăng xuất không tự dừng tác vụ; muốn dừng, mở thẻ Tác vụ và chọn ứng dụng tương ứng trước khi bấm Dừng.

## Kiểm thử

npm run check
npm test

Tài liệu chính thức: https://support.discord.com/hc/vi/articles/115002192352-T%C3%A0i-kho%E1%BA%A3n-ng%C6%B0%E1%BB%9Di-d%C3%B9ng-t%E1%BB%B1-%C4%91%E1%BB%99ng-self-bot
