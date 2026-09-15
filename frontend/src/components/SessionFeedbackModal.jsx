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
    <div className="session-feedback-backdrop" role="presentation">
      <div
        className="session-feedback-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="session-feedback-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="session-feedback-kicker">Verbatim Voice of Customer</div>
        <h2 id="session-feedback-title">Session completed</h2>
        <p className="session-feedback-intro">
          How was your experience on {sessionData?.machine_name || 'this gaming PC'}?
          Your feedback helps us measure the streaming CTQs.
        </p>

        <form onSubmit={handleSubmit}>
          <fieldset className="session-feedback-fieldset">
            <legend>Overall rating <span>(required)</span></legend>
            <div className="session-rating-options" aria-label="Overall rating from 1 to 5">
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`session-rating-btn ${rating >= value ? 'selected' : ''}`}
                  onClick={() => setRating(value)}
                  aria-label={`${value} out of 5`}
                  aria-pressed={rating === value}
                >
                  {rating >= value ? '★' : '☆'}
                </button>
              ))}
            </div>
            <span className="session-rating-caption">
              {rating ? `${rating} out of 5` : 'Select one rating'}
            </span>
          </fieldset>

          <fieldset className="session-feedback-fieldset">
            <legend>How did the stream feel?</legend>
            <div className="session-experience-options">
              {EXPERIENCE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`session-experience-btn ${experienceTag === option.value ? 'selected' : ''}`}
                  onClick={() => setExperienceTag(option.value)}
                  aria-pressed={experienceTag === option.value}
                >
                  <strong>{option.label}</strong>
                  <span>{option.description}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <label className="session-feedback-comment-label" htmlFor="session-feedback-comment">
            Comments <span>(optional)</span>
          </label>
          <textarea
            id="session-feedback-comment"
            className="session-feedback-comment"
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 1000))}
            placeholder="What worked well, or what should we improve?"
            rows={4}
            maxLength={1000}
          />
          <div className="session-feedback-char-count">{comment.length}/1000</div>

          {error && <div className="session-feedback-error" role="alert">{error}</div>}

          <div className="session-feedback-actions">
            <button type="button" className="session-feedback-skip" onClick={onSkip} disabled={submitting}>
              Skip feedback
            </button>
            <button type="submit" className="btn-primary session-feedback-submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Submit feedback'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
