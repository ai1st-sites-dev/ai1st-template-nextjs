// TICKET-129b: root URL renders default-locale Home (was forwarding to
// app/[locale]/page; now uses shared components/pages/HomePage component since
// app/[locale]/* is deleted to fix Next.js routing precision collision).
import type { Metadata } from 'next';
import SiteShell from '@/components/SiteShell';
import HomePage from '@/components/pages/HomePage';
import { homeMetadata } from '@/lib/metadata';
import { defaultLocale, getHomePage, pageStartsWithHero } from '@/lib/config';

export async function generateMetadata(): Promise<Metadata> {
  return homeMetadata(defaultLocale);
}

export default async function RootHomePage() {
  return (
    // #960: 首页第一段是 hero 时,透明浮层顶栏压在它上面(其余顶栏结构不看这个参数)。
    // 判断走 pageStartsWithHero —— 它跳过 #962 藏起来的 block,理由写在 config.ts 那里。
    <SiteShell locale={defaultLocale} overHero={pageStartsWithHero(getHomePage(defaultLocale))}>
      <HomePage locale={defaultLocale} />
    </SiteShell>
  );
}
