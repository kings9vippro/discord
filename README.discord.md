# Discord web

Trang đăng nhập quản trị và endpoint kiểm tra trạng thái dịch vụ. Giao diện của Phan Anh Khôi.

## Cấu hình Render

- Web service dùng Node.js 24, với lệnh build `npm ci --omit=dev` và lệnh start `npm start`.
- Đặt `ADMIN_PASSWORD` thành mật khẩu quản trị mạnh, tối thiểu 12 ký tự.
- Đặt `SESSION_SECRET` thành một giá trị ngẫu nhiên dài ít nhất 32 byte và giữ nguyên giữa các lần deploy. Nếu tạo dịch vụ từ Blueprint, Render tạo giá trị này. Với dịch vụ đã tồn tại, cấu hình biến trong Dashboard.
- Dùng `/health` làm Health Check Path. Biến `NODE_VERSION` trên Dashboard cần trỏ tới Node.js 24 nếu dịch vụ đang ghi đè cấu hình repo.

Ghi nhớ thiết bị áp dụng cho trình duyệt đã chọn tùy chọn khi đăng nhập. Cookie hết hạn sau 30 ngày và tiếp tục dùng được sau khi restart nếu hai biến môi trường giữ nguyên. Phiên đăng nhập thường hết hạn sau 8 giờ. Cookie có `HttpOnly`, `SameSite=Strict` và `Secure` trên Render. Đăng xuất xóa cookie khỏi trình duyệt và thu hồi phiên trên tiến trình hiện tại. Nếu cookie bị sao chép trước đó, đổi `SESSION_SECRET` để thu hồi mọi phiên kể cả sau khi restart.

## UptimeRobot

Thêm monitor loại HTTP(s), đặt URL thành `https://<ten-dich-vu>.onrender.com/health` và chọn chu kỳ 5 phút. Endpoint hỗ trợ GET và HEAD, trả HTTP 200 khi tiến trình đang lắng nghe. Render Free cho dịch vụ ngủ sau 15 phút không có lưu lượng đến. Monitor có thể giảm tình trạng ngủ do rảnh. Giới hạn giờ miễn phí và cơ chế restart của Render vẫn áp dụng.

## Kiểm tra local

Chạy `npm ci`, `npm test`, rồi đặt `ADMIN_PASSWORD` và chạy `npm start`. Mở `http://localhost:10000`. Đặt thêm `SESSION_SECRET` nếu muốn thử tính năng ghi nhớ qua restart.

Bản này gồm đăng nhập quản trị và giám sát trạng thái. Các chức năng nhập token Discord, xoay proxy, giả dấu vân tay và gửi định kỳ hàng loạt đã được gỡ khỏi mã chạy.
