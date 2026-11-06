import { Link, useRouteError } from 'react-router';
import { buttonClass } from '@/components/ui/buttonClass';

export function RouteErrorPage() {
  const error = useRouteError();
  console.error('[RouteTrack] route error', error instanceof Error ? error.message : error);
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4" role="alert">
      <h1 className="text-2xl font-bold text-slate-900">Đã xảy ra lỗi</h1>
      <p className="text-sm text-slate-700">
        Ứng dụng gặp lỗi khi hiển thị trang này. Dữ liệu đã lưu không bị xóa.
      </p>
      <Link to="/" className={buttonClass('primary')}>
        Về trang chủ
      </Link>
    </div>
  );
}
