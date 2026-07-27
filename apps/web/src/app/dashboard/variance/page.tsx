import { RoleLanding } from '@/components/role-landing';
import Link from 'next/link';

export default function VarianceDashboardPage() {
  return (
    <RoleLanding title="Variance dashboard" role="MANAGER">
      <p>
        <Link href="/dashboard/feedback">Open voice feedback dashboard</Link>
      </p>
    </RoleLanding>
  );
}
