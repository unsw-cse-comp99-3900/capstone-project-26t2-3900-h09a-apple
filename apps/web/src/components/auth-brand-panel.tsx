import styles from '@/app/login/auth.module.css';

import {
  AuthCaptureIcon,
  AuthDraftIcon,
  AuthLogoIcon,
  AuthReviewIcon,
  AuthSparkleIcon,
} from '@/components/auth/auth-icons';

const FEATURES = [
  {
    icon: AuthCaptureIcon,
    title: 'Record real work',
    description: 'Capture clicks, inputs, page changes, and screenshots.',
  },
  {
    icon: AuthReviewIcon,
    title: 'Review before generation',
    description: 'Confirm the timeline before creating an SOP.',
  },
  {
    icon: AuthDraftIcon,
    title: 'Generate editable SOPs',
    description: 'Turn sessions into structured instructions your team can refine.',
  },
] as const;

export function AuthBrandPanel() {
  return (
    <aside className={styles.brandPanel} aria-label="WorkTrace AI">
      <div className={styles.brandInner}>
        <div className={styles.brandHeader}>
          <span className={styles.logoMark} aria-hidden="true">
            <AuthLogoIcon className={styles.logoMarkIcon} />
          </span>
          <span className={styles.wordmark}>WorkTrace AI</span>
        </div>

        <p className={styles.eyebrowBadge}>
          <AuthSparkleIcon className={styles.eyebrowBadgeIcon} />
          <span>AI-assisted SOP drafting</span>
        </p>

        <h2 className={styles.brandTitle}>Turn real workflows into living SOPs.</h2>
        <p className={styles.brandLead}>
          Capture browser tasks, review each step, and generate editable SOP drafts for onboarding
          and process improvement.
        </p>

        <ul className={styles.featureList}>
          {FEATURES.map(({ icon: Icon, title, description }) => (
            <li key={title} className={styles.featureItem}>
              <span className={styles.featureChip} aria-hidden="true">
                <Icon className={styles.featureChipIcon} />
              </span>
              <span className={styles.featureCopy}>
                <strong>{title}</strong>
                <span>{description}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}
