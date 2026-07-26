"use client";

import Avatar from "./Avatar";

// One-page app: the header is brand and identity only, no navigation.
export default function Header({ accountName }: { accountName?: string }) {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <nav className="topnav" aria-label="Primary">
        <div className="topnav-inner">
          <span className="brand">
            <svg width="17" height="17" viewBox="0 0 18 18" aria-hidden>
              <rect x="2" y="9" width="3.4" height="7" rx="1.2" fill="#fff" opacity="0.5" />
              <rect x="7.3" y="5.5" width="3.4" height="10.5" rx="1.2" fill="#fff" opacity="0.75" />
              <rect x="12.6" y="2" width="3.4" height="14" rx="1.2" fill="#fff" />
            </svg>
            LinkedIn Engagement
          </span>
          <span className="spacer" />
          {accountName && (
            <span className="who">
              <Avatar name={accountName} size={24} />
              <span className="who-name">{accountName}</span>
            </span>
          )}
        </div>
      </nav>
    </>
  );
}
