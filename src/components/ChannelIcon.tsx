'use client';

interface ChannelIconProps {
  channel: string;
  size?: number;
  className?: string;
}

export function getChannelColor(channel: string): string {
  switch (channel) {
    case 'YouTube': return '#FF0000';
    case 'Instagram': return '#E1306C';
    case 'LinkedIn': return '#0A66C2';
    case 'X': return '#9ca3af';
    case 'Facebook Ads': return '#22c55e';
    case 'Webinar': return '#8b5cf6';
    case 'Referral': return '#f59e0b';
    case 'Unknown': return '#6b7280';
    case 'All': return '#ffffff';
    default: return '#6b7280';
  }
}

export default function ChannelIcon({ channel, size = 16, className = '' }: ChannelIconProps) {
  const s = size;

  switch (channel) {
    case 'YouTube':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="2" y="4" width="20" height="16" rx="4" fill="#FF0000" />
          <polygon points="10,8 10,16 16,12" fill="white" />
        </svg>
      );

    case 'Instagram':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <defs>
            <linearGradient id="ig-grad" x1="0" y1="24" x2="24" y2="0">
              <stop offset="0%" stopColor="#feda75" />
              <stop offset="25%" stopColor="#fa7e1e" />
              <stop offset="50%" stopColor="#d62976" />
              <stop offset="75%" stopColor="#962fbf" />
              <stop offset="100%" stopColor="#4f5bd5" />
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig-grad)" />
          <circle cx="12" cy="12" r="5" stroke="white" strokeWidth="2" fill="none" />
          <circle cx="17.5" cy="6.5" r="1.5" fill="white" />
        </svg>
      );

    case 'LinkedIn':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="2" y="2" width="20" height="20" rx="4" fill="#0A66C2" />
          <text x="12" y="17" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold" fontFamily="Arial, sans-serif">in</text>
        </svg>
      );

    case 'X':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="2" y="2" width="20" height="20" rx="4" fill="#333" />
          <path d="M6.5 6.5L11.2 12.5L6.5 17.5H8L12 13.7L15.2 17.5H18L13 11.2L17.5 6.5H16L12.2 10L9.3 6.5H6.5Z" fill="white" />
        </svg>
      );

    case 'Facebook Ads':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="10" fill="#22c55e" />
          <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial, sans-serif">$</text>
        </svg>
      );

    case 'Webinar':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="3" y="4" width="18" height="13" rx="2" fill="#8b5cf6" />
          <rect x="5" y="6" width="14" height="9" rx="1" fill="#6d28d9" />
          <polygon points="10,8 10,13 15,10.5" fill="white" />
          <rect x="8" y="18" width="8" height="2" rx="1" fill="#8b5cf6" />
        </svg>
      );

    case 'Referral':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="8" cy="9" r="3" fill="#f59e0b" />
          <circle cx="16" cy="9" r="3" fill="#f59e0b" />
          <path d="M4 18c0-3 2.5-5 4-5s2 .5 4 .5 2-.5 4-.5 4 2 4 5" fill="#f59e0b" opacity="0.7" />
        </svg>
      );

    case 'Unknown':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="10" fill="#6b7280" />
          <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial, sans-serif">?</text>
        </svg>
      );

    case 'All':
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" fill="white" opacity="0.8" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" fill="white" opacity="0.8" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" fill="white" opacity="0.8" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" fill="white" opacity="0.8" />
        </svg>
      );

    default:
      return (
        <svg width={s} height={s} viewBox="0 0 24 24" fill="none" className={className}>
          <circle cx="12" cy="12" r="10" fill="#6b7280" />
          <text x="12" y="16.5" textAnchor="middle" fill="white" fontSize="14" fontWeight="bold" fontFamily="Arial, sans-serif">?</text>
        </svg>
      );
  }
}
