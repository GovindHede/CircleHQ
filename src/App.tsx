import React from 'react';
import { motion } from 'framer-motion';
import {
  Zap,
  ChevronRight,
  Users,
  Shield,
  MessageSquare,
  ArrowUpRight
} from 'lucide-react';

export default function App() {
  const [stats, setStats] = React.useState({ profilesCount: 0, connectionsCount: 0, introsCount: 0 });
  const [profiles, setProfiles] = React.useState<any[]>([]);
  const [view, setView] = React.useState<'landing' | 'dashboard'>('landing');
  const [searchQuery, setSearchQuery] = React.useState('');
  const [selectedInterest, setSelectedInterest] = React.useState<string | null>(null);
  const [selectedLocation, setSelectedLocation] = React.useState<string | null>(null);
  const [isSearching, setIsSearching] = React.useState(false);

  const fetchProfiles = (query?: string, interest?: string | null, location?: string | null) => {
    setIsSearching(true);
    let url = '/api/profiles?';
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (interest) params.append('interest', interest);
    if (location) params.append('location', location);

    fetch(url + params.toString())
      .then(res => res.json())
      .then(data => {
        if (!data.error) setProfiles(data);
        setIsSearching(false);
      })
      .catch(err => {
        console.error("Failed to fetch profiles", err);
        setIsSearching(false);
      });
  };

  React.useEffect(() => {
    fetch('/api/stats')
      .then(res => res.json())
      .then(data => {
        if (!data.error) setStats(data);
      })
      .catch(err => console.error("Failed to fetch stats", err));

    if (view === 'dashboard') {
      fetchProfiles(searchQuery, selectedInterest, selectedLocation);
    }
  }, [view, selectedInterest, selectedLocation]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchProfiles(searchQuery, selectedInterest, selectedLocation);
  };

  const handleStart = () => {
    window.open('https://t.me/circlehq_bot', '_blank');
  };

  if (view === 'dashboard') {
    return (
      <div className="min-h-screen bg-black text-white p-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex justify-between items-center mb-12">
            <div className="flex items-center gap-2">
              <Zap className="w-6 h-6 text-emerald-500 fill-emerald-500" />
              <h1 className="text-2xl font-display uppercase tracking-tighter">CircleHQ Dashboard</h1>
            </div>
            <button
              onClick={() => setView('landing')}
              className="px-6 py-2 border border-white/10 rounded-full hover:bg-white/5 transition-all"
            >
              Back to Home
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl">
              <div className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Total Profiles</div>
              <div className="text-4xl font-display uppercase">{stats.profilesCount}</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl">
              <div className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Introductions</div>
              <div className="text-4xl font-display uppercase">{stats.introsCount}</div>
            </div>
            <div className="bg-white/5 border border-white/10 p-6 rounded-2xl">
              <div className="text-white/50 text-xs font-bold uppercase tracking-widest mb-2">Active Connections</div>
              <div className="text-4xl font-display uppercase">{stats.connectionsCount}</div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-4">
            <h2 className="text-xl font-display uppercase tracking-tight">
              {searchQuery ? `Search Results for "${searchQuery}"` : 'Recent Profiles'}
            </h2>

            <form onSubmit={handleSearch} className="relative w-full md:w-96">
              <input
                type="text"
                placeholder="Search semantically (e.g. 'founders in Pune')"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-full py-3 px-6 pr-12 focus:outline-none focus:border-emerald-500 transition-all text-sm"
              />
              <button
                type="submit"
                disabled={isSearching}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-emerald-500 rounded-full hover:bg-emerald-400 transition-all disabled:opacity-50"
              >
                {isSearching ? (
                  <div className="w-4 h-4 border-2 border-black border-t-transparent animate-spin rounded-full" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-black" />
                )}
              </button>
            </form>
          </div>

          <div className="flex flex-wrap gap-2 mb-8">
            <span className="text-[10px] text-white/30 uppercase font-bold self-center mr-2">Quick Filters:</span>
            {['AI', 'Web3', 'DevOps', 'Design', 'Marketing', 'Fintech'].map(interest => (
              <button
                key={interest}
                onClick={() => setSelectedInterest(selectedInterest === interest ? null : interest)}
                className={`text-[10px] px-3 py-1.5 rounded-full border transition-all uppercase font-bold ${selectedInterest === interest
                    ? 'bg-emerald-500 border-emerald-500 text-black'
                    : 'bg-white/5 border-white/10 text-white/50 hover:border-white/30'
                  }`}
              >
                {interest}
              </button>
            ))}
            {(selectedInterest || selectedLocation || searchQuery) && (
              <button
                onClick={() => {
                  setSelectedInterest(null);
                  setSelectedLocation(null);
                  setSearchQuery('');
                  fetchProfiles();
                }}
                className="text-[10px] px-3 py-1.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-500 uppercase font-bold hover:bg-red-500/20 transition-all"
              >
                Clear All
              </button>
            )}
          </div>

          {profiles.length === 0 && !isSearching && (
            <div className="text-center py-20 bg-white/5 border border-white/10 rounded-2xl">
              <p className="text-white/30">No profiles found matching your search.</p>
              <button
                onClick={() => { setSearchQuery(''); fetchProfiles(); }}
                className="mt-4 text-emerald-500 hover:underline text-sm"
              >
                Clear Search
              </button>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {profiles.map((profile, index) => (
              <motion.div
                key={profile.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.05 }}
                whileHover={{ scale: 1.02, boxShadow: "0 0 20px rgba(16, 185, 129, 0.15)" }}
                className="bg-white/5 border border-white/10 p-6 rounded-2xl hover:border-emerald-500/50 transition-colors cursor-pointer flex flex-col h-full"
              >
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-lg font-bold">{profile.name || 'Anonymous'}</h3>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-500 px-2 py-1 rounded uppercase font-bold">
                    {profile.location || 'Unknown'}
                  </span>
                </div>
                <p className="text-sm text-white/50 mb-4 line-clamp-3 italic flex-grow">
                  "{profile.semantic_summary || 'No summary generated yet.'}"
                </p>
                <div className="flex flex-wrap gap-2 mt-auto">
                  {profile.interests?.slice(0, 3).map((interest: string) => (
                    <span key={interest} className="text-[10px] border border-white/10 px-2 py-1 rounded uppercase">
                      {interest}
                    </span>
                  ))}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-emerald-500/30">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-black/50 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center">
              <Zap className="w-5 h-5 text-black fill-black" />
            </div>
            <span className="font-display text-xl tracking-tighter uppercase">CircleHQ</span>
          </div>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-white/50">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <button
              onClick={handleStart}
              className="px-5 py-2 bg-white text-black rounded-full hover:bg-emerald-400 transition-all flex items-center gap-2"
            >
              Get Started <ArrowUpRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-40 pb-20 px-6 overflow-hidden">
        {/* Background Glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[1000px] h-[600px] bg-emerald-500/10 blur-[120px] rounded-full -z-10" />

        <div className="max-w-7xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          >
            <h1 className="font-display text-[12vw] md:text-[8vw] leading-[0.9] tracking-tighter uppercase mb-8">
              Networking,<br />
              <span className="text-emerald-500">Reimagined.</span>
            </h1>
          </motion.div>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-2xl mx-auto text-lg md:text-xl text-white/50 mb-12 leading-relaxed"
          >
            Connect with the right people through AI-powered semantic matching.
            No noise, just meaningful introductions.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="flex flex-col md:flex-row items-center justify-center gap-4"
          >
            <button
              onClick={handleStart}
              className="w-full md:w-auto px-12 py-5 bg-emerald-500 text-black text-lg font-bold rounded-full hover:bg-emerald-400 hover:scale-105 transition-all active:scale-95 flex items-center justify-center gap-3"
            >
              Let's Start <Zap className="w-5 h-5 fill-black" />
            </button>
            <button
              onClick={() => setView('dashboard')}
              className="w-full md:w-auto px-12 py-5 border border-white/10 rounded-full hover:bg-white/5 transition-all text-lg font-medium"
            >
              View Dashboard
            </button>
          </motion.div>
        </div>
      </section>

      {/* Features Grid */}
      <section id="features" className="py-32 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
            <FeatureCard
              icon={<Shield className="w-8 h-8 text-emerald-500" />}
              title="Identity Agent"
              description="Our AI builds a deep semantic profile of your professional identity and goals."
            />
            <FeatureCard
              icon={<Users className="w-8 h-8 text-emerald-500" />}
              title="Smart Matching"
              description="Vector-based matching ensures you only meet people who align with your current focus."
            />
            <FeatureCard
              icon={<MessageSquare className="w-8 h-8 text-emerald-500" />}
              title="Warm Intros"
              description="Automated, thoughtful introductions that break the ice and spark real conversations."
            />
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-32 px-6 bg-white/[0.01] overflow-hidden">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-20">
            <h2 className="font-display text-5xl md:text-7xl uppercase tracking-tighter mb-6">How it <span className="text-emerald-500">Works</span></h2>
            <p className="text-white/50 max-w-xl mx-auto">A seamless, AI-driven journey from onboarding to your next big collaboration.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 relative">
            {/* Connecting Line */}
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-px bg-gradient-to-r from-transparent via-emerald-500/20 to-transparent -z-10" />

            <Step
              number="01"
              title="Onboard"
              description="Chat with our Telegram bot to share your story and goals."
              delay={0}
            />
            <Step
              number="02"
              title="Analyze"
              description="Our AI generates a semantic profile and vector embedding."
              delay={0.1}
            />
            <Step
              number="03"
              title="Match"
              description="We find the most relevant connections using deep search."
              delay={0.2}
            />
            <Step
              number="04"
              title="Connect"
              description="Get a warm introduction and start building together."
              delay={0.3}
            />
          </div>
        </div>
      </section>

      {/* Privacy & Future Section */}
      <section className="py-32 px-6 border-t border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
            <motion.div
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <h2 className="font-display text-4xl md:text-6xl uppercase tracking-tighter mb-8">Built for the <span className="text-emerald-500">Future</span></h2>
              <div className="space-y-8">
                <div className="flex gap-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <Shield className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-xl font-display uppercase tracking-tight mb-2">Privacy First</h4>
                    <p className="text-white/50 leading-relaxed">Your data is yours. We use advanced encryption and semantic masking to ensure your private details stay private while still finding you the best matches.</p>
                  </div>
                </div>
                <div className="flex gap-6">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <ArrowUpRight className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div>
                    <h4 className="text-xl font-display uppercase tracking-tight mb-2">The Vision</h4>
                    <p className="text-white/50 leading-relaxed">CircleHQ is evolving into a global decentralized networking protocol. We're building for a future where talent finds opportunity without friction, powered by community-owned AI.</p>
                  </div>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
              className="relative aspect-square bg-emerald-500/5 rounded-3xl border border-white/5 flex items-center justify-center overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-1000" />
              <Zap className="w-32 h-32 text-emerald-500/20 group-hover:text-emerald-500/40 transition-all duration-700 group-hover:scale-110" />

              {/* Floating Elements */}
              <div className="absolute top-1/4 left-1/4 w-2 h-2 bg-emerald-500 rounded-full animate-ping" />
              <div className="absolute bottom-1/3 right-1/4 w-3 h-3 bg-emerald-500/50 rounded-full animate-pulse" />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Social Proof / Stats */}
      <section className="py-20 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6 flex flex-wrap justify-center gap-20 md:gap-40">
          <Stat value={stats.profilesCount.toString()} label="Active Users" />
          <Stat value={stats.introsCount.toString()} label="Introductions" />
          <Stat value="98%" label="Match Quality" />
        </div>
      </section>

      {/* Footer */}
      <footer className="py-20 px-6">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-emerald-500 fill-emerald-500" />
            <span className="font-display text-lg tracking-tighter uppercase">CircleHQ</span>
          </div>
          <p className="text-white/30 text-sm">© 2026 CircleHQ. All rights reserved.</p>
          <div className="flex gap-8 text-sm text-white/50">
            <a href="#" className="hover:text-white transition-colors">Twitter</a>
            <a href="#" className="hover:text-white transition-colors">Telegram</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode, title: string, description: string }) {
  return (
    <div className="group">
      <div className="mb-6 p-4 w-fit rounded-2xl bg-white/5 border border-white/10 group-hover:border-emerald-500/50 transition-colors">
        {icon}
      </div>
      <h3 className="text-2xl font-display uppercase tracking-tight mb-4">{title}</h3>
      <p className="text-white/50 leading-relaxed">{description}</p>
    </div>
  );
}

function Stat({ value, label }: { value: string, label: string }) {
  return (
    <div className="text-center">
      <div className="text-4xl md:text-5xl font-display uppercase tracking-tighter mb-2">{value}</div>
      <div className="text-xs font-bold uppercase tracking-widest text-white/30">{label}</div>
    </div>
  );
}

function Step({ number, title, description, delay }: { number: string, title: string, description: string, delay: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, delay }}
      className="relative bg-black border border-white/10 p-8 rounded-3xl hover:border-emerald-500/50 transition-all group"
    >
      <div className="text-emerald-500 font-display text-4xl mb-6 opacity-20 group-hover:opacity-100 transition-opacity">{number}</div>
      <h3 className="text-xl font-display uppercase tracking-tight mb-4">{title}</h3>
      <p className="text-white/50 text-sm leading-relaxed">{description}</p>
    </motion.div>
  );
}
