import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { ValueProps } from './components/ValueProps';
import { HowItWorks } from './components/HowItWorks';
import { Agents } from './components/Agents';
import { DashboardPreview } from './components/DashboardPreview';
import { Fit } from './components/Fit';
import { QuickStart } from './components/QuickStart';
import { Providers } from './components/Providers';
import { Footer } from './components/Footer';
import { BackgroundEffects } from './components/BackgroundEffects';

export default function App() {
  return (
    <div className="min-h-screen text-gray-50 font-sans selection:bg-indigo-500/30">
      <BackgroundEffects />
      <Navbar />
      <main>
        <Hero />
        <ValueProps />
        <HowItWorks />
        <Agents />
        <DashboardPreview />
        <Fit />
        <QuickStart />
        <Providers />
      </main>
      <Footer />
    </div>
  );
}
