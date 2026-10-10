import { MessageCircle } from 'lucide-react';
import { whatsappUrl } from '../utils/whatsapp.js';

// "Send on WhatsApp": opens WhatsApp at her number with the message written in (utils/whatsapp.js). Only for a patient
// who agreed to messages, with a mobile number; otherwise the reason is shown instead of the button.
export function WhatsAppButton({ phone, agreed, text, label = 'Send on WhatsApp', small = false, onOpened }) {
  const url = agreed ? whatsappUrl(phone, text) : null;
  if (!url) {
    return <span className="muted small">{!agreed ? 'WhatsApp: she has not agreed to messages' : 'WhatsApp: no mobile number'}</span>;
  }
  return (
    <a className={`btn btn-ghost${small ? ' btn-sm' : ''}`} href={url} target="_blank" rel="noreferrer" onClick={onOpened}>
      <MessageCircle size={small ? 14 : 16} aria-hidden /> {label}
    </a>
  );
}
