import { Sparkles, MessageCircle } from 'lucide-react';

export function AuthLayout({ children }) {
  return (
    <main className="min-h-screen grid grid-cols-1 md:grid-cols-[1.05fr_0.95fr]">
      {/* Left Brand Section */}
      <section className="hidden md:flex flex-col justify-between p-14 bg-gradient-to-br from-blue-600 to-blue-700 text-white relative overflow-hidden">
        {/* Decorative circles */}
        <div className="absolute w-[520px] h-[520px] border border-white/15 rounded-full -right-56 -bottom-36 shadow-[0_0_0_80px_rgba(255,255,255,0.05),0_0_0_160px_rgba(255,255,255,0.05)]" />

        {/* Brand lockup */}
        <div className="flex items-center gap-3 relative z-10">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white text-blue-600">
            <Sparkles size={20} className="font-bold" />
          </div>
          <span className="text-2xl font-bold font-display">Orbit</span>
        </div>

        {/* Copy */}
        <div className="relative z-10 max-w-2xl">
          <p className="text-sm font-bold uppercase tracking-wider text-blue-100 mb-4">
            Admissions intelligence, simplified
          </p>
          <h1 className="text-4xl md:text-5xl font-bold font-display mb-6 leading-tight">
            Turn every enquiry into a meaningful student journey.
          </h1>
          <p className="text-lg text-blue-50 leading-relaxed max-w-xl">
            One focused workspace for admissions teams to manage leads, follow-ups, applications, and enrolments.
          </p>

          {/* Quote Card */}
          <div className="mt-12 border-l-4 border-blue-200 pl-5 max-w-2xl">
            <p className="text-base text-blue-50 mb-2 leading-relaxed italic">
              "We know a CRM isn't just about managing contacts—it's about enabling teams, improving customer experiences, and driving business growth."
            </p>
            <span className="text-sm text-blue-200">Kunchala Srikanth - Market Farmer</span>
          </div>
        </div>
      </section>

      {/* Right Auth Section */}
      <section className="flex flex-col items-center justify-center p-8 md:p-12 bg-white">
        <div className="w-full max-w-sm">
          {children}
        </div>

        {/* Footer */}
        <footer className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-4 text-xs text-secondary-500">
          <span>© {new Date().getFullYear()} All rights reserved by KK Associates</span>
          <a
            href="https://wa.me/+919966369102"
            target="_blank"
            rel="noreferrer"
            aria-label="Contact KK Associates on WhatsApp"
            className="fixed bottom-6 right-6 w-11 h-11 flex items-center justify-center rounded-full bg-emerald-500 text-white shadow-lg hover:shadow-xl hover:scale-105 transition-all"
          >
            <MessageCircle size={20} className="fill-current" />
          </a>
        </footer>
      </section>
    </main>
  );
}

export default AuthLayout;
