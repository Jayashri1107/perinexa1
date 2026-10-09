// A person's circle: their profile photo (My settings), or their initials when there is none.
import { apiUrl } from '../api/http.js';
import { initialsOf } from '../utils/format.js';

export function Avatar({ user, className = '' }) {
  return (
    <span className={`avatar ${className}`} aria-hidden>
      {user.photoVersion > 0 ? <img className="avatar-img" src={apiUrl(`/account/photo?v=${user.photoVersion}`)} alt="" /> : initialsOf(user.name)}
    </span>
  );
}
