import { useEffect, useState } from 'react';
import { apiFile } from '../api.js';

// A picture kept on the server (a scan picture, a picture from the ultrasound machine). A plain <img src="/api/…"> cannot
// send the hospital the tab is showing (X-Tenant-Id), so the server refuses it: the picture is fetched with apiFile and
// shown from memory, which is let go when the picture leaves the screen. link: the picture opens full size in a new tab.
export function ApiImage({ path, alt, link = false, ...props }) {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    let made = null;
    setFailed(false);
    apiFile(path)
      .then(({ blob }) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  if (failed) return <span className="hint">The picture could not be loaded.</span>;
  if (!url) return <span className="api-image-loading" role="img" aria-label={`${alt} – loading`} />;
  const img = <img src={url} alt={alt} {...props} />;
  return link ? (
    <a href={url} target="_blank" rel="noopener noreferrer">
      {img}
    </a>
  ) : (
    img
  );
}
