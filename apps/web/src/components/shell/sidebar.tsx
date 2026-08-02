'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useCurrentUser } from '@/contexts/auth-context';

import { visibleNavGroups, type NavItem } from './nav-items';
import styles from './sidebar.module.css';

const COLLAPSE_KEY = 'wt.shell.collapsed';
const RECENT_KEY = 'wt.shell.recentSops';

type RecentSop = { id: string; title: string };

function initials(displayName: string, email: string): string {
  const source = displayName.trim() || email.split('@')[0] || 'U';
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]![0] ?? ''}${parts[1]![0] ?? ''}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

function navGlyph(item: NavItem): string {
  switch (item.id) {
    case 'dashboard':
      return 'D';
    case 'library':
      return 'L';
    case 'review':
      return 'R';
    case 'analytics':
      return 'A';
    default:
      return item.label.slice(0, 1);
  }
}

function pathMatches(pathname: string, href: string): boolean {
  if (href === '/dashboard') {
    return pathname === '/dashboard';
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function readRecent(): RecentSop[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSop[];
    return Array.isArray(parsed) ? parsed.slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function Sidebar() {
  const { user, logout } = useCurrentUser();
  const pathname = usePathname() || '/dashboard';
  const [collapsed, setCollapsed] = useState(false);
  const [recent, setRecent] = useState<RecentSop[]>([]);

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      setCollapsed(false);
    }
    setRecent(readRecent());
  }, []);

  useEffect(() => {
    if (!pathname.startsWith('/sop/')) return;
    const id = pathname.split('/')[2];
    if (!id) return;
    setRecent((prev) => {
      const next = [
        { id, title: `SOP ${id.slice(0, 8)}` },
        ...prev.filter((row) => row.id !== id),
      ].slice(0, 5);
      try {
        window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      } catch {
        // ignore quota
      }
      return next;
    });
  }, [pathname]);

  if (!user) return null;

  const groups = visibleNavGroups(user.role);
  const displayName = user.display_name || user.email.split('@')[0] || 'User';

  function toggleCollapsed() {
    setCollapsed((value) => {
      const next = !value;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      } catch {
        // ignore
      }
      return next;
    });
  }

  async function handleLogout() {
    try {
      window.localStorage.removeItem(COLLAPSE_KEY);
      window.localStorage.removeItem(RECENT_KEY);
    } catch {
      // ignore
    }
    await logout();
  }

  return (
    <aside className={`${styles.sidebar} ${collapsed ? styles.collapsed : ''}`}>
      <div className={styles.brandRow}>
        <Link href="/dashboard" className={styles.brand}>
          <span className={styles.brandMark}>W</span>
          <span className={styles.brandText}>WorkTrace</span>
        </Link>
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={toggleCollapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '>' : '<'}
        </button>
      </div>

      <div className={styles.navScroll}>
        {groups.map((group) => (
          <div key={group.id} className={styles.group}>
            <p className={styles.groupLabel}>{group.label}</p>
            <ul className={styles.navList}>
              {group.items.map((item) => {
                const childActive = Boolean(
                  item.children?.some((child) => pathMatches(pathname, child.href)),
                );
                const parentActive = pathMatches(pathname, item.href) || childActive;
                const showChildren = Boolean(item.children?.length);

                return (
                  <li key={item.id}>
                    {item.disabled ? (
                      <span className={styles.navDisabled} title={item.disabledReason}>
                        <span className={styles.navIcon}>{navGlyph(item)}</span>
                        <span className={styles.navCopy}>
                          <span className={styles.navLabel}>{item.label}</span>
                          {item.disabledReason ? (
                            <span className={styles.navHint}>{item.disabledReason}</span>
                          ) : null}
                        </span>
                      </span>
                    ) : (
                      <Link
                        href={item.href}
                        className={`${styles.navLink} ${parentActive ? styles.navLinkActive : ''}`}
                        title={item.description || item.label}
                      >
                        <span className={styles.navIcon}>{navGlyph(item)}</span>
                        <span className={styles.navCopy}>
                          <span className={styles.navLabel}>{item.label}</span>
                          {item.description ? (
                            <span className={styles.navHint}>{item.description}</span>
                          ) : null}
                        </span>
                      </Link>
                    )}

                    {showChildren ? (
                      <ul className={styles.childList} aria-label={`${item.label} pages`}>
                        {item.children!.map((child) => {
                          const active = pathMatches(pathname, child.href);
                          return (
                            <li key={child.id}>
                              <Link
                                href={child.href}
                                className={`${styles.childLink} ${active ? styles.childLinkActive : ''}`}
                              >
                                {child.label}
                                {child.description ? (
                                  <span className={styles.childHint}>{child.description}</span>
                                ) : null}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        <div className={styles.group}>
          <p className={styles.groupLabel}>Recent</p>
          <ul className={styles.navList}>
            {recent.length === 0 ? (
              <li>
                <span className={styles.navDisabled}>
                  <span className={styles.navIcon}>·</span>
                  <span className={styles.navCopy}>
                    <span className={styles.navLabel}>No recent SOPs</span>
                    <span className={styles.navHint}>Open a procedure to pin it here</span>
                  </span>
                </span>
              </li>
            ) : (
              recent.map((item) => (
                <li key={item.id}>
                  <Link href={`/sop/${item.id}`} className={styles.navLink} title={item.title}>
                    <span className={styles.navIcon}>S</span>
                    <span className={styles.navCopy}>
                      <span className={styles.navLabel}>{item.title}</span>
                    </span>
                  </Link>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      <div className={styles.footer}>
        <div className={styles.userRow}>
          <div className={styles.avatar} aria-hidden>
            {initials(displayName, user.email)}
          </div>
          <div className={styles.userMeta}>
            <div className={styles.userName}>{displayName}</div>
            <div className={styles.userEmail}>{user.email}</div>
            <div className={styles.userRole}>{user.role}</div>
          </div>
        </div>
        <button type="button" className={styles.logoutBtn} onClick={() => void handleLogout()}>
          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}
