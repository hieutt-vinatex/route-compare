import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';

/** Placeholder until M4 (FR-11). */
export function ComparePage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-2xl font-bold text-slate-900">So sánh</h1>
      <EmptyState
        title="Tính năng so sánh đang được phát triển"
        description="Bạn sẽ có thể chọn 2–4 hành trình cùng điểm đi/đến và phương tiện để xem chồng tuyến và bảng chênh lệch kèm độ đầy đủ dữ liệu GPS. Cùng điểm đầu/cuối không có nghĩa là cùng một con đường."
        action={
          <Link to="/history" className={buttonClass('secondary')}>
            Xem lịch sử
          </Link>
        }
      />
    </div>
  );
}
