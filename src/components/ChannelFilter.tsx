'use client';

import { Channel } from '@/lib/types';

const CHANNELS: (Channel | 'All')[] = ['All', 'Facebook Ads', 'YouTube', 'Instagram', 'LinkedIn', 'X'];
const PROGRAMS = ['All', 'Program A', 'Program B'];

interface ChannelFilterProps {
  selectedChannel: Channel | 'All';
  selectedProgram: string;
  onChannelChange: (channel: Channel | 'All') => void;
  onProgramChange: (program: string) => void;
}

export default function ChannelFilter({ selectedChannel, selectedProgram, onChannelChange, onProgramChange }: ChannelFilterProps) {
  return (
    <div className="flex flex-wrap items-center gap-6 mb-6">
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        {CHANNELS.map(ch => (
          <button
            key={ch}
            onClick={() => onChannelChange(ch)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              selectedChannel === ch
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {ch}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
        {PROGRAMS.map(p => (
          <button
            key={p}
            onClick={() => onProgramChange(p)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
              selectedProgram === p
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}
