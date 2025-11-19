import { Link } from 'react-router-dom';

interface Capture {
  id: number;
  name: string;
  created_at: string;
  context_description?: string;
}

interface CaptureCardProps {
  capture: Capture;
}

function CaptureCard({ capture }: CaptureCardProps) {
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays === 1) {
      return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  };

  const isRecent = () => {
    const date = new Date(capture.created_at);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    return diffDays < 2;
  };

  return (
    <Link
      to={`/context/${capture.id}`}
      className="block p-5 rounded-xl border border-white/5 bg-[#1E293B]/60 transition-all duration-300 hover:border-white/10 hover:bg-[#1E293B]/80"
    >
      <h3 className="font-bold text-white mb-2 text-lg">{capture.name}</h3>
      <p className="text-sm text-slate-400 mb-3">{formatDate(capture.created_at)}</p>
      <div className="flex items-center gap-4 text-xs text-slate-500">
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">code</span>
          2 files
        </span>
        <span className="flex items-center gap-1">
          <span className="material-symbols-outlined text-sm">terminal</span>
          Terminal
        </span>
      </div>
    </Link>
  );
}

export default CaptureCard;
