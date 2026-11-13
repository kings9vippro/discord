# Discord web

Web quản trị Discord, giao diện trắng đen, tác giả giao diện Phan Anh Khôi.

## Cấu hình

Node.js 20+, `ADMIN_PASSWORD` (ít nhất 16 ký tự), `PASSWORD_SALT` (ít nhất 16 ký tự ngẫu nhiên) và `DISCORD_ACCOUNT_TOKEN` trong biến môi trường Render. Tài khoản cần quyền gửi tin nhắn trong channel được chọn. Không đặt token vào GitHub. Discord có thể hạn chế tự động hóa tài khoản người dùng; mã không đảm bảo hoạt động nếu API từ chối.

`npm start` để chạy; `/health` để kiểm tra. Render dùng `render.yaml`; điền ba biến bí mật trong Render khi tạo dịch vụ.

Các chức năng từ `6app.py` được chuyển: gửi tin nhắn vào channel, gửi luân phiên từng dòng, gắn thẻ ID được chọn và dừng tác vụ. Mỗi tác vụ tối đa 20 lượt, cách nhau ít nhất 15 giây; xử lý HTTP 429 theo `retry_after`. Tác vụ lưu trong bộ nhớ và dừng khi dịch vụ khởi động lại.

`change token.py` chứa cơ chế đăng nhập/handoff và thay token, chưa được chạy hay xác thực an toàn. Ứng dụng nhận token tài khoản đã có qua biến môi trường; không nhận email/mật khẩu Discord và không tự đổi token. Các chức năng Zalo, Telegram, Messenger, Instagram, Gmail và Locket không được đưa vào.
