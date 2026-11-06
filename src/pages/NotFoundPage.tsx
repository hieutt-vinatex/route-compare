import { Link } from 'react-router';
import { buttonClass } from '@/components/ui/buttonClass';
import { EmptyState } from '@/components/ui/EmptyState';

export function NotFoundPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4">
      <EmptyState
        title="Không tìm thấy trang"
        action={
          <Link to="/" className={buttonClass('primary')}>
            Về trang chủ
          </Link>
        }
      />
    </div>
  );
}
