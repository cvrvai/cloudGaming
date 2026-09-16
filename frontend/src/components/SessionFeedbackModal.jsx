import { useState } from 'react';

const EXPERIENCE_OPTIONS = [
  { value: 'smooth', label: 'Smooth', description: 'Video and controls felt responsive.' },
  { value: 'mixed', label: 'Mostly okay', description: 'A few small issues occurred.' },
  { value: 'laggy', label: 'Laggy', description: 'The stream or controls felt delayed.' },
];

export default function SessionFeedbackModal({
  sessionData,
  onSubmit,
  onSkip,
  submitting = false,
}) {
  const [rating, setRating] = useState(0);
  const [experienceTag, setExperienceTag] = useState('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!rating) {
      setError('Please select a rating, or choose Skip feedback.');
      return;
    }

    setError('');
    await onSubmit({
      user_rating: rating,
      experience_tag: experienceTag || null,
      user_comment: comment.trim() || null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md"
      role="presentation"
      onKeyDown={(event) => event.stopPropagation()}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div
        className="w-full max-w-[500px] max-h-[92vh] overflow-y-auto p-7 rounded-2xl bg-[#141822] border border-blue-500/35 shadow-2xl text-white"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-feedback-title"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        onKeyUp={(event) => event.stopPropagation()}
      >
        <div className="mb-1.5 text-[10px] font-extrabold tracking-wider uppercase text-blue-400">Voice of Customer Feedback</div>
        <h2 id="session-feedback-title" className="text-2xl font-extrabold text-white mb-2">Session completed</h2>
        <p className="text-xs text-white/70 leading-relaxed mb-5">
          How was your experience on {sessionData?.machine_name || 'this gaming PC'}?
          Your feedback helps us measure stream quality and responsiveness.
        </p>

        <form onSubmit={handleSubmit}>
          <fieldset className="mb-4 border-0 p-0">
            <legend className="block text-xs font-bold text-white/90 mb-2">Overall rating <span className="text-white/40 font-normal">(required)</span></legend>
            <div className="flex gap-2" aria-label="Overall rating from 1 to 5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`w-10 h-10 rounded-xl border flex items-center justify-center text-xl transition-all cursor-pointer ${
                    rating >= value
                      ? 'border-yellow-400/70 bg-yellow-400/15 text-yellow-400 shadow-sm'
                      : 'border-white/15 bg-white/5 text-white/40 hover:text-yellow-400 hover:border-yellow-400/50 hover:-translate-y-0.5'
                  }`}
                  onClick={() => setRating(value)}
                  aria-label={`${value} out of 5`}
                  aria-pressed={rating === value}
                >
                  {rating >= value ? '★' : '☆'}
                </button>
              ))}
            </div>
            <span className="block mt-1.5 text-[11px] text-white/50">
              {rating ? `${rating} out of 5` : 'Select one rating'}
            </span>
          </fieldset>

          <fieldset className="mb-4 border-0 p-0">
            <legend className="block text-xs font-bold text-white/90 mb-2">How did the stream feel?</legend>
            <div className="grid grid-cols-3 gap-2">
              {EXPERIENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`p-2.5 rounded-xl border text-left text-white transition-all cursor-pointer ${
                    experienceTag === option.value
                      ? 'border-blue-500 bg-blue-500/15 shadow-sm'
                      : 'border-white/15 bg-white/5 hover:border-blue-400/60 hover:bg-white/10'
                  }`}
                  onClick={() => setExperienceTag(option.value)}
                  aria-pressed={experienceTag === option.value}
                >
                  <strong className="block text-xs font-bold mb-1">{option.label}</strong>
                  <span className="block text-[10px] text-white/55 leading-tight">{option.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block text-xs font-bold text-white/90 mb-2" htmlFor="session-feedback-comment">
            Comments <span className="text-white/40 font-normal">(optional)</span>
          </label>
          <textarea
            id="session-feedback-comment"
            className="w-full min-h-[90px] rounded-xl p-3 bg-black/30 border border-white/15 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-white text-xs outline-none resize-y select-text"
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 1000))}
            onKeyDown={(event) => event.stopPropagation()}
            onKeyUp={(event) => event.stopPropagation()}
            placeholder="What worked well, or what should we improve?"
            rows={4}
            maxLength={1000}
            spellCheck="true"
          />
          <div className="text-right text-[10px] text-white/40 mt-1">{comment.length}/1000</div>

          {error && <div className="p-2.5 mt-2 rounded-lg bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-medium" role="alert">{error}</div>}

          <div className="flex items-center justify-end gap-3 mt-5">
            <button
              type="button"
              className="px-4 py-2 text-xs font-semibold text-white/60 hover:text-white transition-colors cursor-pointer"
              onClick={onSkip}
              disabled={submitting}
            >
              Skip feedback
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md cursor-pointer disabled:opacity-50"
              disabled={submitting}
            >
              {submitting ? 'Saving...' : 'Submit feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
