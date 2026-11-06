# 10. Nguồn kỹ thuật chính thức (đối chiếu 05/11/2026)

Những nguồn dưới đây dùng để xác nhận **khả năng thực tế và giới hạn** của trình duyệt, thư viện và nhà cung cấp. AI coding agent phải kiểm tra tài liệu mới nhất và độ tương thích phiên bản khi tiến hành code.

1. **W3C Geolocation — 2026 Candidate Recommendation Draft:** cập nhật vị trí cho tài liệu fully-active visible, hidden updates có thể bị bỏ. https://www.w3.org/TR/2026/CRD-geolocation-20261030/
2. **MDN `watchPosition()`:** HTTPS, quyền vị trí, cách đăng ký theo dõi. https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition
3. **MDN Screen Wake Lock:** chỉ giữ màn hình sáng cho trang active, tự release khi hidden. https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API
4. **MDN visibilitychange:** life cycle và tab/app hidden. https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilitychange_event
5. **MDN Service Worker:** cache/offline/background sync, không biến thành GPS native. https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
6. **MDN StorageManager.persist:** persistent storage là yêu cầu browser có thể từ chối. https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist
7. **Dexie docs:** wrapper IndexedDB, query/migration/transaction. https://dexie.org/docs
8. **React Leaflet Polyline:** vẽ các đoạn tuyến. https://react-leaflet.js.org/docs/api-components/
9. **Leaflet reference:** Polyline, bounds, markers. https://leafletjs.com/reference
10. **vite-plugin-pwa:** manifest/app-shell/service worker. https://github.com/vite-pwa/vite-plugin-pwa/blob/main/docs/guide/index.md
11. **OSM Tile Usage Policy:** attribution, cache theo headers, không bulk download / prefetch offline, không có SLA. https://operations.osmfoundation.org/policies/tiles/
12. **Cloudflare Pages React:** Vite build/dist, deploy HTTPS. https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
13. **PostGIS ST_DWithin:** filtering geography bằng mét cho geospatial khi mở rộng. https://postgis.net/docs/ST_DWithin.html
14. **TomTom Traffic API:** legacy Flow API có current/free-flow speed/confidence; nhà cung cấp đề xuất Orbis cho tích hợp mới. https://docs.tomtom.com/traffic-api/documentation/tomtom-maps/v1/traffic-flow/traffic-flow-service
15. **TomTom Orbis Traffic API:** xem sản phẩm/gói API mới. https://docs.tomtom.com/traffic-api/documentation/tomtom-orbis-maps/v2/traffic-flow/traffic-flow-service
16. **Google Routes API traffic-on-polylines:** phân loại NORMAL/SLOW/TRAFFIC_JAM và chính sách tính phí bổ sung. https://developers.google.com/maps/documentation/routes/traffic_on_polylines

**Không tái sử dụng nguyên văn dài nội dung tài liệu của bên thứ ba.** Bộ spec diễn giải quy tắc thiết kế và dẫn link để kiểm tra khi triển khai.
