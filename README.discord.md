# Discord web

Web quản trị Discord, giao diện trắng đen, tác giả giao diện Phan Anh Khôi.

## Cấu hình

Node.js 20+. Mật khẩu mạnh đã được tạo ngẫu nhiên; repo chỉ chứa mã xác minh scrypt, không chứa mật khẩu gốc. Chủ sở hữu nhận mật khẩu riêng sau khi cập nhật. Token Discord được nhập trong trang web sau khi đăng nhập, chỉ giữ trong bộ nhớ tiến trình; không đưa token lên GitHub. Discord có thể hạn chế tự động hóa tài khoản người dùng; mã không đảm bảo hoạt động nếu API từ chối.

`npm start` để chạy; `/health` để kiểm tra. Render dùng `render.yaml`.

Các chức năng Discord từ `6app.py` được chuyển: nhập tối đa 5 tài khoản vào phiên, chọn tài khoản gửi, gửi tin nhắn vào channel, gắn thẻ ID được chọn và dừng tác vụ. Nội dung giữ nguyên xuống dòng trong một tin; bản nháp quá dài được chia thành các phần tối đa 1.800 ký tự và gửi tuần tự. Số lượt lặp áp dụng cho toàn bộ bản nháp. `@everyone` được gửi dưới dạng mention thật bằng `allowed_mentions`, chỉ hỗ trợ một tin và một lần gửi; tài khoản vẫn cần quyền mention trong channel. Danh sách tên chat và ID lấy từ API Discord khi bấm “Tải tên chat”; một số cuộc trò chuyện có thể không hiện nếu tài khoản thiếu quyền hoặc API từ chối. Tối đa 5 tác vụ đồng thời, mỗi tác vụ tối đa 20 lượt lặp, khoảng cách chọn từ 1 đến 3600 giây; xử lý HTTP 429 theo `retry_after`, vì vậy khoảng cách thực tế có thể lâu hơn. Tác vụ lưu trong bộ nhớ và dừng khi dịch vụ khởi động lại.

Nút “Tải ID tin nhắn” lấy tối đa 500 ID gần nhất trong chat đã chọn; nếu còn tin cũ hơn, web hiển thị trạng thái còn dữ liệu. Nút này chỉ đọc ID, không tải nội dung tin nhắn.

`join 2.zip` là archive 7z gồm các lệnh đổi hồ sơ, tham gia và rời máy chủ. Các lệnh đó không liên quan danh sách chat và gửi tin, nên không được sao chép vào web.

`change token.py` chứa cơ chế đăng nhập/handoff và thay token, chưa được chạy hay xác thực an toàn. Ứng dụng nhận token tài khoản qua form sau khi xác thực quản trị; không nhận email/mật khẩu Discord và không tự đổi token. Các chức năng Zalo, Telegram, Messenger, Instagram, Gmail và Locket không được đưa vào.
