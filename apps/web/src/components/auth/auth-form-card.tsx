/**
 * Card chrome wrapping auth forms on marketing pages.
 */

import type { ReactNode } from 'react';

import styles from '@/app/login/auth.module.css';

type AuthFormCardProps = {
  title: string;
  lead: string;
  notice?: string;
  children: ReactNode;
  footer: ReactNode;
  termsNotice?: ReactNode;
};

export function AuthFormCard({
  title,
  lead,
  notice,
  children,
  footer,
  termsNotice,
}: AuthFormCardProps) {
  return (
    <>
      <h1>{title}</h1>
      <p className={styles.lead}>{lead}</p>
      {notice ? <p className={styles.roleNotice}>{notice}</p> : null}
      {children}
      {footer}
      {termsNotice}
      <p className={styles.securityLine}>Enterprise security · PII auto-masked · Tenant-isolated</p>
    </>
  );
}
