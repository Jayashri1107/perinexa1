import { useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useAuth } from '../auth/AuthContext.jsx';
import { Alert } from '../components/ui.jsx';
import { DENSITIES, FONTS, HELP, MOTIONS, STANDARD_APPEARANCE, TEXT_SIZES, THEMES, isStandard, normalizeAppearance } from '../appearance.js';

// "My settings → Appearance": each person sets the look that is comfortable for them – colour template, font,
// text size, spacing and animation. Every choice shows at once and is saved to their account (so it follows
// them to any computer); status colours, the teal of what is scheduled, and printouts never change.

function Row({ id, title, hint, labelFor, children }) {
  return (
    <div className="appearance-row">
      <div className="appearance-row-text">
        {labelFor ? (
          <label htmlFor={labelFor} id={id} className="appearance-row-title">
            {title}
          </label>
        ) : (
          <h3 id={id} className="appearance-row-title">
            {title}
          </h3>
        )}
        <p className="hint">{hint}</p>
      </div>
      <div className="appearance-row-control">{children}</div>
    </div>
  );
}

function Choices({ labelledBy, options, value, onChoose }) {
  return (
    <div className="segmented appearance-choices" role="group" aria-labelledby={labelledBy}>
      {options.map((o) => (
        <button key={o.key} type="button" aria-pressed={value === o.key} onClick={() => onChoose(o.key)}>
          {o.name}
        </button>
      ))}
    </div>
  );
}

// My settings → Appearance: how the screens look for this person, on every computer.
export function AppearanceSection() {
  const { user, saveAppearance } = useAuth();
  const look = normalizeAppearance(user.preferences?.appearance);
  const [status, setStatus] = useState(null); // 'saving' | 'saved' | { error }

  const save = (next) => {
    setStatus('saving');
    saveAppearance(next).then(
      () => setStatus('saved'),
      (err) => setStatus({ error: `${err.message} Your last saved look is back.` }),
    );
  };
  const choose = (key, value) => {
    if (look[key] !== value) save({ ...look, [key]: value });
  };

  const statusText =
    status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved – on your account, for every computer you use.' : 'Changes are saved as you make them, on your account.';

  return (
    <>
        <section className="card appearance" id="appearance" aria-labelledby="appearance-title">
          <p className="appearance-eyebrow">For you, on every computer</p>
          <h2 id="appearance-title">Appearance</h2>
          {status?.error && (
            <Alert type="error" onClose={() => setStatus(null)}>
              {status.error}
            </Alert>
          )}

          <Row id="appearance-theme" title="Colour template" hint="Changes the colours of the screen for you. Status colours (such as High-risk) and printouts stay the same.">
            <div className="appearance-swatches" role="radiogroup" aria-labelledby="appearance-theme">
              {THEMES.map((t) => (
                <label key={t.key} className={`appearance-swatch ${look.theme === t.key ? 'checked' : ''}`.trim()} htmlFor={`appearance-theme-${t.key}`}>
                  <input id={`appearance-theme-${t.key}`} type="radio" name="appearance-theme" className="sr-only" checked={look.theme === t.key} onChange={() => choose('theme', t.key)} />
                  <span className={`appearance-dot appearance-dot-${t.key}`} aria-hidden="true" />
                  <span className="appearance-swatch-name">{t.name}</span>
                </label>
              ))}
            </div>
          </Row>

          <Row id="appearance-font-title" labelFor="appearance-font" title="Font" hint="Every font comes with Perinexa or with this computer, so nothing is fetched from the internet.">
            <select id="appearance-font" value={look.font} onChange={(e) => choose('font', e.target.value)}>
              {FONTS.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
            <div className="appearance-sample" aria-label="How text looks">
              <p>Mrs Sample Patient · G2 P1 L1 · 28 w 3 d · Hb 10.4 g/dL · BP 118/76</p>
              <p>
                <span lang="hi">हिंदी</span> · <span lang="mr">मराठी</span> · next visit 12 Oct 2026
              </p>
            </div>
          </Row>

          <Row id="appearance-size" title="Text size" hint="Makes the text on the screen larger or smaller. Printouts stay the same size.">
            <Choices labelledBy="appearance-size" options={TEXT_SIZES} value={look.textSize} onChoose={(v) => choose('textSize', v)} />
          </Row>

          <Row id="appearance-density" title="Spacing" hint="Compact fits more rows on the screen.">
            <Choices labelledBy="appearance-density" options={DENSITIES} value={look.density} onChoose={(v) => choose('density', v)} />
          </Row>

          <Row id="appearance-help" title="Explanations" hint="How-to texts under fields and on pages. Safety notes, warnings and what was recorded are always shown. Also switched with Help at the top of every screen.">
            <Choices labelledBy="appearance-help" options={HELP} value={look.help} onChoose={(v) => choose('help', v)} />
          </Row>

          <Row id="appearance-motion" title="Animation" hint="Switch off on slow computers, or if movement on the screen is distracting.">
            <Choices labelledBy="appearance-motion" options={MOTIONS} value={look.motion} onChoose={(v) => choose('motion', v)} />
          </Row>

          <div className="appearance-foot">
            <button type="button" className="btn btn-link" onClick={() => save({ ...STANDARD_APPEARANCE })} disabled={isStandard(look)}>
              <RotateCcw aria-hidden="true" /> Back to standard settings
            </button>
            <span className="hint" role="status">
              {statusText}
            </span>
          </div>
        </section>
    </>
  );
}
