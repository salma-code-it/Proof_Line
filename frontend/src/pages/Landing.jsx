import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import Header from '../components/Header';
import Hero from '../components/Hero';
import Problems from '../components/ProblemSection';
import HowItWorks from '../components/HowItWorks';
import ComparisonTable from '../components/ComparisonTable';
import Footer from '../components/Footer';

export default function Landing() {
  return (
    <div className="min-h-screen bg-[#f1f3f5] font-sans text-[#12203a] antialiased">
      <Header />
      <main>
        <Hero />
        <Problems />
        <HowItWorks />
        <ComparisonTable />
        <section className="px-4 py-20 sm:px-6">
          <div className="mx-auto max-w-6xl rounded-lg border border-[#cdd5df] bg-white p-8 sm:p-12">
            <h2 className="max-w-xl text-3xl font-bold tracking-tight sm:text-4xl">See what your team's repository actually shows.</h2>
            <Link
              to="/project"
              className="mt-8 inline-flex items-center gap-2 rounded-md bg-[#12203a] px-6 py-3 font-semibold text-white transition-colors hover:bg-[#1d3158] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0a8f6c] focus-visible:ring-offset-2"
            >
              Analyze a project <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}