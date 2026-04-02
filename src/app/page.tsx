import SectionRenderer from '@/components/SectionRenderer';
import { getHomePage } from '@/lib/config';

export default function HomePage() {
  return <SectionRenderer sections={getHomePage().sections} />;
}
