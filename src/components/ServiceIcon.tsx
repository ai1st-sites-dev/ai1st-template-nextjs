import React from 'react';

interface ServiceIconProps {
  icon: string;
  className?: string;
}

const icons: Record<string, React.ReactNode> = {
  // Security icons
  camera: (
    <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
  ),
  bell: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
  ),
  fingerprint: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M7.864 4.243A7.5 7.5 0 0 1 19.5 10.5c0 2.92-.556 5.709-1.568 8.268M5.742 6.364A7.465 7.465 0 0 0 4.5 10.5a7.464 7.464 0 0 1-1.15 3.993m1.989 3.559A11.209 11.209 0 0 0 8.25 10.5a3.75 3.75 0 1 1 7.5 0c0 .527-.021 1.049-.064 1.565M12 10.5a14.94 14.94 0 0 1-3.6 9.75m6.633-4.596a18.666 18.666 0 0 1-2.485 5.33" />
  ),
  lock: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
  ),
  thermometer: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11.25l-3-3m0 0l-3 3m3-3v7.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  ),
  speaker: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
  ),
  tv: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 20.25h12m-7.5-3v3m3-3v3m-10.125-3h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125Z" />
  ),
  wifi: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 0 1 7.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 0 1 1.06 0Z" />
  ),
  // Brand logos
  'shield-check': (
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
  ),
  // Landscaping icons
  leaf: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
  ),
  tree: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-6" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.528 15h4.944L17 10.5H7l2.528 4.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.528 10.5h6.944L18 6H6l2.528 4.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.528 6h4.944L16.5 3H7.5l2.028 3Z" />
    </>
  ),
  sun: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
  ),
  droplet: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a7.5 7.5 0 0 0 7.5-7.5c0-4.14-7.5-12-7.5-12S4.5 9.36 4.5 13.5A7.5 7.5 0 0 0 12 21Z" />
  ),
  scissors: (
    <path strokeLinecap="round" strokeLinejoin="round" d="m7.848 8.25 1.536.887M7.848 8.25a3 3 0 1 1-5.196-3 3 3 0 0 1 5.196 3Zm9.304 0 1.536.887m-1.536-.887a3 3 0 1 0 5.196-3 3 3 0 0 0-5.196 3Zm-9.304 0-6.87 3.971m16.174 0L9.384 9.137m7.848 3.084-2.81-1.623m-5.033 0-2.81 1.623m0 0 2.81 4.867m0 0 2.223-1.284m-2.223 1.284L7.848 21m9.304-4.932-2.81 4.867m0 0 2.223 1.284m-2.223-1.284L17.152 21" />
  ),
  shovel: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17 17.25 21A2.652 2.652 0 0 0 21 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 1 1-3.586-3.586l5.653-4.657m5.014-2.024-.001-.463a4.5 4.5 0 0 1 3.15-4.293A4.5 4.5 0 0 0 17 4.5a4.5 4.5 0 0 0-4.5 4.5c0 .342.039.676.112.999" />
    </>
  ),
  snowflake: (
    <>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v18m0-18-3 3m3-3 3 3m-3 15-3-3m3 3 3-3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.22 7.5l15.56 9m-15.56-9 1.5 3.464M4.22 7.5l3.464-1.5m12.096 10.5-1.5-3.464m1.5 3.464-3.464 1.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.22 16.5l15.56-9M4.22 16.5l1.5-3.464M4.22 16.5l3.464 1.5m12.096-10.5-1.5 3.464m1.5-3.464-3.464-1.5" />
    </>
  ),
  lightbulb: (
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
  ),
};

export default function ServiceIcon({ icon, className = 'h-8 w-8' }: ServiceIconProps) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden="true">
      {icons[icon] || icons.camera}
    </svg>
  );
}
