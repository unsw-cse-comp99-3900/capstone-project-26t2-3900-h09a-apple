import { RoleLanding } from '@/components/role-landing';
import { WalkthroughConsentGate } from '@/components/consent/walkthrough-consent-gate';

export default function LibraryPage() {
  return (
    <RoleLanding title="Library" role="EMPLOYEE">
      <WalkthroughConsentGate />
    </RoleLanding>
  );
}
